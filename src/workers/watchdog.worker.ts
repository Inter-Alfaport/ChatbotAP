// src/workers/watchdog.worker.ts
// Worker de autocura (Watchdog) para monitorar e manter ativa a conexão do WhatsApp na Evolution API.
// Previne o bug do timeout de 50 minutos da Meta em stanzas de status e recupera conexões zumbis automaticamente.

import { evolutionService } from '../services/evolution.service';
import { log } from '../utils/logger';

// Intervalo de verificação: a cada 60 segundos
const INTERVALO_CHECK_MS = 60 * 1000;

// Tempo de inatividade (sem nenhuma mensagem entrando ou saindo) para disparar renovação preventiva
// A Meta encerra o stream em ~50 min se houver stanzas de status sem ack; renovando aos 35 min eliminamos a queda
const TIMEOUT_RENOVACAO_PREVENTIVA_MS = 35 * 60 * 1000;

// Intervalo mínimo entre reinícios para evitar loops
const INTERVALO_MIN_ENTRE_REINICIOS_MS = 5 * 60 * 1000;

let ultimaAtividadeEm = Date.now();
let ultimoReinicioEm = 0;
let watchdogRodando = false;

export function registrarAtividadeWhatsApp(): void {
  ultimaAtividadeEm = Date.now();
}

async function cicloWatchdog(): Promise<void> {
  if (watchdogRodando) return;
  watchdogRodando = true;

  try {
    const agora = Date.now();
    const estado = await evolutionService.checarStatusConexao();

    // 1. Conexão caiu ou não está aberta
    if (estado !== 'open') {
      if (agora - ultimoReinicioEm > INTERVALO_MIN_ENTRE_REINICIOS_MS) {
        console.warn(`⚠️ [Watchdog] Conexão com WhatsApp não está aberta (estado: '${estado}'). Disparando recuperação automática...`);
        log('watchdog_recuperacao', { estadoAnterior: estado, motivo: 'estado_nao_open' });

        const sucesso = await evolutionService.reiniciarInstancia();
        ultimoReinicioEm = agora;
        if (sucesso) {
          console.log('✅ [Watchdog] Instância reiniciada e recuperada com sucesso.');
          ultimaAtividadeEm = agora;
        }
      }
      return;
    }

    // 2. Renovação preventiva de socket após 35 min de inatividade
    // Garante que o Baileys não acumule stanzas de status sem ack da Meta (que expiram em 50 min)
    const tempoInativo = agora - ultimaAtividadeEm;
    if (tempoInativo >= TIMEOUT_RENOVACAO_PREVENTIVA_MS) {
      if (agora - ultimoReinicioEm > INTERVALO_MIN_ENTRE_REINICIOS_MS) {
        const minutosInativo = Math.round(tempoInativo / 60000);
        console.log(`🔄 [Watchdog] ${minutosInativo} min sem atividade. Renovando socket preventivamente para evitar timeout de status...`);
        log('watchdog_renovacao_preventiva', { minutosInativo });

        const sucesso = await evolutionService.reiniciarInstancia();
        ultimoReinicioEm = agora;
        ultimaAtividadeEm = agora; // reseta o contador
        if (sucesso) {
          console.log('✅ [Watchdog] Socket renovado preventivamente com sucesso.');
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
  console.log('[Watchdog] Worker de autocura do WhatsApp iniciado (checagem a cada 60s, renovação preventiva a cada 35min sem atividade).');
  // Executa a primeira checagem após 15 segundos da inicialização do servidor
  setTimeout(() => {
    cicloWatchdog().catch(() => {});
  }, 15000);

  // Agenda checagem periódica
  setInterval(() => {
    cicloWatchdog().catch(() => {});
  }, INTERVALO_CHECK_MS);
}
