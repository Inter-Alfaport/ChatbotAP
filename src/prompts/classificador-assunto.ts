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
1. Escolha a categoria que melhor representa o ASSUNTO principal da conversa.
2. Se o menu já indicar claramente o assunto, confirme ou refine com base no histórico.
3. Falhas de CPF/cadastro → "Identificação / Cadastro".
4. Use "Outros" apenas quando nenhuma categoria se aplicar claramente.
5. NUNCA use rótulos como "Bot", "Resolvido pelo Bot" ou textos livres.

Responda SOMENTE com JSON válido: {"categoria":"<uma das categorias permitidas>"}`;
}
