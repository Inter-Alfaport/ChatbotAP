// src/services/llm.service.ts
import { GoogleGenAI } from '@google/genai';
import { rhTools, executarTool } from '../tools/rh.tools';
import KNOWLEDGE_BASE from '../knowledge/base';
import { PROMPT_ESPECIALISTA_PONTO } from '../prompts/especialista-ponto';
import { Colaborador } from '../types';
import { log } from '../utils/logger';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELO_PADRAO = 'gemini-2.5-flash';

const SYSTEM_PROMPT = (colaborador: Colaborador) => `
# BASE DE CONHECIMENTO (KNOWLEDGE_BASE)
${KNOWLEDGE_BASE}

Você é a Alice, assistente virtual de RH da empresa.
Você está atendendo o colaborador ${colaborador.nome}, que trabalha como ${colaborador.cargo} no departamento de ${colaborador.departamento} desde ${colaborador.dataAdmissao}.

Diretrizes:
- Seja sempre cordial, claro e objetivo.
- Responda em português brasileiro.
- Use as ferramentas disponíveis para buscar informações reais — nunca invente dados.
- Se o colaborador fizer uma pergunta muito curta, vaga ou ambígua (ex: "férias" ou "salário"), não faça transbordo imediatamente. Faça perguntas de esclarecimento de forma curta e simpática para entender a necessidade (máximo 2 perguntas de esclarecimento).
- Para dúvidas sensíveis (demissão, denúncias, questões jurídicas complexas) ou se após esclarecer verificar que exige ação manual do RH, use a ferramenta solicitar_transbordo.
- Ao usar a ferramenta solicitar_transbordo, descreva o campo 'diagnostico' com o resumo detalhado da necessidade do colaborador.
- Ao apresentar valores monetários, use o formato R$ 0.000,00.
- Ao apresentar datas, use o formato DD/MM/AAAA.
- Mantenha respostas concisas para WhatsApp — evite textos muito longos.
- Use emojis com moderação para tornar a conversa mais amigável.
`;

export interface RespostaLLM {
  texto: string;
  transbordo?: boolean;
  motivoTransbordo?: string;
  diagnostico?: string;
}

export const llmService = {
  async processar(
    mensagem: string,
    historico: Array<{ role: 'user' | 'assistant'; content: string }>,
    colaborador: Colaborador,
    fluxoAtivo?: 'geral' | 'ponto'
  ): Promise<RespostaLLM> {
    const inicio = Date.now();

    try {
      // Monta o array de mensagens com o histórico completo no formato do Gemini
      const contents: any[] = [
        ...historico.map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.content }],
        })),
        { role: 'user', parts: [{ text: mensagem }] },
      ];

      const systemInstruction = fluxoAtivo === 'ponto'
        ? PROMPT_ESPECIALISTA_PONTO(colaborador)
        : SYSTEM_PROMPT(colaborador);

      const config = {
        systemInstruction,
        tools: [{ functionDeclarations: rhTools }],
      };

      // Chamada direta ao Gemini 2.5 Flash
      let response = await ai.models.generateContent({
        model: MODELO_PADRAO,
        contents,
        config,
      });

      // Loop de tool use: continua enquanto o modelo solicitar execução de funções
      while (response.functionCalls && response.functionCalls.length > 0) {
        const modelParts: any[] = [];
        const functionParts: any[] = [];

        for (const call of response.functionCalls) {
          if (!call.name) continue;

          modelParts.push({
            functionCall: { name: call.name, args: call.args },
          });

          const toolResult = await executarTool(
            call.name,
            call.args as Record<string, unknown>,
            colaborador
          );

          // Verifica se é transbordo (marcador especial retornado pelo executor)
          try {
            const parsed = JSON.parse(toolResult);
            if (parsed._transbordo) {
              log('llm_call', { duracao_ms: Date.now() - inicio, tool: call.name, transbordo: true });
              return {
                texto: `Entendido! Vou te encaminhar para um de nossos atendentes humanos agora. Um momento... 🔄`,
                transbordo: true,
                motivoTransbordo: parsed.motivo,
                diagnostico: parsed.diagnostico,
              };
            }
          } catch {
            // não é JSON de controle, segue normal
          }

          functionParts.push({
            functionResponse: {
              name: call.name,
              response: { result: toolResult },
            },
          });
        }

        // Adiciona a requisição de funções do modelo e as respostas de execução
        contents.push({ role: 'model', parts: modelParts });
        contents.push({ role: 'function', parts: functionParts });

        // Chama novamente com as respostas das funções
        response = await ai.models.generateContent({
          model: MODELO_PADRAO,
          contents,
          config,
        });
      }

      // Extrai o texto final da resposta
      const textoFinal = response.text || '';
      log('llm_call', { duracao_ms: Date.now() - inicio, transbordo: false });
      return { texto: textoFinal };

    } catch (err: any) {
      // Falha na API Gemini — aciona transbordo automático em vez de silêncio
      console.error('[LLM] Falha na API Gemini:', err?.message ?? err);
      log('llm_error', { duracao_ms: Date.now() - inicio, erro: err?.message });
      return {
        texto: 'Estou com uma instabilidade agora. Vou te conectar com a equipe. 🙏',
        transbordo: true,
        motivoTransbordo: 'Falha na API Gemini',
        diagnostico: 'Ocorreu um erro técnico na comunicação com a API do Gemini.',
      };
    }
  },
};
