// src/services/llm.service.ts
import { GoogleGenAI } from '@google/genai';
import { rhTools, executarTool } from '../tools/rh.tools';
import KNOWLEDGE_BASE from '../knowledge/base';
import { Colaborador } from '../types';
import { log } from '../utils/logger';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Lista de prioridade de modelos para fallback em caso de erro 429 / ResourceExhausted
const MODELOS_FALLBACK = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

function ehErroLimiteCota(err: any): boolean {
  const status = err?.status ?? err?.statusCode ?? err?.code ?? err?.response?.status;
  if (status === 429) return true;

  const msg = (err?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resourceexhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

/**
 * Executa generateContent com fallback sequencial em caso de erro de cota (429).
 */
async function gerarConteudoComFallback(contents: any[], config: any) {
  let ultimoErro: any = null;

  for (const model of MODELOS_FALLBACK) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config,
      });
      return response;
    } catch (err: any) {
      ultimoErro = err;
      if (ehErroLimiteCota(err)) {
        console.warn(
          `[LLM] Modelo '${model}' atingiu limite de cota/requisições (429/ResourceExhausted). Tentando próximo modelo...`
        );
        continue;
      }
      throw err;
    }
  }

  throw ultimoErro;
}

const SYSTEM_PROMPT = (colaborador: Colaborador) => `
# BASE DE CONHECIMENTO (KNOWLEDGE_BASE)
${KNOWLEDGE_BASE}

Você é a Alice, assistente virtual de RH da empresa.
Você está atendendo o colaborador ${colaborador.nome}, que trabalha como ${colaborador.cargo} no departamento de ${colaborador.departamento} desde ${colaborador.dataAdmissao}.

Diretrizes:
- Seja sempre cordial, claro e objetivo.
- Responda em português brasileiro.
- Use as ferramentas disponíveis para buscar informações reais — nunca invente dados.
- Para dúvidas sensíveis (demissão, denúncias, questões jurídicas complexas), sempre use a ferramenta solicitar_transbordo.
- Ao apresentar valores monetários, use o formato R$ 0.000,00.
- Ao apresentar datas, use o formato DD/MM/AAAA.
- Mantenha respostas concisas para WhatsApp — evite textos muito longos.
- Use emojis com moderação para tornar a conversa mais amigável.
`;

export interface RespostaLLM {
  texto: string;
  transbordo?: boolean;
  motivoTransbordo?: string;
}

export const llmService = {
  async processar(
    mensagem: string,
    historico: Array<{ role: 'user' | 'assistant'; content: string }>,
    colaborador: Colaborador
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

      const config = {
        systemInstruction: SYSTEM_PROMPT(colaborador),
        tools: [{ functionDeclarations: rhTools }],
      };

      // Primeira chamada ao Gemini com fallback
      let response = await gerarConteudoComFallback(contents, config);

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

        // Chama novamente com as respostas das funções (usando fallback)
        response = await gerarConteudoComFallback(contents, config);
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
      };
    }
  },
};
