// src/services/evolution.service.ts
import axios from 'axios';
import { formatAxiosError } from '../utils/error.utils';

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
  async enviarPresenca(telefone: string, presenca: 'composing' | 'recording' | 'paused', delayMs: number = 2000): Promise<void> {
    try {
      await api.post(`/chat/sendPresence/${EVOLUTION_INSTANCE_NAME}`, {
        number: telefone,
        presence: presenca,
        delay: delayMs
      });
    } catch (err: any) {
      console.warn('[Evolution API] Erro ao enviar presenca:', formatAxiosError(err));
    }
  },

  async enviarTexto(telefone: string, mensagem: string, simularDigitando = true): Promise<void> {
    try {
      const isGrupo = telefone.includes('@');

      if (!isGrupo && simularDigitando) {
        // 1. Calcula o delay baseado no tamanho do texto (30ms por caractere, mínimo 2s, máximo 5s)
        const delayMs = Math.min(5000, Math.max(2000, mensagem.length * 30));

        // 2. Envia status de "digitando..."
        await this.enviarPresenca(telefone, 'composing', delayMs);

        // 3. Aguarda o delay correspondente
        await sleep(delayMs);
      }

      const { data } = await api.post(`/message/sendText/${EVOLUTION_INSTANCE_NAME}`, {
        number: telefone,
        text: mensagem,
      });

      const msgId = data?.key?.id;
      if (msgId) {
        const { MSG_IDS_RECENTES } = require('../utils/msg-dedup');
        MSG_IDS_RECENTES.add(msgId);
      }
      try {
        const { registrarAtividadeWhatsApp } = require('../workers/watchdog.worker');
        registrarAtividadeWhatsApp();
      } catch {}
    } catch (err: any) {
      console.error('[Evolution API] Erro ao enviar mensagem:', formatAxiosError(err));
      throw err;
    }
  },

  // Formata o telefone removendo caracteres não numéricos
  formatarTelefone(telefone: string): string {
    return telefone.replace(/\D/g, '');
  },

  // Consulta o estado da conexão na Evolution API ('open', 'close', 'connecting', etc.)
  async checarStatusConexao(): Promise<string> {
    try {
      const { data } = await api.get(`/instance/connectionState/${EVOLUTION_INSTANCE_NAME}`);
      return data?.instance?.state || 'unknown';
    } catch (err: any) {
      console.warn('[Evolution API] Erro ao consultar estado da conexao:', formatAxiosError(err));
      return 'error';
    }
  },

  // Reinicia a conexão da instância (Baileys socket) de forma limpa
  async reiniciarInstancia(): Promise<boolean> {
    try {
      console.log(`[Evolution API] Reiniciando instância '${EVOLUTION_INSTANCE_NAME}' preventivamente...`);
      const { data } = await api.post(`/instance/restart/${EVOLUTION_INSTANCE_NAME}`);
      const ok = data?.instance?.state === 'open' || data?.status === 'SUCCESS' || !!data;
      console.log(`[Evolution API] Instância reiniciada. Estado retornado: ${data?.instance?.state || 'ok'}`);
      return ok;
    } catch (err: any) {
      console.error('[Evolution API] Erro ao reiniciar instância:', formatAxiosError(err));
      return false;
    }
  },
};
