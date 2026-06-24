// buscar-telefones.ts — rode com: npx ts-node buscar-telefones.ts
// Busca colaboradores por telefone na API Tangerino

import axios from 'axios';

const TOKEN = 'Basic M2M3ODVjNTJhYTVhNGQzYmFlNGNkZjQxYzA3Yjk4MDI6M2RlYjhjNTRkNjhkNDNmNTkwOTUzNmVmZDZmMmVjM2I=';
const BASE_URL = 'http://employer.tangerino.com.br';

const TELEFONES = ['21993896150', '21998324215', '2131396460'];

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

function normalizarTelefone(tel: string): string {
  return tel.replace(/\D/g, '');
}

async function carregarTodosColaboradores(): Promise<any[]> {
  const todos: any[] = [];
  let page = 0;
  const size = 50;

  console.log('📥 Carregando todos os colaboradores da API...\n');

  while (true) {
    try {
      const { data } = await api.get('/employee/find-all', {
        params: { page, size },
      });

      const lista: any[] = data?.content ?? [];
      if (lista.length === 0) break;

      todos.push(...lista);
      const totalPages = data?.totalPages ?? 1;
      const totalElements = data?.totalElements ?? '?';

      console.log(`  Página ${page + 1}/${totalPages} — ${lista.length} registros (total: ${totalElements})`);

      if (page + 1 >= totalPages) break;
      page++;
    } catch (e: any) {
      console.error(`❌ Erro na página ${page}:`, e?.response?.status, e?.response?.data || e.message);
      break;
    }
  }

  console.log(`\n✅ Total carregado: ${todos.length} colaboradores\n`);
  return todos;
}

async function buscarTelefones() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Busca de Colaboradores por Telefone — Tangerino  ');
  console.log('═══════════════════════════════════════════════════\n');

  // Primeiro testa conectividade
  try {
    await api.get('/test');
    console.log('🔗 Conectividade OK\n');
  } catch (e: any) {
    if (e?.response) {
      console.log(`🔗 Servidor respondeu (status ${e.response.status})\n`);
    } else {
      console.error('❌ Falha de conectividade:', e.message);
      return;
    }
  }

  const todos = await carregarTodosColaboradores();

  if (todos.length === 0) {
    console.log('❌ Nenhum colaborador encontrado. Verifique o token.');
    return;
  }

  // Mostra campos de telefone disponíveis no primeiro registro
  const campos = Object.keys(todos[0]);
  const camposTelefone = campos.filter(c => 
    c.toLowerCase().includes('phone') || c.toLowerCase().includes('cell') || c.toLowerCase().includes('tel')
  );
  console.log(`📋 Campos de telefone encontrados: ${camposTelefone.join(', ') || 'nenhum'}\n`);

  // Busca cada telefone
  console.log('═══════════════════════════════════════════════════');
  console.log('  Resultados da busca');
  console.log('═══════════════════════════════════════════════════\n');

  for (const tel of TELEFONES) {
    const telNorm = normalizarTelefone(tel);
    console.log(`🔍 Buscando: ${tel} (normalizado: ${telNorm})`);

    const encontrado = todos.find((c) => {
      const phone = normalizarTelefone(c.phone ?? '');
      const cellPhone = normalizarTelefone(c.cellPhone ?? '');

      // Match exato
      if (phone === telNorm || cellPhone === telNorm) return true;
      // Match últimos 9 dígitos
      if (phone.slice(-9) === telNorm.slice(-9) || cellPhone.slice(-9) === telNorm.slice(-9)) return true;
      // Match últimos 8 dígitos (fixo sem DDD)
      if (phone.slice(-8) === telNorm.slice(-8) || cellPhone.slice(-8) === telNorm.slice(-8)) return true;

      return false;
    });

    if (encontrado) {
      console.log(`  ✅ ENCONTRADO!`);
      console.log(`     👤 Nome:        ${encontrado.name}`);
      console.log(`     💼 Cargo:       ${encontrado.jobRole?.description ?? 'Não informado'}`);
      console.log(`     🏢 Local:       ${encontrado.workplace?.name ?? 'Não informado'}`);
      console.log(`     📱 Celular:     ${encontrado.cellPhone ?? '—'}`);
      console.log(`     📞 Telefone:    ${encontrado.phone ?? '—'}`);
      console.log(`     📧 Email:       ${encontrado.email ?? '—'}`);
      console.log(`     📅 Admissão:    ${encontrado.admissionDate ? new Date(encontrado.admissionDate).toLocaleDateString('pt-BR') : '—'}`);
      console.log(`     🆔 ID:          ${encontrado.id}`);
    } else {
      console.log(`  ❌ NÃO ENCONTRADO`);
      // Tenta mostrar telefones similares
      const similares = todos.filter(c => {
        const p = normalizarTelefone(c.phone ?? '');
        const cp = normalizarTelefone(c.cellPhone ?? '');
        return p.includes(telNorm.slice(-7)) || cp.includes(telNorm.slice(-7));
      });
      if (similares.length > 0) {
        console.log(`  📌 Telefones similares:`);
        similares.forEach(s => {
          console.log(`     - ${s.name}: phone=${s.phone ?? '—'} | cellPhone=${s.cellPhone ?? '—'}`);
        });
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  Busca finalizada!');
  console.log('═══════════════════════════════════════════════════\n');
}

buscarTelefones().catch(console.error);
