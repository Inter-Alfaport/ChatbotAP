# RH Chatbot — WhatsApp + Solides + Gemini

Chatbot de RH via WhatsApp com integração à plataforma Solides e LLM do Google Gemini.

## Stack

- **Runtime:** Node.js 20 + TypeScript
- **Servidor:** Express
- **LLM:** Gemini 2.5 com Tool Use
- **Sessões:** Redis (Railway Redis Plugin)
- **WhatsApp:** Evolution API
- **Dados:** API Solides
- **Hospedagem:** Railway

---

## Estrutura do projeto

```
src/
├── index.ts                    # Entrada da aplicação
├── types/
│   └── index.ts                # Tipos TypeScript
├── middleware/
│   └── webhook-auth.ts         # Validação do webhook
├── routes/
│   └── webhook.controller.ts   # Orquestração do fluxo principal + APIs de teste
├── services/
│   ├── sessao.service.ts       # Gerenciamento de sessão no Redis
│   ├── solides.service.ts      # Integração com API Solides + mocks
│   ├── evolution.service.ts    # Envio de mensagens via Evolution API
│   └── llm.service.ts          # Integração com Gemini + loop de tools
└── tools/
    └── rh.tools.ts             # Definição e execução das ferramentas da LLM (formato Gemini)
```

---

## Setup local

### 1. Pré-requisitos
- Node.js 20+
- Redis rodando localmente (`docker run -p 6379:6379 redis`)

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar variáveis de ambiente
```bash
cp .env
# Edite o .env com suas credenciais
```

### 4. Rodar em desenvolvimento
```bash
npm run dev
```

### 5. Expor localmente para testes (use ngrok)
```bash
ngrok http 3000
# Use a URL gerada como webhook na Evolution API
```

---

## Deploy no Railway

### 1. Criar projeto no Railway
```bash
railway login
railway init
```

### 2. Adicionar plugin Redis
No dashboard do Railway: **New → Database → Redis**

### 3. Configurar variáveis de ambiente
No dashboard do Railway, adicione todas as variáveis do `.env.example`.
A variável `REDIS_URL` é preenchida automaticamente pelo plugin Redis.

### 4. Deploy
```bash
railway up
```

### 5. Configurar webhook na Evolution API
URL do webhook: `https://seu-projeto.railway.app/webhook/whatsapp`

---

## Fluxo de conversa

```
Mensagem recebida
       │
       ▼
Telefone cadastrado no Solides?
   Não → Mensagem de acesso negado
   Sim → Cria sessão + boas-vindas com menu
       │
       ▼
Colaborador envia pergunta
       │
       ▼
LLM analisa semanticamente e decide qual tool usar:
  - consultar_ferias      → busca na API Solides
  - consultar_holerite    → busca na API Solides
  - consultar_legislacao  → LLM responde com conhecimento próprio
  - solicitar_transbordo  → encaminha para atendente humano
       │
       ▼
LLM humaniza a resposta e envia via Evolution API
```

---

## Adaptando para a API Solides

Os endpoints no `solides.service.ts` são fictícios. Ajuste-os conforme a documentação real:
- `buscarPorTelefone` → endpoint de busca por telefone
- `buscarSaldoFerias` → endpoint de saldo de férias
- `buscarUltimoHolerite` → endpoint de holerite

---

## Adicionando novas funcionalidades

Para adicionar um novo tópico (ex: consulta de ponto):

1. Adicione o tipo de retorno em `src/types/index.ts`
2. Adicione o método em `solides.service.ts`
3. Adicione a tool em `rh.tools.ts` (definição + execução)
4. A LLM automaticamente aprende a usar a nova tool pelo description
