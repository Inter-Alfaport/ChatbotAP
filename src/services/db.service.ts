// src/services/db.service.ts
// Banco local SQLite — fonte primária de colaboradores para o bot
// A Solides só é consultada para dados em tempo real (férias, ponto)
// quando estritamente necessário durante o atendimento.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'colaboradores.db');

// Garante que a pasta data/ existe
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Otimizações de performance para SQLite
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS colaboradores (
    id            INTEGER PRIMARY KEY,   -- ID interno da Solides/Tangerino
    tangerino_id  INTEGER UNIQUE,        -- mesmo que id, mas nomeado explicitamente
    nome          TEXT    NOT NULL,
    phone         TEXT,                  -- número de telefone (campo principal de busca)
    cpf           TEXT,                  -- CPF para consultas futuras na Solides
    email         TEXT,
    cargo         TEXT,
    departamento  TEXT,
    data_admissao TEXT,
    ativo         INTEGER DEFAULT 1,     -- 0 = demitido (fired: true)
    atualizado_em TEXT                   -- ISO timestamp da última atualização
  );

  -- Índice para busca por telefone (hot path do bot)
  CREATE INDEX IF NOT EXISTS idx_phone ON colaboradores(phone);

  -- Índice para busca por CPF (consultas durante atendimento)
  CREATE INDEX IF NOT EXISTS idx_cpf ON colaboradores(cpf);

  -- Tabela de controle de sync
  CREATE TABLE IF NOT EXISTS sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT NOT NULL,         -- 'carga_inicial' | 'sync_diario'
    iniciado_em   TEXT NOT NULL,
    finalizado_em TEXT,
    total         INTEGER DEFAULT 0,
    atualizados   INTEGER DEFAULT 0,
    erros         INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'em_andamento'  -- 'ok' | 'erro' | 'em_andamento'
  );
`);

// ─── Statements preparados (performance) ─────────────────────────────────────
const stmtUpsert = db.prepare(`
  INSERT INTO colaboradores
    (id, tangerino_id, nome, phone, cpf, email, cargo, departamento, data_admissao, ativo, atualizado_em)
  VALUES
    (@id, @tangerino_id, @nome, @phone, @cpf, @email, @cargo, @departamento, @data_admissao, @ativo, @atualizado_em)
  ON CONFLICT(tangerino_id) DO UPDATE SET
    nome          = excluded.nome,
    phone         = excluded.phone,
    cpf           = excluded.cpf,
    email         = excluded.email,
    cargo         = excluded.cargo,
    departamento  = excluded.departamento,
    data_admissao = excluded.data_admissao,
    ativo         = excluded.ativo,
    atualizado_em = excluded.atualizado_em
`);

const stmtBuscarPorPhone = db.prepare(`
  SELECT * FROM colaboradores
  WHERE phone = ? AND ativo = 1
  LIMIT 1
`);

const stmtBuscarPorId = db.prepare(`
  SELECT * FROM colaboradores WHERE tangerino_id = ? LIMIT 1
`);

const stmtBuscarPorCpf = db.prepare(`
  SELECT * FROM colaboradores WHERE cpf = ? AND ativo = 1 LIMIT 1
`);

const stmtBuscarPorSufixo = db.prepare(`
  SELECT * FROM colaboradores
  WHERE phone LIKE ? AND ativo = 1
  LIMIT 1
`);

// Upsert em lote dentro de uma transação (muito mais rápido para carga inicial)
const upsertEmLote = db.transaction((colaboradores: any[]) => {
  for (const c of colaboradores) {
    stmtUpsert.run(c);
  }
});

// Tipo explícito do colaborador — evita referência circular no dbService
export type ColaboradorInput = {
  id: number;
  nome: string;
  phone?: string | null;
  cpf?: string | null;
  email?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  dataAdmissao?: string | null;
  ativo: boolean;
};

export const dbService = {

  // Insere ou atualiza um colaborador
  upsert(colaborador: ColaboradorInput): void {
    stmtUpsert.run({
      id:            colaborador.id,
      tangerino_id:  colaborador.id,
      nome:          colaborador.nome,
      phone:         colaborador.phone ? colaborador.phone.replace(/\D/g, '') : null,
      cpf:           colaborador.cpf ?? null,
      email:         colaborador.email ?? null,
      cargo:         colaborador.cargo ?? null,
      departamento:  colaborador.departamento ?? null,
      data_admissao: colaborador.dataAdmissao ?? null,
      ativo:         colaborador.ativo ? 1 : 0,
      atualizado_em: new Date().toISOString(),
    });
  },

  // Upsert em lote — usado na carga inicial
  upsertLote(colaboradores: ColaboradorInput[]): void {
    const rows = colaboradores.map((c) => ({
      id:            c.id,
      tangerino_id:  c.id,
      nome:          c.nome,
      phone:         c.phone ? c.phone.replace(/\D/g, '') : null,
      cpf:           c.cpf ?? null,
      email:         c.email ?? null,
      cargo:         c.cargo ?? null,
      departamento:  c.departamento ?? null,
      data_admissao: c.dataAdmissao ?? null,
      ativo:         c.ativo ? 1 : 0,
      atualizado_em: new Date().toISOString(),
    }));
    upsertEmLote(rows);
  },

  // Busca por telefone — hot path da autenticação do bot
  // Tenta match exato e depois pelos últimos 9 dígitos (cobre variações de +55, DDD)
  buscarPorTelefone(telefone: string): any | null {
    const tel = telefone.replace(/\D/g, '');

    // Tenta match exato primeiro
    let result = stmtBuscarPorPhone.get(tel);
    if (result) return result;

    // Tenta match pelos últimos 9 dígitos (cobre +55 vs sem +55, DDD diferente, etc)
    const sufixo = tel.slice(-9);
    result = stmtBuscarPorSufixo.get(`%${sufixo}`);

    return result ?? null;
  },

  buscarPorId(id: number): any | null {
    return stmtBuscarPorId.get(id) ?? null;
  },

  buscarPorCpf(cpf: string): any | null {
    const cpfLimpo = cpf.replace(/\D/g, '');
    return stmtBuscarPorCpf.get(cpfLimpo) ?? null;
  },

  // Estatísticas para monitoramento
  stats(): { total: number; ativos: number; comTelefone: number } {
    const total      = (db.prepare('SELECT COUNT(*) as n FROM colaboradores').get() as any).n;
    const ativos     = (db.prepare('SELECT COUNT(*) as n FROM colaboradores WHERE ativo = 1').get() as any).n;
    const comTelefone = (db.prepare("SELECT COUNT(*) as n FROM colaboradores WHERE phone IS NOT NULL AND phone != ''").get() as any).n;
    return { total, ativos, comTelefone };
  },

  // Controle de sync
  iniciarSync(tipo: 'carga_inicial' | 'sync_diario'): number {
    const result = db.prepare(`
      INSERT INTO sync_log (tipo, iniciado_em) VALUES (?, ?)
    `).run(tipo, new Date().toISOString());
    return result.lastInsertRowid as number;
  },

  finalizarSync(id: number, dados: { total: number; atualizados: number; erros: number; status: 'ok' | 'erro' }): void {
    db.prepare(`
      UPDATE sync_log SET finalizado_em = ?, total = ?, atualizados = ?, erros = ?, status = ?
      WHERE id = ?
    `).run(new Date().toISOString(), dados.total, dados.atualizados, dados.erros, dados.status, id);
  },

  ultimoSync(): any {
    return db.prepare(`
      SELECT * FROM sync_log ORDER BY id DESC LIMIT 1
    `).get();
  },
};
