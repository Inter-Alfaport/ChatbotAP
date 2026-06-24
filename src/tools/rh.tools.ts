import { solidesService } from '../services/solides.service';
import { Colaborador } from '../types';

// Definição das tools para o SDK do Gemini
export const rhTools: any[] = [
  {
    name: 'consultar_ferias',
    description:
      'Consulta registros de férias do colaborador: período, status (APROVADO/PENDENTE) e datas.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'consultar_ponto',
    description:
      'Consulta o resumo de dias trabalhados e registros de ponto do mês atual. ' +
      'IMPORTANTE: a API Solides/Tangerino não fornece dados de salário ou holerite financeiro — ' +
      'apenas registros de ponto eletrônico. Se o colaborador perguntar sobre salário ou holerite, ' +
      'informe que essa informação não está disponível via chatbot e use solicitar_transbordo.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: [],
    },
  },
  {
    name: 'solicitar_transbordo',
    description:
      'Encaminha o colaborador para um atendente humano. Use quando: ' +
      '(1) a dúvida for sensível (demissão, denúncia, assédio, questões jurídicas), ' +
      '(2) o colaborador perguntar sobre salário, holerite ou benefícios financeiros, ' +
      '(3) não conseguir resolver a dúvida com as ferramentas disponíveis.',
    parameters: {
      type: 'OBJECT',
      properties: {
        motivo: {
          type: 'STRING',
          description: 'Motivo do encaminhamento para o atendente humano',
        },
      },
      required: ['motivo'],
    },
  },
  {
    name: 'consultar_legislacao',
    description:
      'Responde perguntas sobre legislação trabalhista brasileira: CLT, FGTS, 13º salário, ' +
      'aviso prévio, licenças maternidade/paternidade, horas extras, intervalos, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pergunta: {
          type: 'STRING',
          description: 'A pergunta sobre legislação trabalhista',
        },
      },
      required: ['pergunta'],
    },
  },
];

// Executor: recebe o nome da tool e executa a ação correspondente
export async function executarTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  colaborador: Colaborador
): Promise<string> {
  switch (toolName) {
    case 'consultar_ferias': {
      const ferias = await solidesService.buscarSaldoFerias(colaborador.id);
      if (!ferias) return 'Não foi possível buscar as informações de férias no momento.';
      return JSON.stringify(ferias);
    }

    case 'consultar_ponto': {
      const ponto = await solidesService.buscarResumoHoras(colaborador.id);
      if (!ponto) return 'Não foi possível buscar os registros de ponto no momento.';
      return JSON.stringify(ponto);
    }

    case 'solicitar_transbordo': {
      // Retorna marcador especial interceptado pelo controller
      return JSON.stringify({
        _transbordo: true,
        motivo: toolInput.motivo,
      });
    }

    case 'consultar_legislacao': {
      // A LLM responde com conhecimento próprio
      return JSON.stringify({
        _responderDiretamente: true,
        pergunta: toolInput.pergunta,
      });
    }

    default:
      return 'Ferramenta não reconhecida.';
  }
}
