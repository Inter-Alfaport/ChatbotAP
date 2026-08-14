// src/workers/inatividade.worker.ts
// Worker que verifica periodicamente atendimentos inativos e os encerra automaticamente.
import { dbService } from '../services/db.service';
import { evolutionService } from '../services/evolution.service';
import { sessaoService } from '../services/sessao.service';
import { log } from '../utils/logger';

// Tempo em minutos para considerar atendimento inativo
const TIMEOUT_BOT_MIN = parseInt(process.env.TIMEOUT_BOT_MIN || '5');
const TIMEOUT_HUMANO_MIN = parseInt(process.env.TIMEOUT_HUMANO_MIN || '10');

// Mensagem de CSAT (escala 1-5)
const MENSAGEM_CSAT =
  `Agradecemos seu contato! 😊\n\n` +
  `Como você avalia o nosso atendimento hoje?\n\n` +
  `1️⃣ Péssimo\n` +
  `2️⃣ Ruim\n` +
  `3️⃣ Regular\n` +
  `4️⃣ Bom\n` +
  `5️⃣ Excelente\n\n` +
  `Caso necessite de mais alguma coisa, basta retornar que estaremos aqui para te ajudar. 🙂`;

let workerRodando = false;

async function verificarInatividade(): Promise<void> {
  if (workerRodando) return;
  workerRodando = true;

  try {
    // 1. Marca atendimentos em transbordo que ultrapassaram 30 min sem resposta
    await dbService.marcarAtrasoDeSla();

    // 2. Encerra atendimentos inativos e pega a lista dos encerrados
    const encerrados = await dbService.encerrarAtendimentosPorInatividade(
      TIMEOUT_BOT_MIN,
      TIMEOUT_HUMANO_MIN
    );

    if (encerrados.length > 0) {
      log('inatividade_worker', { encerrados: encerrados.length });
      console.log(`[Worker] ${encerrados.length} atendimento(s) encerrado(s) por inatividade.`);
    }

    // 3. Para cada atendimento encerrado, atualizar sessão e enviar CSAT
    for (const atd of encerrados) {
      try {
        // Atualiza sessão no Redis/memória para aguardar avaliação
        const sessao = await sessaoService.buscar(atd.telefone);
        if (sessao && sessao.estado !== 'aguardando_avaliacao') {
          sessao.estado = 'aguardando_avaliacao';
          // Limpa atendimento ativo e fluxo para não re-abrir desnecessariamente
          sessao.atendimentoId = atd.id;
          sessao.emTransbordo = false;
          sessao.modoAtendente = false;
          sessao.fluxoAtivo = undefined;
          await sessaoService.salvar(sessao);
        }

        // Envia mensagem de CSAT pelo WhatsApp
        await evolutionService.enviarTexto(atd.telefone, MENSAGEM_CSAT);
        console.log(`[Worker] CSAT enviado para ${atd.telefone} (atendimento ${atd.id}).`);
      } catch (err) {
        console.error(`[Worker] Erro ao enviar CSAT para ${atd.telefone}:`, err);
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
