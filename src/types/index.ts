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

export interface Holerite {
  mes: string;
  ano: number;
  salarioBruto: number;
  salarioLiquido: number;
  descontos: Array<{ descricao: string; valor: number }>;
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
  isTest?: boolean; // Se a sessão é simulada via frontend de teste
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
