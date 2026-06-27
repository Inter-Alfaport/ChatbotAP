// src/types/index.ts

export interface Colaborador {
  id: string;
  nome: string;
  telefone: string;
  cargo: string;
  departamento: string;
  dataAdmissao: string;
  email: string;
  // Adicione outros campos conforme o retorno da API Solides
}

export interface SaldoFerias {
  diasDisponiveis: number;
  diasAgendados: number;
  periodoAquisitivo: string;
  vencimento: string;
}

export interface ResumoHoras {
  mes: string;
  ano: number;
  diasTrabalhados: number;
  totalRegistros: number;
}

// Estado da sessão salvo no Redis
export interface Sessao {
  telefone: string;
  colaborador: Colaborador | null;
  autenticado: boolean;
  // Histórico de mensagens para contexto da LLM
  historico: Array<{ role: 'user' | 'assistant'; content: string }>;
  // Controle de transbordo
  emTransbordo: boolean;
  transbordoInicio?: number;
  criadoEm: number;
  atualizadoEm: number;
}

// Payload recebido pelo webhook da Evolution API
export interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: {
    key: {
      remoteJid: string;
      fromMe: boolean;
      id: string;
      remoteJidAlt?: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text?: string;
      };
      imageMessage?: {
        caption?: string;
      };
      videoMessage?: {
        caption?: string;
      };
    };
    messageType?: string;
  };
}
