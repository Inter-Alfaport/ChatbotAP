Vamos fazer o deploy completo no Railway. Siga a sequência abaixo sem pular etapas.

## Pré-requisitos — confirme antes de começar

Verifique se as ferramentas necessárias estão instaladas:


railway --version
git --version


Se `railway` não estiver instalado:

npm install -g @railway/cli


Se `git` não estiver instalado, me avise — vamos precisar para o deploy.

---

## Etapa 1 — Login e vinculação ao projeto Railway


railway login

Isso vai abrir o navegador para autenticação. Confirme quando estiver logado e então:

railway link


Selecione o projeto e o ambiente (production). Me confirme o nome do projeto que apareceu.

---

## Etapa 2 — Verificar variáveis de ambiente no Railway

Antes de subir o código, confirme que todas as variáveis do `.env` local já foram configuradas no painel do Railway. Rode:

railway variables

Verifique se estas estão presentes (não mostre os valores, só os nomes):
- `GEMINI_API_KEY`
- `REDIS_URL`
- `EVOLUTION_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `SOLIDES_BASE_URL`
- `SOLIDES_TOKEN`
- `GRUPO_RH_ID`
- `WEBHOOK_SECRET`
- `DB_PATH`
- `SESSION_TTL_MINUTES`
- `TRANSBORDO_TTL_HORAS`
- `COMANDO_LIBERAR`

Se alguma estiver faltando, me avise com a lista do que falta antes de continuar.
Não tente setar variáveis via CLI sem me perguntar primeiro — prefiro fazer pelo painel.

---

## Etapa 3 — Inicializar git e fazer o deploy

O Railway faz deploy via git. Rode:

git init
git add .
git commit -m "feat: chatbot RH v1 - deploy inicial"
railway up

Acompanhe o output do deploy e me informe:
- Se o build TypeScript passou sem erros
- Se o servidor subiu com sucesso
- A URL gerada pelo Railway (formato: `https://xxx.railway.app`)
- Qualquer warning ou erro que aparecer nos logs

---

## Etapa 4 — Verificar que o servidor está respondendo

Com a URL do Railway em mãos, teste o health check:


curl https://SUA_URL.railway.app/health


O retorno esperado é algo como:
json
{
  "status": "ok",
  "timestamp": "...",
  "banco": { "total": 0, "ativos": 0, "comTelefone": 0 },
  "ultimoSync": null
}
```

Note que o banco vai aparecer zerado — isso é esperado, a carga em produção vem na próxima etapa.

Se o health check não responder ou retornar erro, me mostre os logs antes de continuar:
```bash
railway logs
```

---

## Etapa 5 — Carga inicial em produção

Com o servidor respondendo, rode a carga inicial no ambiente Railway:

```bash
railway run npm run seed
```

Acompanhe e me informe o mesmo que na carga local:
- Total de colaboradores importados
- Quantos com telefone
- Se houve erros

Após a carga, confirme que o health check agora mostra os dados corretos:

```bash
curl https://SUA_URL.railway.app/health
```

O campo `banco` deve agora mostrar os colaboradores importados.

---

## Etapa 6 — Configurar webhook na Evolution API

Com a URL do Railway confirmada, precisamos registrar o webhook na Evolution para que as mensagens do WhatsApp cheguem ao bot.

Rode o seguinte curl (substitua os valores):

```bash
curl -X POST https://SUA_EVOLUTION_URL/webhook/set/SUA_INSTANCIA \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://SUA_URL.railway.app/webhook/whatsapp",
    "webhook_by_events": false,
    "webhook_base64": false,
    "events": [
      "MESSAGES_UPSERT"
    ]
  }'
```

**Não execute este comando ainda** — me mostre o comando montado com os valores reais (mascarando as credenciais) para eu revisar antes.

---

## Etapa 7 — Teste end-to-end

Com tudo configurado, vamos testar o fluxo completo:

1. Mande uma mensagem de texto para o número do WhatsApp conectado na Evolution
2. Monitore os logs em tempo real:
   ```bash
   railway logs --tail
   ```
3. Me mostre o que apareceu nos logs após a mensagem ser enviada

O fluxo esperado nos logs:
```
[Webhook] Mensagem recebida de 5521XXXXXXXX
[DB] Colaborador encontrado: Nome do Colaborador
[Evolution] Mensagem enviada
```

Se não aparecer nada nos logs após enviar a mensagem, o webhook não está chegando — me avise para investigarmos.

---

## Etapa 8 — Relatório final de deploy

Ao concluir, me dê um resumo com:

- ✅ ou ❌ para cada etapa
- URL final do bot em produção
- Número de colaboradores no banco de produção
- Confirmação de que o webhook está registrado na Evolution
- Status do primeiro teste de mensagem
- Qualquer item pendente ou que precisou de ajuste manual

---

## Regras

- Nunca mostre valores de credenciais nos outputs — mascare com `***`
- Se qualquer etapa falhar, pare e me explique o erro completo antes de tentar qualquer correção
- Não tente corrigir erros de deploy automaticamente — me consulte primeiro
- Se os logs mostrarem erro 500 ou similar, copie o stack trace completo antes de qualquer ação
- O `DB_PATH` no Railway precisa apontar para um volume persistente — se não tiver volume configurado, me avise antes da carga em produção, pois o banco seria perdido a cada redeploy