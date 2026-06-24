// src/services/llm.service.ts
import { GoogleGenAI } from '@google/genai';
import { rhTools, executarTool } from '../tools/rh.tools';
import KNOWLEDGE_BASE from '../knowledge/base';
import { Colaborador } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = (colaborador: Colaborador) => `
# BASE DE CONHECIMENTO (KNOWLEDGE_BASE)
${KNOWLEDGE_BASE}

Você é o assistente virtual de RH da empresa. Seu nome é "RH Bot".
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
    // Monta o array de mensagens com o histórico completo no formato do Gemini
    const contents: any[] = [
      ...historico.map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: mensagem }] },
    ];

    // Primeira chamada para a LLM
    let response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT(colaborador),
        tools: [{ functionDeclarations: rhTools }],
      },
    });

    // Loop de tool use: continua enquanto a LLM solicitar execução de funções
    while (response.functionCalls && response.functionCalls.length > 0) {
      const modelParts: any[] = [];
      const functionParts: any[] = [];

      for (const call of response.functionCalls) {
        if (!call.name) continue;

        modelParts.push({
          functionCall: {
            name: call.name,
            args: call.args,
          },
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

      // Chama novamente com as respostas das funções
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT(colaborador),
          tools: [{ functionDeclarations: rhTools }],
        },
      });
    }

    // Extrai o texto final da resposta
    const textoFinal = response.text || '';
    return { texto: textoFinal };
  },
};
