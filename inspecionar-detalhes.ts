// inspecionar-detalhes.ts — rode com: npx ts-node inspecionar-detalhes.ts
// Verifica endpoints detalhados e busca por telefone via endpoint individual

import axios from 'axios';

const TOKEN = 'Basic M2M3ODVjNTJhYTVhNGQzYmFlNGNkZjQxYzA3Yjk4MDI6M2RlYjhjNTRkNjhkNDNmNTkwOTUzNmVmZDZmMmVjM2I=';
const BASE_URL = 'http://employer.tangerino.com.br';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

async function testar() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Inspeção detalhada — Tangerino API');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Busca um colaborador pelo ID para ver se tem mais campos
  console.log('🔍 1. Buscando detalhes do 1º colaborador via /employee/find...\n');
  try {
    const { data: listData } = await api.get('/employee/find-all', { params: { page: 0, size: 1 } });
    const primeiroId = listData?.content?.[0]?.id;
    
    if (primeiroId) {
      const { data: detalhe } = await api.get('/employee/find', { params: { id: primeiroId } });
      console.log('📄 Resultado de /employee/find:');
      console.log(JSON.stringify(detalhe, null, 2));
      console.log('');
    }
  } catch (e: any) {
    console.error('❌ Erro em /employee/find:', e?.response?.status, JSON.stringify(e?.response?.data || e.message).slice(0, 300));
  }

  // 2. Tenta buscar jobRole detalhado
  console.log('\n🔍 2. Buscando job roles via /job-role...\n');
  try {
    const { data } = await api.get('/job-role', { params: { page: 0, size: 5 } });
    console.log('📄 Job Roles:');
    console.log(JSON.stringify(data, null, 2).slice(0, 1000));
  } catch (e: any) {
    console.error('❌ Erro em /job-role:', e?.response?.status, JSON.stringify(e?.response?.data || e.message).slice(0, 300));
  }

  // 3. Tenta buscar workplaces
  console.log('\n\n🔍 3. Buscando workplaces via /workplace...\n');
  try {
    const { data } = await api.get('/workplace/find-all', { params: { page: 0, size: 10 } });
    console.log('📄 Workplaces:');
    console.log(JSON.stringify(data, null, 2).slice(0, 1000));
  } catch (e: any) {
    console.error('❌ Erro em /workplace:', e?.response?.status, JSON.stringify(e?.response?.data || e.message).slice(0, 300));
  }

  // 4. Tenta V2 do employee que pode ter mais campos
  console.log('\n\n🔍 4. Testando V2 /employee/v2/find-all...\n');
  try {
    const { data } = await api.get('/employee/v2/find-all', { params: { page: 0, size: 2 } });
    console.log('📄 V2 Employee (2 primeiros):');
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  } catch (e: any) {
    console.error('❌ Erro em V2:', e?.response?.status, JSON.stringify(e?.response?.data || e.message).slice(0, 300));
  }

  // 5. Busca todos colaboradores e verifica CPFs (para tentar outra forma de identificação)
  console.log('\n\n🔍 5. Listando todos os colaboradores (nome + email + cpf)...\n');
  try {
    let page = 0;
    const all: any[] = [];
    while (true) {
      const { data } = await api.get('/employee/find-all', { params: { page, size: 50 } });
      const lista = data?.content ?? [];
      if (lista.length === 0) break;
      all.push(...lista);
      if (page + 1 >= (data?.totalPages ?? 1)) break;
      page++;
    }

    console.log(`Total: ${all.length} colaboradores\n`);
    console.log('Nome | Email | CPF');
    console.log('─'.repeat(80));
    all.forEach(c => {
      console.log(`${c.name} | ${c.email ?? '—'} | ${c.cpf ?? '—'}`);
    });
  } catch (e: any) {
    console.error('❌ Erro:', e?.response?.status, e?.response?.data || e.message);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Inspeção finalizada!');
  console.log('═══════════════════════════════════════════════════\n');
}

testar().catch(console.error);
