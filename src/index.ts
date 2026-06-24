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

const app = express();
const PORT = process.env.PORT || 3000;

// Parsing de JSON
app.use(express.json());

// Servir arquivos estáticos do front-end de teste
app.use(express.static('public'));

// Health check para o Railway saber que está vivo
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
});
