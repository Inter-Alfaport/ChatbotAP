// src/utils/logger.ts
// Logger estruturado em JSON para produção.
// - Emite uma linha JSON por evento (compatível com Railway, Datadog, etc.)
// - Anonimiza o telefone via SHA-256 dos últimos 8 dígitos (pseudo-anonimização auditável)
// - Silencia erros internos de serialização para nunca quebrar o fluxo principal

import { createHash } from 'crypto';

// ─── Eventos rastreados ───────────────────────────────────────────────────────
export type EventoLog =
  | 'auth_success'              // autenticação bem-sucedida (telefone ou CPF)
  | 'auth_failure'              // telefone e CPF não identificados
  | 'auth_cpf_tentativa'        // tentativa de CPF (válida ou inválida)
  | 'triage_state_change'       // transição de estado da triagem
  | 'llm_call'                  // chamada ao Gemini concluída
  | 'llm_error'                 // falha na API Gemini
  | 'transbordo'                // transbordo acionado
  | 'session_liberada'          // sessão liberada via /liberar pelo grupo RH
  | 'modo_atendente_ativado'    // bot silenciado por iniciativa do atendente
  | 'modo_atendente_expirou'    // silêncio expirado automaticamente por TTL
  | 'inatividade_worker'        // worker encerrou atendimentos por inatividade
  | 'webhook_erro';             // exceção não tratada no handler

// ─── Anonimização ─────────────────────────────────────────────────────────────
function hashTelefone(telefone: string): string {
  const digits = telefone.replace(/\D/g, '');
  const ultimos8 = digits.slice(-8);
  return createHash('sha256').update(ultimos8).digest('hex').slice(0, 12);
}

// ─── Função principal ─────────────────────────────────────────────────────────
export function log(
  evento: EventoLog,
  campos: Record<string, unknown> = {}
): void {
  try {
    const entrada: Record<string, unknown> = {
      ts: new Date().toISOString(),
      evento,
      ...campos,
    };

    // Anonimiza campo 'telefone' automaticamente se presente
    if (typeof entrada.telefone === 'string') {
      entrada.tel_hash = hashTelefone(entrada.telefone as string);
      delete entrada.telefone;
    }

    console.log(JSON.stringify(entrada));
  } catch {
    // Silencia falhas de serialização para nunca interromper o fluxo do bot
    console.error('[Logger] Falha ao serializar entrada de log para evento:', evento);
  }
}
