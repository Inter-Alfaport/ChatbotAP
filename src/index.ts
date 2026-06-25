// src/index.ts
import 'dotenv/config';
import express from 'express';
import {
  webhookHandler,
  testColaboradoresHandler,
  testHistoricoHandler,
  testChatHandler,
  testLiberarHandler,
  testLimparHistoricoHandler
} from './routes/webhook.controller';
import { webhookAuth } from './middleware/webhook-auth';
import { dbService } from './services/db.service';
import { iniciarSyncScheduler } from './services/sync.service';
import { executarCargaInicial } from './scripts/carga-inicial';

const app = express();
const PORT = process.env.PORT || 3000;

// Parsing de JSON
app.use(express.json());

// Servir arquivos estáticos do front-end de teste
app.use(express.static('public'));

// Health check para o Railway saber que está vivo e para mostrar dados de produção
app.get('/health', (_req, res) => {
  try {
    const stats = dbService.stats();
    const ultimoSync = dbService.ultimoSync();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      banco: stats,
      ultimoSync: ultimoSync ?? null
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Webhook principal da Evolution API
app.post('/webhook/whatsapp', webhookAuth, webhookHandler);

// Endpoints da API de teste (Mockup / Front-end)
app.get('/api/test/colaboradores', testColaboradoresHandler);
app.get('/api/test/historico/:telefone', testHistoricoHandler);
app.post('/api/test/chat', testChatHandler);
app.post('/api/test/liberar', testLiberarHandler);
app.post('/api/test/limpar', testLimparHistoricoHandler);

// ── Seed manual de colaboradores Alfaport (solução temporária) ─────────────────
// POST /api/admin/seed-alfaport  —  Header: x-admin-secret: <ADMIN_SECRET>
app.post('/api/admin/seed-alfaport', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  const membros = [
    { id: 9001, nome: 'Yasmin Gonçalves Fontes', phone: '5521983594047', cargo: 'Atendente',       departamento: 'Atendimento' },
    { id: 9002, nome: 'Ana',                     phone: '5521979376817', cargo: 'Atendente',       departamento: 'Atendimento' },
    { id: 9003, nome: 'Patricia Almeida',         phone: '5521964650514', cargo: 'Analista',        departamento: 'Financeiro'  },
    { id: 9004, nome: 'Dantas',                   phone: '5521964530259', cargo: 'Diretor',         departamento: 'Diretoria'   },
  ];

  try {
    for (const m of membros) {
      dbService.upsert({
        id:           m.id,
        nome:         m.nome,
        phone:        m.phone,
        cargo:        m.cargo,
        departamento: m.departamento,
        ativo:        true,
      });
    }
    console.log(`[Seed] ${membros.length} membros Alfaport inseridos com sucesso.`);
    res.json({ ok: true, inseridos: membros.length, membros });
  } catch (err: any) {
    console.error('[Seed] Erro ao inserir membros:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Rota de debug (temporária) ─────────────────────────────────────────────────
// Lista todos os colaboradores do banco SQLite com seus telefones para diagnóstico
app.get('/api/debug/colaboradores', (_req, res) => {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'colaboradores.db');
    const db2 = new Database(dbPath, { readonly: true });
    const rows = db2.prepare('SELECT id, tangerino_id, nome, phone, cargo, departamento, data_admissao, email, ativo FROM colaboradores ORDER BY nome').all();
    db2.close();
    res.json({ total: rows.length, colaboradores: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 RH Chatbot rodando na porta ${PORT}`);
  console.log(`📡 Webhook disponível em POST /webhook/whatsapp`);
  console.log(`💻 Painel de teste disponível em http://localhost:${PORT}`);

  // 1. Inicia o scheduler de sincronização diária
  iniciarSyncScheduler();

  // 2. Executa a carga inicial automaticamente se o banco estiver vazio
  try {
    const stats = dbService.stats();
    if (stats.total === 0) {
      console.log('🗄️ Banco de dados vazio. Iniciando carga inicial em segundo plano...');
      executarCargaInicial().catch((err) => {
        console.error('❌ Erro durante a carga inicial automática:', err);
      });
    } else {
      console.log(`🗄️ Banco de dados carregado: ${stats.total} colaboradores cadastrados.`);
    }
  } catch (err) {
    console.error('❌ Erro ao verificar estado inicial do banco:', err);
  }
});

