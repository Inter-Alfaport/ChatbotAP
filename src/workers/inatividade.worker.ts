// src/workers/inatividade.worker.ts
// Worker que verifica periodicamente atendimentos inativos e os encerra automaticamente.
import { dbService } from '../services/db.service';
import { evolutionService } from '../services/evolution.service';
import { sessaoService } from '../services/sessao.service';
import { log } from '../utils/logger';

// Tempo em minutos para considerar atendimento inativo
const TIMEOUT_BOT_MIN = parseInt(process.env.TIMEOUT_BOT_MIN || '60');
const TIMEOUT_HUMANO_MIN = parseInt(process.env.TIMEOUT_HUMANO_MIN || '120');

let workerRodando = false;

async function verificarInatividade(): Promise<void> {
  if (workerRodando) return;
  workerRodando = true;

  try {
    // 1. Marca atendimentos em transbordo que ultrapassaram o SLA de 2h sem resposta no horário comercial
    await dbService.marcarAtrasoDeSla();

    // 2. Encerra atendimentos inativos e pega a lista dos encerrados
    const encerrados = await dbService.encerrarAtendimentosPorInatividade(
      TIMEOUT_BOT_MIN,
      TIMEOUT_HUMANO_MIN
    );

    if (encerrados.length > 0) {
      log('inatividade_worker', { encerrados: encerrados.length });
      console.log(`[Worker] ${encerrados.length} atendimento(s) encerrado(s) por inatividade silenciosamente.`);
    }

    // 3. Para cada atendimento encerrado por inatividade:
    // - Limpa estado da sessão sem enviar CSAT
    // - Dispara classificação de assunto em background com todo o histórico acumulado
    for (const atd of encerrados) {
      try {
        const { classificadorAssuntoService } = require('../services/classificador-assunto.service');
        classificadorAssuntoService.classificarEPersistir({
          atendimentoId: atd.id,
          persistir: true
        }).catch((e: any) => console.error(`[Worker] Erro ao classificar assunto do atendimento ${atd.id}:`, e));

        const sessao = await sessaoService.buscar(atd.telefone);
        if (sessao && sessao.atendimentoId === atd.id) {
          sessao.atendimentoId = undefined;
          sessao.emTransbordo = false;
          sessao.transbordoInicio = undefined;
          sessao.modoAtendente = false;
          sessao.modoAtendenteTTL = undefined;
          sessao.fluxoAtivo = undefined;
          sessao.categoria = undefined;
          sessao.tentativasDiagnostico = undefined;
          await sessaoService.salvar(sessao);
        }
      } catch (err) {
        console.error(`[Worker] Erro ao limpar sessão inativa para ${atd.telefone}:`, err);
      }
    }
  } catch (err) {
    console.error('[Worker] Erro no ciclo de verificação de inatividade:', err);
  } finally {
    workerRodando = false;
  }
}

export function iniciarWorkerInatividade(): void {
  const intervaloMs = 60 * 1000; // a cada 1 minuto
  console.log(
    `[Worker] Worker de inatividade iniciado ` +
    `(bot: ${TIMEOUT_BOT_MIN}min, humano: ${TIMEOUT_HUMANO_MIN}min).`
  );
  setInterval(verificarInatividade, intervaloMs);
}
