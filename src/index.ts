// src/index.ts
import 'dotenv/config';
import express from 'express';
import { webhookHandler } from './routes/webhook.controller';
import path from 'path';
import adminRouter from './routes/admin.controller';
import relatoriosRouter from './routes/relatorios.controller';
import { dbService } from './services/db.service';
import { sessaoService } from './services/sessao.service';
import { iniciarSyncScheduler } from './services/sync.service';
import { executarCargaInicial } from './scripts/carga-inicial';
import { iniciarWorkerInatividade } from './workers/inatividade.worker';
import { iniciarWorkerWatchdog } from './workers/watchdog.worker';

const app = express();
const PORT = process.env.PORT || 3000;

// Parsing de JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir o Dashboard estático
app.use('/dashboard', express.static(path.join(process.cwd(), 'src', 'dashboard')));

// Página amigável para liberar atendimento / reativar bot
app.get('/liberar', async (req, res) => {
  const tel = req.query.tel as string;
  if (!tel) {
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Liberar Atendimento - RH Chatbot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); max-width: 440px; width: 100%; border: 1px solid #334155; }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.4rem; display: flex; align-items: center; gap: 8px; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    input { width: 100%; box-sizing: border-box; padding: 0.85rem; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; margin-bottom: 1.2rem; font-size: 1rem; }
    input:focus { border-color: #38bdf8; outline: none; }
    button { width: 100%; padding: 0.85rem; border-radius: 8px; border: none; background: #0284c7; color: #fff; font-weight: bold; cursor: pointer; font-size: 1rem; transition: background 0.2s; }
    button:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔓 Liberar Atendimento</h2>
    <p>Informe o telefone do colaborador (com DDD) para encerrar o silêncio e reativar o robô imediatamente:</p>
    <form method="GET" action="/liberar">
      <input type="text" name="tel" placeholder="Ex: 5521999999999" required autofocus />
      <button type="submit">Reativar Bot</button>
    </form>
  </div>
</body>
</html>
    `);
    return;
  }

  const limpo = tel.replace(/\D/g, '');
  const sessao = await sessaoService.buscar(limpo);
  if (sessao) {
    sessao.emTransbordo = false;
    sessao.transbordoInicio = undefined;
    sessao.modoAtendente = false;
    sessao.modoAtendenteTTL = undefined;
    sessao.fluxoAtivo = undefined;
    sessao.categoria = undefined;
    sessao.tentativasDiagnostico = undefined;
    sessao.estado = undefined;
    sessao.atendimentoId = undefined;
    await sessaoService.salvar(sessao);
  }

  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Liberado!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: #1e293b; padding: 2.5rem 2rem; border-radius: 12px; text-align: center; max-width: 440px; width: 100%; border: 1px solid #334155; }
    h2 { color: #4ade80; margin-top: 0; }
    p { color: #cbd5e1; font-size: 1rem; }
    a { color: #38bdf8; text-decoration: none; display: inline-block; margin-top: 1.5rem; font-weight: 500; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h2>✅ Bot Liberado!</h2>
    <p>O atendimento para <strong>${limpo}</strong> foi encerrado e o bot já voltará a responder.</p>
    <a href="/liberar">Liberar outro número &rarr;</a>
  </div>
</body>
</html>
  `);
});

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
app.post('/webhook/whatsapp', webhookHandler);

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
    dbService.limparMensagensObsoletasEvolution().catch(() => { });
  } catch (err) {
    console.error('❌ Erro ao inicializar o banco de dados:', err);
  }

  // 1. Inicia o scheduler de sincronização diária
  iniciarSyncScheduler();

  // 2. Inicia o worker de inatividade de sessões
  iniciarWorkerInatividade();

  // 3. Inicia o worker de autocura (Watchdog) para monitorar e manter ativo o WhatsApp
  iniciarWorkerWatchdog();

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
