// src/workers/watchdog.worker.ts
// Worker de monitoramento e autocura do WhatsApp na Evolution API.
// Monitora a saúde da conexão e recupera automaticamente caso a instância caia (estado !== 'open').

import { evolutionService } from '../services/evolution.service';
import { log } from '../utils/logger';

// Intervalo de verificação: a cada 60 segundos
const INTERVALO_CHECK_MS = 60 * 1000;

// Intervalo mínimo entre reinícios para evitar loops
const INTERVALO_MIN_ENTRE_REINICIOS_MS = 5 * 60 * 1000;

let ultimoReinicioEm = 0;
let watchdogRodando = false;

// Função mantida para retrocompatibilidade onde for chamada
export function registrarAtividadeWhatsApp(): void {
  // no-op: reinício preventivo às cegas foi desativado para evitar bloqueios da Meta
}

async function cicloWatchdog(): Promise<void> {
  if (watchdogRodando) return;
  watchdogRodando = true;

  try {
    const agora = Date.now();
    const estado = await evolutionService.checarStatusConexao();

    // Conexão caiu ou não está aberta (ex: 'close', 'connecting', 'refused')
    if (estado !== 'open') {
      if (agora - ultimoReinicioEm > INTERVALO_MIN_ENTRE_REINICIOS_MS) {
        console.warn(`⚠️ [Watchdog] Conexão com WhatsApp não está aberta (estado: '${estado}'). Disparando recuperação automática...`);
        log('watchdog_recuperacao', { estadoAnterior: estado, motivo: 'estado_nao_open' });

        const sucesso = await evolutionService.reiniciarInstancia();
        ultimoReinicioEm = agora;
        if (sucesso) {
          console.log('✅ [Watchdog] Instância reiniciada e recuperada com sucesso.');
        }
      }
    }
  } catch (err: any) {
    console.error('❌ [Watchdog] Erro ao executar ciclo de monitoramento:', err?.message || err);
  } finally {
    watchdogRodando = false;
  }
}

export function iniciarWorkerWatchdog(): void {
  console.log('[Watchdog] Worker de monitoramento do WhatsApp ativo (checagem a cada 60s).');
  // Executa a primeira checagem após 15 segundos da inicialização do servidor
  setTimeout(() => {
    cicloWatchdog().catch(() => {});
  }, 15000);

  // Agenda checagem periódica
  setInterval(() => {
    cicloWatchdog().catch(() => {});
  }, INTERVALO_CHECK_MS);
}

