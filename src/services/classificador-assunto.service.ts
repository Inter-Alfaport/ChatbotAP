import { GoogleGenAI } from '@google/genai';
import {
  CategoriaAssunto,
  MAP_MENU_PARA_ASSUNTO,
  normalizarCategoriaAssunto,
  CATEGORIAS_ASSUNTO,
} from '../utils/categorias-assunto';
import { PROMPT_CLASSIFICADOR_ASSUNTO } from '../prompts/classificador-assunto';
import { dbService } from './db.service';
import { log } from '../utils/logger';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELO = 'gemini-2.5-flash';

export interface ClassificarAssuntoInput {
  atendimentoId?: string;
  historico?: Array<{ role: 'user' | 'assistant'; content: string }>;
  categoriaMenu?: string;
  motivoTransbordo?: string;
  diagnostico?: string;
  fluxoAtivo?: 'geral' | 'ponto';
  ultimaMensagem?: string;
  persistir?: boolean;
}

function classificarHeuristica(input: ClassificarAssuntoInput): CategoriaAssunto {
  const fromMenu = normalizarCategoriaAssunto(input.categoriaMenu);
  if (fromMenu) return fromMenu;

  if (input.fluxoAtivo === 'ponto') return 'Ponto Eletrônico';

  const texto = [
    input.motivoTransbordo,
    input.diagnostico,
    input.ultimaMensagem,
    ...(input.historico?.map((h) => h.content) ?? []),
  ]
    .join(' ')
    .toLowerCase();

  if (/aviso pr[eé]vio|rescis[aã]o|demiss[aã]o|desligamento|pedir as contas|acerto rescis[oó]rio|termo de rescis[aã]o/.test(texto)) {
    return 'Aviso Prévio';
  }
  if (/13[oº]?\s*(sal[aá]rio|salario)?|d[eé]cimo terceiro|gratifica[cç][aã]o natalina/.test(texto)) {
    return 'Décimo Terceiro';
  }
  if (/ponto|tangerino|s[oó]lides|batida|registro|espelho|rdih|n5ynm|esqueci o ponto|ajuste de ponto/.test(texto)) {
    return 'Ponto Eletrônico';
  }
  if (/benef[ií]cio|vr|vt|vale refei|vale trans|plano de sa[uú]de|odontol[oó]gico|alimenta[cç][aã]o/.test(texto)) {
    return 'Benefícios (VR / VT)';
  }
  if (/f[eé]rias|recesso|abono pecuni[aá]rio/.test(texto)) {
    return 'Férias';
  }
  if (/sal[aá]rio|holerite|contracheque|pagamento|desconto|folha|adiantamento|banco de horas|hora extra/.test(texto)) {
    return 'Salário e Pagamento';
  }
  if (/cadastro|cpf|dados pessoais|identifica|n[aã]o identificado|n[aã]o cadastrado|curr[ií]culo|vaga|admiss[aã]o|documento/.test(texto)) {
    return 'Identificação / Cadastro';
  }

  return 'Outros';
}

export const classificadorAssuntoService = {
  async classificar(input: ClassificarAssuntoInput): Promise<CategoriaAssunto> {
    const fallback = classificarHeuristica(input);

    if (!process.env.GEMINI_API_KEY) return fallback;

    try {
      const historicoTexto = (input.historico ?? [])
        .slice(-12)
        .map((h) => `${h.role === 'user' ? 'Colaborador' : 'Bot'}: ${h.content}`)
        .join('\n');

      const prompt = PROMPT_CLASSIFICADOR_ASSUNTO({
        categorias: CATEGORIAS_ASSUNTO,
        categoriaMenu: input.categoriaMenu,
        motivoTransbordo: input.motivoTransbordo,
        diagnostico: input.diagnostico,
        ultimaMensagem: input.ultimaMensagem,
        historico: historicoTexto,
        fluxoAtivo: input.fluxoAtivo,
      });

      const response = await ai.models.generateContent({
        model: MODELO,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json' },
      });

      const parsed = JSON.parse(response.text || '{}');
      const categoria = normalizarCategoriaAssunto(parsed.categoria);
      if (categoria) return categoria;
    } catch (err: any) {
      console.error('[Classificador] Erro LLM:', err?.message ?? err);
      log('llm_error', { contexto: 'classificador_assunto', erro: err?.message });
    }

    return fallback;
  },

  async classificarEPersistir(input: ClassificarAssuntoInput): Promise<CategoriaAssunto> {
    let {
      atendimentoId,
      historico,
      categoriaMenu,
      motivoTransbordo,
      diagnostico,
      fluxoAtivo,
      ultimaMensagem,
      persistir
    } = input;

    if (atendimentoId) {
      try {
        const atendimento = await dbService.buscarAtendimentoPorId(atendimentoId);
        if (atendimento) {
          categoriaMenu = categoriaMenu ?? atendimento.categoria;
          motivoTransbordo = motivoTransbordo ?? atendimento.motivo_transbordo;
        }
      } catch (err: any) {
        console.error('[Classificador] Erro ao buscar atendimento para classificar:', err?.message ?? err);
      }

      if (!historico || historico.length === 0) {
        try {
          historico = await dbService.buscarHistoricoConversa(atendimentoId);
        } catch (err: any) {
          console.error('[Classificador] Erro ao buscar historico para classificar:', err?.message ?? err);
        }
      }
    }

    if (historico && historico.length > 0 && !ultimaMensagem) {
      const ult = historico[historico.length - 1];
      if (ult && ult.role === 'user') {
        ultimaMensagem = ult.content;
      }
    }

    const categoria = await this.classificar({
      atendimentoId,
      historico,
      categoriaMenu,
      motivoTransbordo,
      diagnostico,
      fluxoAtivo,
      ultimaMensagem,
    });

    if (atendimentoId && persistir !== false) {
      try {
        await dbService.atualizarAtendimento(atendimentoId, {
          categoria_assunto: categoria,
        });
      } catch (err: any) {
        console.error('[Classificador] Erro ao persistir categoria_assunto:', err?.message ?? err);
      }
    }

    return categoria;
  },

  /** Mapeia escolha do menu para categoria canônica (sem LLM). */
  fromMenu(categoriaMenu: string): CategoriaAssunto {
    return MAP_MENU_PARA_ASSUNTO[categoriaMenu] ?? 'Outros';
  },
};
