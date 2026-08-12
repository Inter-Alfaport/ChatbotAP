Olhando para os assuntos dos transbordos, eu vejo uma oportunidade muito clara: não tentar fazer o chatbot responder tudo, mas transformar os principais motivos de transbordo em fluxos especializados.

A diferença é importante. Hoje, provavelmente existe uma lógica mais próxima de:

Pergunta → IA tenta responder → se não conseguir → RH

Eu evoluiria para:

Identifica intenção → entra em fluxo específico → coleta contexto → responde ou decide conscientemente pelo transbordo.

Com base nos transbordos que analisamos, eu priorizaria assim:

1. 🥇 Novo sistema de ponto — criar um "especialista de ponto"

Esse é provavelmente o maior potencial de redução de transbordos depois dos problemas técnicos/cadastro.

Aparecem várias dúvidas diferentes sobre o novo sistema:

acesso;
código que não chega;
bloqueio;
registro do ponto;
justificativa;
"Minhas Solicitações";
aplicativo antigo;
quando começar a usar;
problemas no novo aplicativo.

Há inclusive casos em que o colaborador segue as instruções e continua bloqueado, portanto precisamos distinguir dúvida de utilização de problema real do sistema.

Eu criaria um fluxo:

"Você precisa de ajuda com o novo ponto?"

→ Acessar o aplicativo
→ Primeiro acesso
→ Código não chegou
→ Registrar ponto
→ Justificar ponto
→ Minhas Solicitações
→ Ponto bloqueado
→ Outro problema

E o material de apoio que vocês já produziram entra exatamente aqui.

Potencial

Muito alto.

É provavelmente a primeira grande oportunidade de transformar informação que hoje gera transbordo em autoatendimento guiado.

2. 🥈 Salário: separar FAQ de consulta individual

Foram 27 transbordos relacionados a salário/pagamento/holerite.

Mas eu não criaria simplesmente uma FAQ chamada "Salário".

Criaria uma árvore:

💰 Pagamento

Quando vou receber?

→ resposta automática.

Meu pagamento não caiu.

→ verificar data prevista → orientar → se passou do prazo → RH.

Meu salário veio errado.

→ transbordo, porque provavelmente exige consulta individual.

Quero saber meu holerite.

→ orientar acesso, se possível.

Não entendi um desconto.

→ explicar descontos comuns → se desconto específico → RH.

Recebi valor diferente.

→ coletar contexto → RH.

Isso é importante porque parte desses casos não deveria ser automatizada simplesmente adicionando mais conteúdo. Quando a pergunta envolve o salário específico daquela pessoa, o bot precisa de integração com dados individuais ou transbordar.

Os próprios registros mostram perguntas como "Salário veio errado", "meu pagamento não caiu" e dúvidas específicas sobre descontos.

3. 🥉 Cadastro: criar um fluxo de diagnóstico antes do transbordo

Aqui eu faria uma mudança importante.

Hoje, quando o colaborador não é encontrado, o sistema praticamente chega ao fim:

telefone e CPF não constam no banco local. Verifique no Sólides.

Isso é correto do ponto de vista operacional, mas não é uma boa experiência de chatbot.

Antes de transbordar, o bot poderia verificar:

CPF foi informado corretamente?
Telefone é o mesmo cadastrado?
Colaborador entrou recentemente?
Está tentando usar outro número?
Quer atualizar cadastro?

E então:

"Não consegui localizar seu cadastro. Vou encaminhar para o RH verificar seus dados."

E enviar ao RH:

Nome: X
Telefone: X
CPF: validado/não validado
Resultado da busca: não encontrado
Tentativas: 2

Isso transforma um transbordo "cego" em um ticket pré-diagnosticado.

E eu manteria atenção especial às reincidências que encontramos, como Naiara, Alan, Valéria e Cristiano. O caso do Antônio Jorge, que aparece identificado em um atendimento e posteriormente como não identificado, também merece investigação técnica.

4. "Quero falar com o RH" não deveria ser transbordo imediato

Tivemos 19 solicitações explícitas de atendimento humano.

Eu não tentaria impedir essas pessoas de falar com o RH.

Mas faria uma pergunta intermediária:

Claro. Para encaminhar você para a equipe certa, qual assunto precisa tratar?

1 — Pagamento
2 — Ponto
3 — Benefícios
4 — Férias
5 — Cadastro
6 — Outro assunto

Isso gera duas vantagens:

Para o colaborador

Ele chega ao RH mais rapidamente.

Para o RH

O atendente já recebe:

Assunto: Pagamento
Motivo: desconto no holerite
Mensagem: "Quero entender o desconto..."

Em vez de:

"Colaborador solicitou atendimento humano."

5. Criar um "menu de recuperação"

Isso eu considero essencial.

Existem mensagens muito curtas:

"Ponto"

"Salário"

"Conta"

"Reembolso"

"Ok"

O chatbot não deveria interpretar isso necessariamente como erro.

Se alguém escreve:

"Ponto"

