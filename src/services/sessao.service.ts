// src/services/sessao.service.ts
import Redis from 'ioredis';
import { Sessao } from '../types';

// Armazenamento em memória caso o Redis não esteja disponível
const memoryStore = new Map<string, string>();
let useMemoryFallback = false;

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  // Evita tentativas infinitas de reconexão barulhentas caso falhe
  reconnectOnError: () => false,
});

// Captura erro de conexão para evitar que o Node trave
redis.on('error', (err) => {
  if (!useMemoryFallback) {
    console.warn('⚠️ [Redis] Não foi possível se conectar ao servidor Redis. Usando armazenamento em memória como fallback.');
    useMemoryFallback = true;
  }
});

const TTL_SEGUNDOS = (parseInt(process.env.SESSION_TTL_MINUTES || '30')) * 60;
const chave = (telefone: string) => `sessao:${telefone}`;

export const sessaoService = {
  async buscar(telefone: string): Promise<Sessao | null> {
    try {
      if (useMemoryFallback) {
        const dados = memoryStore.get(chave(telefone));
        return dados ? (JSON.parse(dados) as Sessao) : null;
      }
      const dados = await redis.get(chave(telefone));
      if (!dados) return null;
      return JSON.parse(dados) as Sessao;
    } catch (err) {
      useMemoryFallback = true;
      const dados = memoryStore.get(chave(telefone));
      return dados ? (JSON.parse(dados) as Sessao) : null;
    }
  },

  async salvar(sessao: Sessao): Promise<void> {
    sessao.atualizadoEm = Date.now();
    try {
      if (useMemoryFallback) {
        memoryStore.set(chave(sessao.telefone), JSON.stringify(sessao));
        return;
      }
      await redis.setex(chave(sessao.telefone), TTL_SEGUNDOS, JSON.stringify(sessao));
    } catch (err) {
      useMemoryFallback = true;
      memoryStore.set(chave(sessao.telefone), JSON.stringify(sessao));
    }
  },

  async criar(telefone: string): Promise<Sessao> {
    const nova: Sessao = {
      telefone,
      colaborador: null,
      autenticado: false,
      historico: [],
      emTransbordo: false,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
    };
    await this.salvar(nova);
    return nova;
  },

  async deletar(telefone: string): Promise<void> {
    try {
      if (useMemoryFallback) {
        memoryStore.delete(chave(telefone));
        return;
      }
      await redis.del(chave(telefone));
    } catch (err) {
      useMemoryFallback = true;
      memoryStore.delete(chave(telefone));
    }
  },

  // Adiciona uma mensagem ao histórico e mantém no máximo 20 turnos (40 mensagens)
  async adicionarAoHistorico(
    telefone: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<Sessao> {
    const sessao = await this.buscar(telefone) || await this.criar(telefone);
    sessao.historico.push({ role, content });

    // Janela deslizante: mantém os últimos 40 itens (20 turnos)
    if (sessao.historico.length > 40) {
      sessao.historico = sessao.historico.slice(-40);
    }

    await this.salvar(sessao);
    return sessao;
  },
};
