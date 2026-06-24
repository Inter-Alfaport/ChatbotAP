// test-api.ts — rode com: npx ts-node test-api.ts
// Testa a conectividade e os principais endpoints da API Solides/Tangerino

import axios from 'axios';

// ─── Cole seus dados aqui ──────────────────────────────────────────────────
const TOKEN = 'Basic M2M3ODVjNTJhYTVhNGQzYmFlNGNkZjQxYzA3Yjk4MDI6M2RlYjhjNTRkNjhkNDNmNTkwOTUzNmVmZDZmMmVjM2I=';
const BASE_URL = 'http://employer.tangerino.com.br';

// Telefone de um colaborador real para testar a busca (só dígitos)
const TELEFONE_TESTE = '21982963974'; // exemplo do print
// ──────────────────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function erro(msg: string, e?: any) {
  console.log(`  ❌ ${msg}`);
  if (e?.response) {
    console.log(`     Status: ${e.response.status}`);
    console.log(`     Body:  `, JSON.stringify(e.response.data).slice(0, 300));
  } else if (e?.message) {
    console.log(`     Erro: ${e.message}`);
  }
}

async function testarConectividade() {
  console.log('\n📡 1. Teste de conectividade básica...');
  try {
    await api.get('/test');
    ok('Servidor respondeu');
  } catch (e: any) {
    if (e?.response?.status === 401) {
      ok('Servidor respondeu (401 — token inválido ou endpoint diferente)');
    } else if (e?.response) {
      ok(`Servidor respondeu com status ${e.response.status}`);
    } else {
      erro('Sem resposta do servidor', e);
    }
  }
}

async function testarAutenticacao() {
  console.log('\n🔑 2. Teste de autenticação...');
  try {
    const { data } = await api.get('/test');
    ok(`Autenticado! Resposta: ${JSON.stringify(data).slice(0, 100)}`);
  } catch (e: any) {
    if (e?.response?.status === 401) {
      erro('Token inválido (401)', e);
    } else if (e?.response?.status === 200) {
      ok('Autenticado!');
    } else {
      erro(`Status inesperado`, e);
    }
  }
}

async function testarListaColaboradores() {
  console.log('\n👥 3. Listando colaboradores (página 0, tamanho 5)...');
  try {
    const { data } = await api.get('/employee/find-all', {
      params: { page: 0, size: 5 },
    });

    const lista = data?.content ?? data ?? [];
    const total = data?.totalElements ?? '?';

    ok(`Total de colaboradores: ${total}`);
    ok(`Campos disponíveis no primeiro registro:`);

    if (lista.length > 0) {
      const campos = Object.keys(lista[0]);
      console.log(`     ${campos.join(', ')}`);

      // Verifica se tem campo de telefone
      const temPhone = campos.includes('phone');
      const temCellPhone = campos.includes('cellPhone');
      console.log(`\n  📞 Campo 'phone':     ${temPhone ? '✅ existe' : '❌ não existe'}`);
      console.log(`  📱 Campo 'cellPhone': ${temCellPhone ? '✅ existe' : '❌ não existe'}`);

      // Mostra exemplo do primeiro colaborador (sem dados sensíveis)
      const ex = lista[0];
      console.log(`\n  📋 Exemplo (1º colaborador):`);
      console.log(`     id:          ${ex.id}`);
      console.log(`     name:        ${ex.name}`);
      console.log(`     phone:       ${ex.phone ?? '—'}`);
      console.log(`     cellPhone:   ${ex.cellPhone ?? '—'}`);
      console.log(`     email:       ${ex.email ?? '—'}`);
      console.log(`     jobRole:     ${JSON.stringify(ex.jobRole ?? '—')}`);
      console.log(`     workplace:   ${JSON.stringify(ex.workplace ?? '—')}`);
      console.log(`     admissionDate: ${ex.admissionDate ?? '—'}`);
    }

    return lista;
  } catch (e: any) {
    erro('Falha ao listar colaboradores', e);
    return [];
  }
}

async function testarBuscaPorTelefone(lista: any[]) {
  console.log(`\n🔍 4. Testando match de telefone com "${TELEFONE_TESTE}"...`);

  if (lista.length === 0) {
    console.log('  ⚠️  Sem colaboradores para testar (passo anterior falhou)');
    return;
  }

  const tel = TELEFONE_TESTE.replace(/\D/g, '');
  const encontrado = lista.find((c) => {
    const p = (c.phone ?? '').replace(/\D/g, '');
    const cp = (c.cellPhone ?? '').replace(/\D/g, '');
    return p === tel || cp === tel || p.slice(-9) === tel.slice(-9) || cp.slice(-9) === tel.slice(-9);
  });

  if (encontrado) {
    ok(`Colaborador encontrado: ${encontrado.name}`);
  } else {
    console.log(`  ⚠️  Telefone não encontrado na página 0. Isso é esperado se houver muitos colaboradores.`);
    console.log(`     Os telefones desta página são:`);
    lista.forEach((c) => {
      console.log(`     - ${c.name}: phone=${c.phone ?? '—'} | cellPhone=${c.cellPhone ?? '—'}`);
    });
  }
}

async function testarAjustesFerias(lista: any[]) {
  console.log('\n🏖️  5. Testando endpoint de ajustes/férias...');

  if (lista.length === 0) {
    console.log('  ⚠️  Sem colaboradores para testar');
    return;
  }

  const id = lista[0].id;
  try {
    const { data } = await api.get('/adjustment-reason-record/find-all', {
      params: { employeeId: id, page: 0, size: 5 },
    });
    ok(`Endpoint respondeu. Total de ajustes: ${data?.totalElements ?? '?'}`);
    if ((data?.content ?? []).length > 0) {
      console.log(`     Exemplo:`, JSON.stringify(data.content[0]).slice(0, 200));
    }
  } catch (e: any) {
    erro('Falha no endpoint de ajustes', e);
  }
}

async function testarPontos(lista: any[]) {
  console.log('\n⏱️  6. Testando endpoint de pontos...');

  if (lista.length === 0) {
    console.log('  ⚠️  Sem colaboradores para testar');
    return;
  }

  const id = lista[0].id;
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
  const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).getTime();

  try {
    const { data } = await api.get('/punch', {
      params: { employeeId: id, startDate: inicioMes, endDate: fimMes, page: 0, size: 10 },
    });
    ok(`Endpoint respondeu. Registros de ponto: ${data?.totalElements ?? data?.content?.length ?? '?'}`);
  } catch (e: any) {
    erro('Falha no endpoint de pontos', e);
  }
}

// ─── Runner ────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('  Teste de integração — Solides/Tangerino  ');
  console.log('═══════════════════════════════════════════');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Token:    ${TOKEN.slice(0, 20)}...`);

  await testarConectividade();
  await testarAutenticacao();
  const lista = await testarListaColaboradores();
  await testarBuscaPorTelefone(lista);
  await testarAjustesFerias(lista);
  await testarPontos(lista);

  console.log('\n═══════════════════════════════════════════');
  console.log('  Teste finalizado!');
  console.log('═══════════════════════════════════════════\n');
})();