responder:

Claro! Sobre qual assunto de ponto você precisa de ajuda?

1. Novo aplicativo
2. Registrar ponto
3. Justificar ocorrência
4. Ponto bloqueado
5. Outro

Isso é muito melhor do que tentar gerar uma resposta livre com IA.

6. Criar "fluxos fechados" para assuntos recorrentes

Eu faria uma distinção na arquitetura:

🧠 IA generativa

Para:

interpretar linguagem natural;
entender intenção;
responder dúvidas gerais;
resumir o problema para o RH.
⚙️ Fluxos estruturados

Para:

CPF;
cadastro;
ponto;
salário;
benefícios;
férias;
reembolso;
transbordo.

Essa combinação é muito mais segura.

Por exemplo, se alguém perguntar:

"Não caiu meu pagamento ainda, alguém sabe me dizer quando vai cair?"

A IA identifica:

Categoria: Pagamento
Intenção: Pagamento não recebido

E o fluxo assume.

7. Criar uma camada de "pré-atendimento"

Essa talvez seja a melhoria mais valiosa para o RH.

Antes de transbordar, o bot deveria tentar descobrir:

Quem?

Colaborador identificado.

O quê?

Categoria.

Qual problema?

Subcategoria.

O que já tentou?

Contexto.

Precisa mesmo de humano?

Sim/não.

Então o RH recebe algo como:

NOVO ATENDIMENTO
👤 João Silva
📌 Ponto
🔴 Ponto bloqueado

O colaborador tentou justificar a ocorrência pelo aplicativo, mas continua bloqueado.

Tentativas: 2
Material de orientação enviado: sim

Esse é um salto enorme de qualidade em relação ao transbordo atual.

8. Criar uma base de conhecimento orientada a perguntas

Eu evitaria montar a base como um manual.

Em vez de:

"Aplicativo Tangerino — Procedimentos"

Criaria conteúdos orientados a intenção:

Como faço para registrar meu ponto?

Não recebi o código do aplicativo. O que faço?

Meu ponto está bloqueado.

Como justifico uma falta?

Onde vejo minhas solicitações?

Quando devo parar de usar o aplicativo antigo?

Isso melhora muito a recuperação semântica da IA.

9. Usar os próprios transbordos para alimentar a evolução

Essa é a parte que eu acho que pode transformar o projeto.

Toda vez que ocorrer um transbordo, o sistema deveria perguntar internamente:

Por que o bot não resolveu?

A — Informação não existe na base

→ criar conteúdo.

B — Informação existe, mas bot não encontrou

→ melhorar instrução/prompt/RAG.

C — Informação existe, mas exige dado individual

→ integrar sistema.

D — Problema operacional

→ RH precisa resolver.

E — Usuário queria humano

→ comportamento esperado.

F — Erro técnico

→ engenharia.

Assim, você começa a criar um ciclo de melhoria contínua.

10. Eu criaria um "score de automatização"

Esse seria um indicador muito legal para o dashboard futuro.

Para cada motivo de transbordo:

Assunto	Transbordos	Potencial de automação
Novo ponto	30*	🟢 Alto
Data de pagamento	12*	🟢 Alto
Holerite	8*	🟡 Médio
Pagamento incorreto	7*	🔴 Baixo
Cadastro não encontrado	20	🟡 Médio
Pedido de RH	19	🟡 Médio

*Valores ilustrativos de subdivisão, não números adicionais extraídos do arquivo.

Isso permite ao cliente enxergar:

"Dos 100 transbordos desta semana, 38 têm potencial de serem eliminados com melhorias no chatbot."

Essa é uma métrica comercial e operacionalmente muito forte.

Minha prioridade para o seu projeto

Se você fosse implementar só cinco melhorias agora, eu faria:

① Novo Ponto

Transformar o material recém-criado em um fluxo completo de autoatendimento.

② Salário

Criar uma árvore de decisão diferenciando dúvida geral × consulta individual.

③ Cadastro

Criar diagnóstico automático antes de enviar ao RH.

④ Pedido de humano

Perguntar o assunto antes de transferir.

⑤ Menu de recuperação

Para mensagens curtas/ambíguas, não responder genericamente e não transbordar imediatamente.

E tem uma mudança conceitual que eu faria no bot

Hoje, o objetivo parece ser:

"Responder à pergunta do colaborador."

Eu mudaria para:

"Resolver a necessidade do colaborador."

São coisas diferentes.

Se alguém pergunta:

"Meu ponto está bloqueado."

O bot não precisa apenas explicar o procedimento.

Ele precisa tentar descobrir:

Por quê? → O que a pessoa tentou? → Conseguiu? → Ainda está bloqueado?

Se resolveu → acabou.

Se não resolveu → transbordo contextualizado.

Esse modelo vai reduzir o volume de transbordos e, principalmente, melhorar muito a qualidade daqueles que continuarem existindo. E é exatamente aí que a nova camada de métricas/dashboard que discutimos começa a ficar extremamente valiosa.