# Evolução da lógica de atendimento do chatbot RH

Quero alterar a lógica de atendimento do chatbot de RH para que ele deixe de ser excessivamente conservador e passe a trabalhar com uma lógica de **identificação de intenção → esclarecimento → tentativa de resolução → diagnóstico → transbordo contextualizado**.

## 1. Problema atual

Hoje o comportamento está muito próximo de:

> Pergunta → procura resposta na base → se não encontrar resposta suficientemente explícita → transbordo.

Isso está fazendo o chatbot desistir da conversa cedo demais.

A ausência de uma resposta literal na Base de Conhecimento **não significa necessariamente que o atendimento deva ser transferido para o RH**.

Muitas vezes o usuário apenas não forneceu contexto suficiente.

Exemplo:

Usuário:
> "Meu ponto não está funcionando."

Isso não deve gerar transbordo imediato.

O chatbot deve primeiro descobrir qual é o problema:

- não consegue acessar o aplicativo;
- não consegue registrar o ponto;
- esqueceu de bater;
- precisa justificar;
- está com uma solicitação pendente;
- recebeu uma mensagem de erro;
- outro problema.

Somente depois de entender a situação deve decidir se consegue resolver ou se precisa do RH.

---

# 2. Nova filosofia de atendimento

O objetivo do chatbot não deve ser:

> "Responder à pergunta do colaborador."

O objetivo deve ser:

> **"Resolver a necessidade do colaborador da forma mais completa possível antes de recorrer ao atendimento humano."**

Portanto, a ausência de uma resposta imediata deve iniciar uma etapa de investigação, e não automaticamente um transbordo.

A lógica desejada é:

```text
Mensagem do usuário
        ↓
Identificar intenção
        ↓
A intenção está clara?
   ┌────┴────┐
  NÃO       SIM
   ↓          ↓
Perguntar    Verificar conhecimento/
contexto     fluxo disponível
                ↓
          É possível orientar?
          ┌─────┴─────┐
         SIM          NÃO
          ↓             ↓
      Orientar      Há contexto
          ↓         suficiente?
    Verificar           ↓
     resultado      NÃO → perguntar
          ↓             ↓
      Resolveu?      SIM → diagnosticar
      ┌───┴───┐
     SIM      NÃO
      ↓         ↓
   Encerrar   Continuar diagnóstico
                 ↓
          Depende de RH/dado
          individual/ação humana?
              ┌────┴────┐
             NÃO       SIM
              ↓          ↓
        Continuar     Transbordar
        tentativa     contextualizado
```

---

# 3. Regra principal de transbordo

NÃO utilizar mais uma regra simples como:

> "Se a pergunta não puder ser respondida com o conteúdo da base, faça transbordo."

Substituir por uma lógica mais criteriosa:

> **Se a pergunta não puder ser respondida imediatamente, primeiro tente identificar a intenção do usuário e coletar o contexto necessário para determinar se o caso pode ser resolvido pelo chatbot. O transbordo deve ocorrer somente quando ficar claro que a resolução depende de informação não disponível, consulta de dados individuais, ação/autorização do RH, problema técnico que não pode ser resolvido pelo fluxo ou situação explicitamente fora do escopo.**

Importante:

**Não transbordar simplesmente porque a resposta exata não está escrita na Base de Conhecimento.**

---

# 4. Classificação das situações

O sistema deve distinguir pelo menos estas situações:

### A. Resolução direta

Existe informação suficiente na Base de Conhecimento para responder.

→ Responder.

### B. Falta de contexto

O assunto parece estar dentro do escopo, mas a mensagem é vaga.

→ Fazer uma pergunta objetiva para identificar a necessidade.

Exemplo:

> "Ponto"

Responder:

> "Claro! Sobre o ponto, você precisa de ajuda para registrar o ponto, justificar/ajustar uma ocorrência, acessar o aplicativo ou está com outro problema?"

Não transbordar.

