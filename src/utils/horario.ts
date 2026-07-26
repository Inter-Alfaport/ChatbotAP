// src/utils/horario.ts
// Verifica se o momento atual está dentro do horário de atendimento humano.
// Utilizado APENAS para ajustar a mensagem de transbordo — o bot responde 24/7 normalmente.
//
// Variáveis de ambiente (todas opcionais, com defaults seg-sex 08h-18h):
//   HORARIO_INICIO_H   = 8    (hora inteira, fuso Brasília)
//   HORARIO_FIM_H      = 18   (hora inteira, exclusiva — 18:00 já está fora)
//   DIAS_ATENDIMENTO   = 1,2,3,4,5  (0=Dom, 1=Seg, ..., 6=Sáb)

const HORA_INICIO = parseInt(process.env.HORARIO_INICIO_H  || '8',  10);
const HORA_FIM    = parseInt(process.env.HORARIO_FIM_H     || '18', 10);
const DIAS_SEMANA = (process.env.DIAS_ATENDIMENTO || '1,2,3,4,5')
  .split(',')
  .map((d) => parseInt(d.trim(), 10));

/**
 * Retorna `true` se o momento atual (fuso America/Sao_Paulo) estiver
 * dentro do horário de atendimento configurado.
 */
export function dentroDoHorarioAtendimento(): boolean {
  const agora = new Date();

  // Converte para horário de Brasília usando a representação en-US
  // (getDay/getHours operam sobre o valor local do objeto Date resultante)
  const spDate = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  );

  const diaSemana  = spDate.getDay();     // 0=Dom, 1=Seg, ..., 6=Sáb
  const hora       = spDate.getHours();
  const minuto     = spDate.getMinutes();

  if (!DIAS_SEMANA.includes(diaSemana)) return false;

  const minutoAtual = hora * 60 + minuto;
  return minutoAtual >= HORA_INICIO * 60 && minutoAtual < HORA_FIM * 60;
}
