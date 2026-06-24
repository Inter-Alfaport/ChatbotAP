// src/services/evolution.service.ts
import axios from 'axios';

const { EVOLUTION_BASE_URL, EVOLUTION_INSTANCE_NAME, EVOLUTION_API_KEY } = process.env;

const api = axios.create({
  baseURL: EVOLUTION_BASE_URL,
  headers: {
    'apikey': EVOLUTION_API_KEY || '',
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

export const evolutionService = {
  async enviarTexto(telefone: string, mensagem: string): Promise<void> {
    try {
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
