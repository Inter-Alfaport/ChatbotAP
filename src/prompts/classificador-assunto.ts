import { CategoriaAssunto } from '../utils/categorias-assunto';

export interface PromptClassificadorInput {
  categorias: readonly CategoriaAssunto[];
  categoriaMenu?: string;
  motivoTransbordo?: string;
  diagnostico?: string;
  ultimaMensagem?: string;
  historico?: string;
  fluxoAtivo?: string;
}

export function PROMPT_CLASSIFICADOR_ASSUNTO(input: PromptClassificadorInput): string {
  return `Você classifica atendimentos de RH em UMA categoria de assunto.

Categorias permitidas (use EXATAMENTE um destes valores no JSON):
${input.categorias.map((c) => `- ${c}`).join('\n')}

Contexto do atendimento:
- Categoria escolhida no menu (se houver): ${input.categoriaMenu || 'não informada'}
- Fluxo ativo: ${input.fluxoAtivo || 'geral'}
- Motivo de transbordo (se houver): ${input.motivoTransbordo || 'não informado'}
- Diagnóstico/resumo: ${input.diagnostico || 'não informado'}
- Última mensagem: ${input.ultimaMensagem || 'não informada'}

Histórico recente:
${input.historico || '(sem histórico)'}

Regras:
1. Escolha a categoria que melhor representa o ASSUNTO principal da conversa:
   - Dúvidas sobre rescisão, demissão, pedir demissão, acerto de contas ou aviso prévio → "Aviso Prévio".
   - Dúvidas sobre 13º salário, adiantamento de 13º ou gratificação natalina → "Décimo Terceiro".
   - Dúvidas sobre bater ponto, aplicativo Sólides/Tangerino, RDiH, código N5YNM, esquecimento de batida, horas trabalhadas → "Ponto Eletrônico".
   - Dúvidas sobre salário, holerite, contracheque, banco de horas, horas extras, descontos salariais → "Salário e Pagamento".
   - Dúvidas sobre vale refeição (VR), vale transporte (VT), plano de saúde ou benefícios → "Benefícios (VR / VT)".
   - Dúvidas sobre agendamento de férias, saldo de férias ou recesso → "Férias".
   - Envio de currículo, dúvidas sobre vagas, falha de cadastro, CPF não localizado ou colaborador não identificado → "Identificação / Cadastro".
2. Se o menu já indicar claramente o assunto, confirme ou refine com base no histórico.
3. Use "Outros" APENAS e estritamente quando a mensagem for apenas um cumprimento ("oi", "olá") sem nenhuma pergunta ou quando não houver contexto de assunto de RH.
4. NUNCA use rótulos inventados como "Bot", "Resolvido pelo Bot" ou textos livres.

Responda SOMENTE com JSON válido: {"categoria":"<uma das categorias permitidas>"}`;
}
