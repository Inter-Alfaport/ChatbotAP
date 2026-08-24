// Taxonomia canônica de assuntos para relatórios do dashboard

export const CATEGORIAS_ASSUNTO = [
  'Ponto Eletrônico',
  'Salário e Pagamento',
  'Décimo Terceiro',
  'Benefícios (VR / VT)',
  'Férias',
  'Aviso Prévio',
  'Identificação / Cadastro',
  'Outros',
] as const;

export type CategoriaAssunto = (typeof CATEGORIAS_ASSUNTO)[number];

export const MAP_MENU_PARA_ASSUNTO: Record<string, CategoriaAssunto> = {
  Ponto: 'Ponto Eletrônico',
  Pagamento: 'Salário e Pagamento',
  'Décimo Terceiro': 'Décimo Terceiro',
  Benefícios: 'Benefícios (VR / VT)',
  Férias: 'Férias',
  'Aviso Prévio': 'Aviso Prévio',
  Cadastro: 'Identificação / Cadastro',
  'Outro assunto': 'Outros',
};

export function normalizarCategoriaAssunto(valor: string | null | undefined): CategoriaAssunto | null {
  if (!valor) return null;
  const trimmed = valor.trim();
  if ((CATEGORIAS_ASSUNTO as readonly string[]).includes(trimmed)) {
    return trimmed as CategoriaAssunto;
  }
  return MAP_MENU_PARA_ASSUNTO[trimmed] ?? null;
}

/** Expressão SQL para exibir categoria normalizada (com fallback para menu legado). */
export function sqlCategoriaAssuntoExibicao(alias = 'a'): string {
  return `COALESCE(
    NULLIF(${alias}.categoria_assunto, ''),
    CASE ${alias}.categoria
      WHEN 'Ponto' THEN 'Ponto Eletrônico'
      WHEN 'Pagamento' THEN 'Salário e Pagamento'
      WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
      WHEN 'Férias' THEN 'Férias'
      WHEN 'Cadastro' THEN 'Identificação / Cadastro'
      WHEN 'Outro assunto' THEN 'Outros'
      ELSE NULL
    END,
    'Outros'
  )`;
}
