// src/types/index.ts

export interface Colaborador {
  id: string;
  nome: string;
  telefone: string;
  cargo: string;
  departamento: string;
  dataAdmissao: string;
  email: string;
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

export interface Atendimento {
  id: string;
  telefone: string;
  colaboradorId?: number;
  nomeColaborador?: string;
  canal: string;
  status: 'aberto' | 'em_transbordo' | 'em_atendimento' | 'encerrado';
  
  dataInicio: Date;
  dataUltimaInteracao?: Date;
  qtdMensagensUsuario: number;
  qtdRespostasBot: number;
  intencao?: string;
  categoria?: string;
  subcategoria?: string;
  resolvidoPeloBot?: boolean;

  houveTransbordo: boolean;
  dataTransbordo?: Date;
  motivoTransbordo?: string;
  origemTransbordo?: string;

  atendenteTelefone?: string;
  dataAssumido?: Date;
  dataPrimeiraResposta?: Date;
  dataEncerramento?: Date;
  qtdMensagensAtendente: number;

  colaboradorIdentificado: boolean;
  motivoNaoIdentificacao?: string;

  avaliacaoNota?: number;
  avaliacaoRespondida: boolean;
  criadoEm: Date;
}

export interface AtendimentoEvento {
  id: number;
  atendimentoId: string;
  tipo: string;
  timestamp: Date;
  usuario?: string;
  metadata?: any;
}

// Estado da sessão salvo no Redis
export interface Sessao {
  telefone: string;
  colaborador: Colaborador | null;
  autenticado: boolean;
  // Histórico de mensagens para contexto da LLM
  historico: Array<{ role: 'user' | 'assistant'; content: string }>;
  // Controle de transbordo (colaborador pediu atendimento humano)
  emTransbordo: boolean;
  transbordoInicio?: number;
  // Modo atendente: bot silenciado porque um atendente iniciou a conversa
  modoAtendente?: boolean;
  modoAtendenteTTL?: number; // timestamp epoch do momento de ativação
  criadoEm: number;
  atualizadoEm: number;
  // Triagem de entrada — estados possíveis durante a autenticação
  estado?: 'aguardando_cpf' | 'aguardando_motivo' | 'aguardando_dados_colaborador' | 'aguardando_avaliacao' | 'aguardando_assunto_transbordo';
  tentativas_cpf?: number; // contador de tentativas inválidas de CPF (zerado ao autenticar)
  atendimentoId?: string; // Vinculo com o atendimento ativo no analytics
  fluxoAtivo?: 'geral' | 'ponto';
  categoria?: string;
  tentativasDiagnostico?: number;
  tentativas_avaliacao?: number;   // contador de respostas inválidas no estado aguardando_avaliacao
  avaliacao_inicio?: number;       // timestamp epoch de quando entrou em aguardando_avaliacao
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
      participant?: string; // JID do participante que enviou em caso de grupo
    };
    participant?: string; // JID do participante alternativo
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
