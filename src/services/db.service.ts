// src/services/db.service.ts
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('⚠️ [DB] A variável de ambiente DATABASE_URL não está configurada!');
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('railway.internal') ? false : (connectionString ? { rejectUnauthorized: false } : false),
});

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
  async inicializar(): Promise<void> {
    console.log('[DB] Inicializando tabelas no PostgreSQL...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS colaboradores (
        id            INTEGER PRIMARY KEY,
        tangerino_id  INTEGER UNIQUE,
        nome          TEXT NOT NULL,
        phone         TEXT,
        cpf           TEXT,
        email         TEXT,
        cargo         TEXT,
        departamento  TEXT,
        data_admissao TEXT,
        ativo         INTEGER DEFAULT 1,
        atualizado_em TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_phone ON colaboradores(phone);
      CREATE INDEX IF NOT EXISTS idx_cpf ON colaboradores(cpf);

      CREATE TABLE IF NOT EXISTS sync_log (
        id            SERIAL PRIMARY KEY,
        tipo          TEXT NOT NULL,
        iniciado_em   TEXT NOT NULL,
        finalizado_em TEXT,
        total         INTEGER DEFAULT 0,
        atualizados   INTEGER DEFAULT 0,
        erros         INTEGER DEFAULT 0,
        status        TEXT DEFAULT 'em_andamento'
      );

      CREATE TABLE IF NOT EXISTS phone_update_log (
        id            SERIAL PRIMARY KEY,
        cpf           TEXT NOT NULL,
        telefone_ant  TEXT,
        telefone_novo TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      -- Tabelas da Fase 2: Analytics
      CREATE TABLE IF NOT EXISTS atendimentos (
        id                       TEXT PRIMARY KEY,
        telefone                 TEXT NOT NULL,
        colaborador_id           INTEGER,
        nome_colaborador         TEXT,
        canal                    TEXT DEFAULT 'whatsapp',
        status                   TEXT DEFAULT 'aberto',
        
        -- Bot
        data_inicio              TIMESTAMPTZ NOT NULL,
        data_ultima_interacao    TIMESTAMPTZ,
        qtd_mensagens_usuario    INTEGER DEFAULT 0,
        qtd_respostas_bot        INTEGER DEFAULT 0,
        intencao                 TEXT,
        categoria                TEXT,
        subcategoria             TEXT,
        resolvido_pelo_bot       BOOLEAN,
        
        -- Transbordo
        houve_transbordo         BOOLEAN DEFAULT FALSE,
        data_transbordo          TIMESTAMPTZ,
        motivo_transbordo        TEXT,
        origem_transbordo        TEXT,
        
        -- Atendimento humano
        atendente_telefone       TEXT,
        data_assumido            TIMESTAMPTZ,
        data_primeira_resposta   TIMESTAMPTZ,
        data_encerramento        TIMESTAMPTZ,
        qtd_mensagens_atendente  INTEGER DEFAULT 0,
        
        -- Identificação
        colaborador_identificado BOOLEAN DEFAULT FALSE,
        motivo_nao_identificacao TEXT,
        
        -- Satisfação
        avaliacao_nota           INTEGER,
        avaliacao_respondida     BOOLEAN DEFAULT FALSE,
        
        criado_em                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS atendimento_eventos (
        id              SERIAL PRIMARY KEY,
        atendimento_id  TEXT NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
        tipo            TEXT NOT NULL,
        timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        usuario         TEXT,
        metadata        JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_atend_telefone ON atendimentos(telefone);
      CREATE INDEX IF NOT EXISTS idx_atend_status ON atendimentos(status);
      CREATE INDEX IF NOT EXISTS idx_atend_data ON atendimentos(data_inicio);
      CREATE INDEX IF NOT EXISTS idx_eventos_atend ON atendimento_eventos(atendimento_id);

      CREATE SEQUENCE IF NOT EXISTS atendimento_id_seq START 1;
    `);

    // Migração segura: adiciona colunas novas sem apagar dados existentes
    const migracoesAdicionais = [
      `ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS encerrado_por TEXT`,
      `ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS atraso_sla BOOLEAN DEFAULT FALSE`,
    ];
    for (const sql of migracoesAdicionais) {
      try { await pool.query(sql); } catch { /* coluna já existe */ }
    }

    console.log('[DB] Tabelas prontas!');
  },

  async upsert(colaborador: ColaboradorInput): Promise<void> {
    const phone = colaborador.phone ? colaborador.phone.replace(/\D/g, '') : null;
    const cpf = colaborador.cpf ?? null;
    const email = colaborador.email ?? null;
    const cargo = colaborador.cargo ?? null;
    const depto = colaborador.departamento ?? null;
    const admissao = colaborador.dataAdmissao ?? null;
    const ativo = colaborador.ativo ? 1 : 0;
    const atualizado = new Date().toISOString();

    const query = `
      INSERT INTO colaboradores
        (id, tangerino_id, nome, phone, cpf, email, cargo, departamento, data_admissao, ativo, atualizado_em)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(tangerino_id) DO UPDATE SET
        nome          = EXCLUDED.nome,
        phone         = COALESCE(NULLIF(EXCLUDED.phone, ''), colaboradores.phone),
        cpf           = COALESCE(NULLIF(EXCLUDED.cpf, ''), colaboradores.cpf),
        email         = EXCLUDED.email,
        cargo         = EXCLUDED.cargo,
        departamento  = EXCLUDED.departamento,
        data_admissao = EXCLUDED.data_admissao,
        ativo         = EXCLUDED.ativo,
        atualizado_em = EXCLUDED.atualizado_em
    `;

    await pool.query(query, [
      colaborador.id,
      colaborador.id,
      colaborador.nome,
      phone,
      cpf,
      email,
      cargo,
      depto,
      admissao,
      ativo,
      atualizado,
    ]);
  },

  async upsertLote(colaboradores: ColaboradorInput[]): Promise<void> {
    // Executa em transação para melhor performance
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const query = `
        INSERT INTO colaboradores
          (id, tangerino_id, nome, phone, cpf, email, cargo, departamento, data_admissao, ativo, atualizado_em)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT(tangerino_id) DO UPDATE SET
          nome          = EXCLUDED.nome,
          phone         = COALESCE(NULLIF(EXCLUDED.phone, ''), colaboradores.phone),
          cpf           = COALESCE(NULLIF(EXCLUDED.cpf, ''), colaboradores.cpf),
          email         = EXCLUDED.email,
          cargo         = EXCLUDED.cargo,
          departamento  = EXCLUDED.departamento,
          data_admissao = EXCLUDED.data_admissao,
          ativo         = EXCLUDED.ativo,
          atualizado_em = EXCLUDED.atualizado_em
      `;

      for (const c of colaboradores) {
        const phone = c.phone ? c.phone.replace(/\D/g, '') : null;
        const ativo = c.ativo ? 1 : 0;
        const atualizado = new Date().toISOString();
        await client.query(query, [
          c.id,
          c.id,
          c.nome,
          phone,
          c.cpf ?? null,
          c.email ?? null,
          c.cargo ?? null,
          c.departamento ?? null,
          c.dataAdmissao ?? null,
          ativo,
          atualizado,
        ]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async buscarPorTelefone(telefone: string): Promise<any | null> {
    const tel = telefone.replace(/\D/g, '');

    // 1. Tenta match exato primeiro
    const resExato = await pool.query(
      'SELECT * FROM colaboradores WHERE phone = $1 AND ativo = 1 LIMIT 1',
      [tel]
    );
    if (resExato.rows.length > 0) return resExato.rows[0];

    // 2. Tenta match pelos últimos 9 dígitos
    const sufixo = tel.slice(-9);
    const resSufixo = await pool.query(
      'SELECT * FROM colaboradores WHERE phone LIKE $1 AND ativo = 1 LIMIT 1',
      [`%${sufixo}`]
    );
    return resSufixo.rows[0] ?? null;
  },

  async buscarPorId(id: number): Promise<any | null> {
    const res = await pool.query(
      'SELECT * FROM colaboradores WHERE tangerino_id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] ?? null;
  },

  async buscarPorCpf(cpf: string): Promise<any | null> {
    const cpfLimpo = cpf.replace(/\D/g, '');
    const res = await pool.query(
      'SELECT * FROM colaboradores WHERE cpf = $1 AND ativo = 1 LIMIT 1',
      [cpfLimpo]
    );
    return res.rows[0] ?? null;
  },

  async stats(): Promise<{ total: number; ativos: number; comTelefone: number }> {
    const resTotal = await pool.query('SELECT COUNT(*) as count FROM colaboradores');
    const resAtivos = await pool.query('SELECT COUNT(*) as count FROM colaboradores WHERE ativo = 1');
    const resComTelefone = await pool.query(
      "SELECT COUNT(*) as count FROM colaboradores WHERE phone IS NOT NULL AND phone != ''"
    );

    return {
      total: parseInt(resTotal.rows[0].count || '0'),
      ativos: parseInt(resAtivos.rows[0].count || '0'),
      comTelefone: parseInt(resComTelefone.rows[0].count || '0'),
    };
  },

  async iniciarSync(tipo: 'carga_inicial' | 'sync_diario'): Promise<number> {
    const res = await pool.query(
      'INSERT INTO sync_log (tipo, iniciado_em) VALUES ($1, $2) RETURNING id',
      [tipo, new Date().toISOString()]
    );
    return res.rows[0].id;
  },

  async finalizarSync(
    id: number,
    dados: { total: number; atualizados: number; erros: number; status: 'ok' | 'erro' }
  ): Promise<void> {
    await pool.query(
      `UPDATE sync_log 
       SET finalizado_em = $1, total = $2, atualizados = $3, erros = $4, status = $5
       WHERE id = $6`,
      [new Date().toISOString(), dados.total, dados.atualizados, dados.erros, dados.status, id]
    );
  },

  async ultimoSync(): Promise<any> {
    const res = await pool.query('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1');
    return res.rows[0] ?? null;
  },

  async atualizarTelefoneColaborador(cpf: string, novoTelefone: string): Promise<void> {
    const cpfLimpo = cpf.replace(/\D/g, '');
    const telLimpo = novoTelefone.replace(/\D/g, '');

    const res = await pool.query('SELECT * FROM colaboradores WHERE cpf = $1 AND ativo = 1 LIMIT 1', [
      cpfLimpo,
    ]);
    const colaborador = res.rows[0];

    if (!colaborador) {
      console.warn(`[DB] atualizarTelefoneColaborador: CPF ${cpfLimpo} não encontrado.`);
      return;
    }

    const telefoneAnterior = colaborador.phone ?? null;
    const agora = new Date().toISOString();

    await pool.query('UPDATE colaboradores SET phone = $1, atualizado_em = $2 WHERE cpf = $3', [
      telLimpo,
      agora,
      cpfLimpo,
    ]);

    await pool.query(
      'INSERT INTO phone_update_log (cpf, telefone_ant, telefone_novo, atualizado_em) VALUES ($1, $2, $3, $4)',
      [cpfLimpo, telefoneAnterior, telLimpo, agora]
    );

    console.log(
      `[DB] Telefone atualizado — CPF: ${cpfLimpo} | Anterior: ${telefoneAnterior} → Novo: ${telLimpo}`
    );
  },

  async exportarTelefones(): Promise<{ vinculos: any[]; historico: any[] }> {
    const resVinculos = await pool.query(`
      SELECT cpf, phone, nome FROM colaboradores
      WHERE phone IS NOT NULL AND phone != '' AND cpf IS NOT NULL AND cpf != ''
    `);

    const resHistorico = await pool.query(`
      SELECT * FROM phone_update_log ORDER BY id ASC
    `);

    return {
      vinculos: resVinculos.rows,
      historico: resHistorico.rows,
    };
  },

  async restaurarTelefones(vinculos: Array<{ cpf: string; phone: string }>): Promise<number> {
    let restaurados = 0;
    const query = `
      UPDATE colaboradores 
      SET phone = $1, atualizado_em = $2 
      WHERE cpf = $3 AND (phone IS NULL OR phone = '')
    `;
    const agora = new Date().toISOString();

    for (const v of vinculos) {
      if (!v.cpf || !v.phone) continue;
      const cpfLimpo = v.cpf.replace(/\D/g, '');
      const telLimpo = v.phone.replace(/\D/g, '');
      const info = await pool.query(query, [telLimpo, agora, cpfLimpo]);
      if (info.rowCount && info.rowCount > 0) restaurados++;
    }

    return restaurados;
  },

  // ── Métodos de Analytics (Fase 2) ───────────────────────────────────────────
  async gerarProximoAtendimentoId(): Promise<string> {
    const res = await pool.query("SELECT nextval('atendimento_id_seq')");
    const nextVal = res.rows[0].nextval;
    return `ATD-${String(nextVal).padStart(6, '0')}`;
  },

  async criarAtendimento(
    telefone: string,
    colaboradorId?: number,
    nomeColaborador?: string,
    colaboradorIdentificado: boolean = false,
    motivoNaoIdentificacao?: string
  ): Promise<string> {
    const id = await this.gerarProximoAtendimentoId();
    const agora = new Date();

    const query = `
      INSERT INTO atendimentos (
        id, telefone, colaborador_id, nome_colaborador, status,
        data_inicio, data_ultima_interacao, colaborador_identificado, motivo_nao_identificacao, criado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await pool.query(query, [
      id,
      telefone,
      colaboradorId ?? null,
      nomeColaborador ?? null,
      'aberto',
      agora,
      agora,
      colaboradorIdentificado,
      motivoNaoIdentificacao ?? null,
      agora,
    ]);

    await this.registrarEvento(id, 'inicio', 'sistema', { telefone });
    return id;
  },

  async atualizarAtendimento(id: string, campos: Record<string, any>): Promise<void> {
    const keys = Object.keys(campos);
    if (keys.length === 0) return;

    const setClauses = keys.map((key, index) => `"${key}" = $${index + 2}`);
    const query = `UPDATE atendimentos SET ${setClauses.join(', ')} WHERE id = $1`;
    const values = [id, ...Object.values(campos)];

    await pool.query(query, values);
  },

  async registrarEvento(
    atendimentoId: string,
    tipo: string,
    usuario?: string,
    metadata?: any
  ): Promise<void> {
    const query = `
      INSERT INTO atendimento_eventos (atendimento_id, tipo, timestamp, usuario, metadata)
      VALUES ($1, $2, NOW(), $3, $4)
    `;
    await pool.query(query, [atendimentoId, tipo, usuario ?? null, metadata ? JSON.stringify(metadata) : null]);
  },

  async buscarAtendimentoAberto(telefone: string): Promise<any | null> {
    const res = await pool.query(
      `SELECT * FROM atendimentos 
       WHERE telefone = $1 AND status IN ('aberto', 'em_transbordo', 'em_atendimento') 
       ORDER BY data_inicio DESC LIMIT 1`,
      [telefone]
    );
    return res.rows[0] ?? null;
  },

  async encerrarAtendimento(id: string, encerradoPor?: string): Promise<void> {
    const agora = new Date();
    await pool.query(
      `UPDATE atendimentos 
       SET status = 'encerrado', data_encerramento = $1, data_ultima_interacao = $1,
           encerrado_por = COALESCE($3, encerrado_por)
       WHERE id = $2`,
      [agora, id, encerradoPor ?? null]
    );
    await this.registrarEvento(id, 'encerrado', encerradoPor ?? 'sistema');
  },

  async encerrarAtendimentosPorInatividade(
    timeoutBotMinutos: number,
    timeoutHumanoMinutos: number
  ): Promise<Array<{ id: string; telefone: string; houve_transbordo: boolean; atendente_telefone: string | null }>> {
    const agora = new Date();
    // Atendimentos do bot inativos: aberto + sem transbordo
    const botQuery = `
      UPDATE atendimentos
      SET status = 'encerrado', data_encerramento = $1, data_ultima_interacao = $1,
          encerrado_por = 'inatividade', resolvido_pelo_bot = TRUE
      WHERE status = 'aberto'
        AND houve_transbordo = FALSE
        AND data_ultima_interacao < NOW() - ($2 || ' minutes')::INTERVAL
      RETURNING id, telefone, houve_transbordo, atendente_telefone
    `;
    const botRes = await pool.query(botQuery, [agora, timeoutBotMinutos]);

    // Atendimentos humanos inativos: em_transbordo ou em_atendimento
    const humanoQuery = `
      UPDATE atendimentos
      SET status = 'encerrado', data_encerramento = $1, data_ultima_interacao = $1,
          encerrado_por = 'inatividade'
      WHERE status IN ('em_transbordo', 'em_atendimento')
        AND data_ultima_interacao < NOW() - ($2 || ' minutes')::INTERVAL
      RETURNING id, telefone, houve_transbordo, atendente_telefone
    `;
    const humanoRes = await pool.query(humanoQuery, [agora, timeoutHumanoMinutos]);

    return [...botRes.rows, ...humanoRes.rows];
  },

  async marcarAtrasoDeSla(): Promise<void> {
    await pool.query(`
      UPDATE atendimentos
      SET atraso_sla = TRUE
      WHERE status = 'em_transbordo'
        AND houve_transbordo = TRUE
        AND data_transbordo IS NOT NULL
        AND data_primeira_resposta IS NULL
        AND data_transbordo < NOW() - INTERVAL '30 minutes'
        AND (atraso_sla IS NULL OR atraso_sla = FALSE)
    `);
  },

  async listarColaboradores(): Promise<any[]> {
    const res = await pool.query(
      'SELECT id, tangerino_id, nome, phone, cargo, departamento, data_admissao, email, ativo FROM colaboradores ORDER BY nome'
    );
    return res.rows;
  },
};
