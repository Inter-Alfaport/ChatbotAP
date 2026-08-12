# Evolução da Lógica de Atendimento - Roteamento e Fluxos Especializados

Este plano visa transformar o chatbot de uma lógica "Informativa binária" (responde ou transfere) para uma lógica "Resolutiva e Investigativa", implementando Roteamento de Intenção, Menus de Recuperação, e o Fluxo Especialista de Ponto.

## Proposed Changes

### Roteamento e Menu de Recuperação (Webhook)

#### [MODIFY] src/routes/webhook.controller.ts
- **Interceptação de Mensagens Curtas**: Adicionar validação de mensagens curtas/ambíguas (ex: "ponto", "férias", "salário").
- **Alteração do Transbordo por Keyword**: Quando o usuário digitar "falar com humano" ou uma palavra curta, não transbordar imediatamente. Ao invés disso, alterar o `estado` da sessão para `aguardando_assunto_transbordo` e exibir o menu numérico (1- Ponto, 2- Pagamento, etc).
- **Processamento do Menu**: Capturar a resposta numérica, gravar a `categoria` na sessão, e, se for Ponto, alterar `sessao.fluxoAtivo = 'ponto'` e `sessao.tentativasDiagnostico = 0`.
- **Transbordo Contextualizado**: Atualizar `montarNotificacaoRH` e `executarTransbordo` para receber e formatar um `diagnostico` em vez de apenas a última mensagem.

#### [MODIFY] src/types/index.ts
- Adicionar os campos `fluxoAtivo` (string), `categoria` (string) e `tentativasDiagnostico` (number) à interface `Sessao`.

### IA Investigativa e Especialista de Ponto

#### [MODIFY] src/services/evolution-llm.service.ts
- **Remover a regra de transbordo precoce** do prompt geral. Instruir a LLM a realizar até 2 interações de diagnóstico.
- **Orquestração de Fluxo**: Antes de chamar o Gemini, verificar `sessao.fluxoAtivo`.
  - Se for `'ponto'`, substituir o prompt geral pelo **Prompt do Especialista de Ponto** e injetar o `KNOWLEDGE_PONTO`.
- **Forçar Retorno Estruturado (JSON)**: Alterar a chamada do modelo para retornar um objeto JSON com `resposta` (texto pro usuário), `transbordo` (boolean) e `diagnostico` (resumo do caso para o RH).
- Atualizar a lógica do webhook que processa o resultado da LLM para extrair o `diagnostico` JSON e passá-lo ao `executarTransbordo`.

#### [NEW] src/knowledge/conhecimento-ponto.ts
- Migrar o texto bruto de `conhecimentoponto.md` para uma constante TypeScript exportável.

#### [NEW] src/prompts/especialista-ponto.ts
- Criar o *System Prompt* do Especialista em Ponto, instruindo a IA a realizar perguntas diagnósticas focadas em problemas do Sólides/Tangerino e, ao não resolver em 3 interações, gerar o sumário.

## Verification Plan

### Testes Locais e Deploy
- Subir a aplicação via `npm run dev`.
- Testar o fluxo de **Menu de Recuperação**: enviar "ponto" e garantir que o bot responde com o menu de categorias.
- Escolher "1" (Ponto) e verificar se a sessão entra no fluxo ativo e o bot responde pedindo detalhes do problema de ponto.
- Simular um problema (ex: "meu botão de bater ponto sumiu"). A LLM deve fazer até 2 perguntas de diagnóstico (ex: "Você verificou a aba X?").
- Responder algo que força transbordo e validar se o notificador envia o "Resumo/Diagnóstico" estruturado ao grupo do RH.
