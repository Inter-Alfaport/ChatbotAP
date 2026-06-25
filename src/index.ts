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

