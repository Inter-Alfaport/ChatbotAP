// src/utils/cpf.ts
// Valida apenas o formato do CPF (11 dígitos numéricos).
// Não realiza validação dos dígitos verificadores — conforme especificado.

/**
 * Remove caracteres não numéricos e verifica se o resultado tem exatamente 11 dígitos.
 * @returns CPF limpo (apenas números) se válido, ou `null` se inválido.
 */
export function validarFormatoCPF(input: string): string | null {
  const limpo = input.replace(/\D/g, '');
  if (limpo.length !== 11) return null;
  return limpo;
}
