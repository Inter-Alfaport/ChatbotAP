// src/services/evolution.service.ts
import axios from 'axios';

const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL || process.env.EVOLUTION_URL || '';
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE || '';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

const api = axios.create({
  baseURL: EVOLUTION_BASE_URL,
  headers: {
    'apikey': EVOLUTION_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const evolutionService = {
  async enviarPresenca(telefone: string, presenca: 'composing' | 'recording' | 'paused'): Promise<void> {
    try {
      await api.post(`/chat/sendPresence/${EVOLUTION_INSTANCE_NAME}`, {
        number: telefone,
        presence: presenca,
      });
    } catch (err: any) {
      console.warn('[Evolution API] Erro ao enviar presenca:', err?.response?.data || err.message);
    }
  },

  async enviarTexto(telefone: string, mensagem: string, simularDigitando = true): Promise<void> {
    try {
      const isGrupo = telefone.includes('@');

      if (!isGrupo && simularDigitando) {
        // 1. Envia status de "digitando..."
        await this.enviarPresenca(telefone, 'composing');

        // 2. Calcula o delay baseado no tamanho do texto (30ms por caractere, mínimo 2s, máximo 5s)
        const delayMs = Math.min(5000, Math.max(2000, mensagem.length * 30));
        await sleep(delayMs);
      }

      await api.post(`/message/sendText/${EVOLUTION_INSTANCE_NAME}`, {
        number: telefone,
        text: mensagem,
      });
    } catch (err: any) {
      console.error('[Evolution API] Erro ao enviar mensagem:', err?.response?.data || err.message);
      throw err;
    }
  },

  // Formata o telefone removendo caracteres não numéricos
  formatarTelefone(telefone: string): string {
    return telefone.replace(/\D/g, '');
  },
};
