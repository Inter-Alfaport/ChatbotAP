// src/index.ts
import 'dotenv/config';
import express from 'express';
import { webhookHandler } from './routes/webhook.controller';
import { webhookAuth } from './middleware/webhook-auth';
import path from 'path';
import adminRouter from './routes/admin.controller';
import relatoriosRouter from './routes/relatorios.controller';
import { dbService } from './services/db.service';
import { iniciarSyncScheduler } from './services/sync.service';
import { executarCargaInicial } from './scripts/carga-inicial';

const app = express();
const PORT = process.env.PORT || 3000;

// Parsing de JSON
app.use(express.json());

// Servir o Dashboard estático
app.use('/dashboard', express.static(path.join(process.cwd(), 'src', 'dashboard')));

// Health check para o Railway saber que está vivo e para mostrar dados de produção
app.get('/health', async (_req, res) => {
  try {
    const stats = await dbService.stats();
    const ultimoSync = await dbService.ultimoSync();
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

// Rotas de Relatórios (protegidas com ADMIN_SECRET)
app.use('/api/relatorios', relatoriosRouter);

// Rotas administrativas (protegidas com ADMIN_SECRET)
app.use('/api/admin', adminRouter);

app.listen(PORT, async () => {
  console.log(`🤖 RH Chatbot rodando na porta ${PORT}`);
  console.log(`📡 Webhook disponível em POST /webhook/whatsapp`);

  // Inicializa o banco de dados PostgreSQL
  try {
    await dbService.inicializar();
  } catch (err) {
    console.error('❌ Erro ao inicializar o banco de dados:', err);
  }

  // 1. Inicia o scheduler de sincronização diária
  iniciarSyncScheduler();

  // 2. Executa a carga inicial automaticamente se o banco estiver vazio
  try {
    const stats = await dbService.stats();
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
