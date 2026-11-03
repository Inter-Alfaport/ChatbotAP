// src/utils/error.utils.ts
import axios from 'axios';

/**
 * Sanitiza e formata erros (especialmente AxiosError) para log limpo de linha única.
 * Evita vazamento de cabeçalhos de autenticação, sockets TLS e estouro de buffer nos logs.
 */
export function formatAxiosError(err: any): string {
  if (!err) return 'Erro desconhecido';

  if (axios.isAxiosError(err) || err.isAxiosError) {
    const status = err.response?.status ? `HTTP ${err.response.status}` : 'Sem resposta';
    const code = err.code ? `[${err.code}]` : '';
    const message = err.message || 'Falha na requisição';

    let dataDetail = '';
    if (err.response?.data) {
      if (typeof err.response.data === 'string') {
        dataDetail = ` - Detalhes: ${err.response.data.slice(0, 200).replace(/\s+/g, ' ')}`;
      } else if (typeof err.response.data === 'object') {
        const msg = err.response.data.message || err.response.data.error || JSON.stringify(err.response.data);
        dataDetail = ` - Detalhes: ${String(msg).slice(0, 200)}`;
      }
    }

    return `${status} ${code} ${message}${dataDetail}`.trim();
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}
