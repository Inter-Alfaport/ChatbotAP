// inspecionar-find.ts — rode com: npx ts-node inspecionar-find.ts
// Busca detalhes de um colaborador via /employee/find e lista job roles

import axios from 'axios';

const TOKEN = 'Basic M2M3ODVjNTJhYTVhNGQzYmFlNGNkZjQxYzA3Yjk4MDI6M2RlYjhjNTRkNjhkNDNmNTkwOTUzNmVmZDZmMmVjM2I=';
const BASE_URL = 'http://employer.tangerino.com.br';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
  timeout: 15000,
});

async function main() {
  // 1. Pega ID do primeiro colaborador
  const { data: listData } = await api.get('/employee/find-all', { params: { page: 0, size: 1 } });
  const primeiroId = listData?.content?.[0]?.id;
  console.log(`ID do 1º colaborador: ${primeiroId}\n`);

  // 2. Busca detalhes com /employee/find
  console.log('═══ /employee/find ═══');
  try {
    const { data } = await api.get('/employee/find', { params: { id: primeiroId } });
    const campos = Object.keys(data);
    console.log(`Campos (${campos.length}): ${campos.join(', ')}`);
    console.log('\nJSON completo:');
    console.log(JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error('Erro:', e?.response?.status, JSON.stringify(e?.response?.data).slice(0, 500));
  }

  // 3. Job roles
  console.log('\n\n═══ /job-role (primeiros 3) ═══');
  try {
    const { data } = await api.get('/job-role', { params: { page: 0, size: 3 } });
    const lista = data?.content ?? data ?? [];
    console.log(JSON.stringify(lista, null, 2).slice(0, 1000));
  } catch (e: any) {
    console.error('Erro:', e?.response?.status);
  }
}

main().catch(console.error);