### C. Procedimento conhecido + problema específico

Existe um procedimento na base, mas o usuário informa que está tendo dificuldade.

→ Orientar o procedimento e tentar diagnosticar o problema.

Exemplo:

> "Não consigo registrar meu ponto."

Perguntar:

> "Você consegue entrar normalmente no aplicativo Sólides ou o problema acontece somente quando tenta registrar o ponto?"

### D. Necessidade de informação individual

A resposta depende de dados específicos daquele colaborador.

Exemplos:

- saldo de férias;
- registro individual de ponto;
- holerite específico;
- situação individual de pagamento.

→ Utilizar a ferramenta disponível, quando existir.

Se não houver ferramenta ou acesso ao dado necessário:

→ Transbordar.

### E. Ação humana necessária

O usuário precisa que alguém:

- corrija cadastro;
- altere uma informação;
- corrija pagamento;
- analise um caso específico;
- resolva um problema que não pode ser solucionado pelo chatbot.

→ Transbordar.

### F. Fora do escopo

O assunto realmente não pode ser tratado pelo chatbot.

→ Transbordar.

---

# 5. Limite de diagnóstico

O chatbot deve tentar resolver o problema, mas não deve ficar fazendo perguntas indefinidamente.

Estabelecer um limite de aproximadamente **2 a 3 interações relevantes de esclarecimento/diagnóstico**.

Se depois disso:

- a intenção continuar indefinida;
- o usuário não fornecer informações suficientes;
- o problema continuar sem solução;
- ou ficar evidente que a resolução depende do RH;

→ fazer o transbordo.

A regra é:

> **Não desistir cedo, mas também não insistir indefinidamente.**

---

# 6. Fluxos especializados

Sempre que uma intenção recorrente puder ser reconhecida, preferir um fluxo estruturado em vez de uma resposta genérica de IA.

Prioridade inicial:

## PONTO

Criar um fluxo específico para assuntos relacionados ao ponto.

Quando o usuário mencionar ponto, identificar uma das categorias:

1. Registrar ponto
2. Acessar aplicativo
3. Código/PIN
4. Ponto não registrado
5. Ponto em atraso
6. Justificar ocorrência
7. Ajustar ponto
8. Minhas Solicitações
9. Afastamento
10. Erro/problema no aplicativo
11. Outro problema

O fluxo deve usar a Base de Conhecimento e o material operacional da Sólides disponível no projeto como fonte de orientação.

IMPORTANTE:

Não inventar passos, nomes de botões, prazos ou funcionalidades.

Se houver divergência entre versões/documentos sobre a interface do aplicativo, não escolher uma versão arbitrariamente. Sinalizar a inconsistência ou utilizar somente a informação cuja validade esteja definida no projeto.

---

# 7. Exemplo de comportamento desejado para PONTO

Usuário:

> "Meu ponto está bloqueado."

Não responder imediatamente:

> "Vou transferir você para o RH."

Em vez disso:

> "Entendi. Vamos verificar isso. Você consegue acessar o aplicativo normalmente ou o bloqueio acontece quando tenta registrar o ponto?"

Se o usuário disser:

> "Consigo entrar, mas não consigo registrar."

Continuar:

> "Entendi. Quando você tenta registrar o ponto, aparece alguma mensagem de erro?"

A partir da resposta, tentar orientar usando a informação disponível.

Se não for possível resolver:

> "Entendi. Já verificamos que você consegue acessar o aplicativo, mas o registro do ponto continua apresentando problema. Vou encaminhar seu atendimento para o RH verificar a situação."

O transbordo deve carregar o contexto coletado.

---

# 8. Mensagens curtas ou ambíguas

Mensagens muito curtas não devem ser consideradas automaticamente falha ou motivo de transbordo.

Exemplos:

- "Ponto"
- "Salário"
- "Conta"
- "Reembolso"
- "Férias"

Nesses casos, o chatbot deve utilizar um **menu de recuperação/contextualização**.

Exemplo:

Usuário:

> "Salário"

Bot:

> "Claro! Sobre pagamento, você quer saber a data de pagamento, acessar seu holerite, entender um desconto ou está com algum problema no pagamento?"

O objetivo é transformar uma mensagem ambígua em uma intenção identificável.

---

# 9. Solicitação explícita de atendimento humano

Se o usuário disser:

> "Quero falar com o RH."

Não impedir o acesso ao atendimento humano.

Porém, antes de transferir, perguntar:

> "Claro. Para encaminhar você para a equipe certa, qual assunto precisa tratar?"

Oferecer categorias como:

1. Pagamento
2. Ponto
3. Benefícios
4. Férias
5. Cadastro
6. Outro assunto

Se o usuário não quiser informar ou insistir no atendimento humano, fazer o transbordo.

O objetivo não é bloquear o atendimento humano, mas **qualificar o transbordo**.

---

# 10. Transbordo contextualizado

Nunca gerar apenas um evento genérico como:

> "Usuário solicitou atendimento humano."

Sempre que possível, o sistema deve preservar:

- nome do colaborador;
- categoria;
- intenção;
- subcategoria;
- mensagem original;
- contexto coletado;
- perguntas realizadas;
- respostas do usuário;
- procedimento orientado;
- se o usuário tentou o procedimento;
- resultado da tentativa;
- motivo do transbordo.

Exemplo:

```text
NOVO ATENDIMENTO

Colaborador: João Silva

Categoria: Ponto
Intenção: Problema no registro de ponto
Situação: Usuário consegue acessar o aplicativo, mas não consegue registrar o ponto.

Tentativas:
- Orientação de registro enviada
- Usuário tentou realizar o procedimento
- Problema persiste

Motivo do transbordo:
Problema não resolvido pelo fluxo automático.
```


# 11. IA generativa x fluxos estruturados

Não transformar tudo em respostas livres da IA.

Usar IA principalmente para:

- identificar intenção;
- interpretar linguagem natural;
- classificar categoria/subcategoria;
- entender mensagens incompletas;
- decidir qual fluxo deve ser acionado;
- interpretar respostas do usuário;
- resumir o atendimento para o RH.

Usar fluxos estruturados para:

- CPF/cadastro;
- ponto;
- pagamento;
- benefícios;
- férias;
- reembolso;
- justificativas;
- transbordo;
- coleta de dados.

A IA deve funcionar como camada de interpretação e orquestração, enquanto os fluxos estruturados garantem previsibilidade nas situações recorrentes.

---

# 12. Não inventar informações

Essa mudança NÃO significa dar liberdade para a IA inventar respostas.

Continuam valendo rigorosamente as regras:

- nunca inventar valores;
- nunca inventar prazos;
- nunca inventar políticas da empresa;
- nunca inventar procedimentos;
- nunca afirmar que uma funcionalidade existe se isso não estiver confirmado;
- nunca transformar conhecimento geral em regra específica da empresa.

A diferença é:

> **Quando não houver informação suficiente para responder, primeiro tentar descobrir se existe uma pergunta melhor que o usuário possa responder.**

---


# 13. Regra de ouro

A regra mais importante de toda essa alteração é:

> **O chatbot não deve perguntar "Tenho uma resposta exata para essa frase?"**
>
> **Ele deve perguntar "Entendi o que esse colaborador precisa? E consigo ajudá-lo a resolver isso?"**

Se não entendeu → perguntar.

Se entendeu e consegue ajudar → resolver.

Se tentou resolver e não conseguiu → diagnosticar.

Se depende de informação individual, ação humana, problema técnico não solucionável ou assunto fora do escopo → transbordar.

E quando transbordar → entregar ao RH todo o contexto já descoberto.

---

**Não reescreva o sistema inteiro.**

Priorize alterações incrementais e compatíveis com a arquitetura existente.

