// inspecionar-campos.ts — rode com: npx ts-node inspecionar-campos.ts
// Inspeciona os campos reais retornados pela API Tangerino

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

async function inspecionar() {
  console.log('📋 Inspecionando campos da API Tangerino...\n');

  try {
    const { data } = await api.get('/employee/find-all', {
      params: { page: 0, size: 3 },
    });

    const lista: any[] = data?.content ?? [];

    if (lista.length === 0) {
      console.log('❌ Nenhum colaborador retornado');
      return;
    }

    // Mostra TODOS os campos do primeiro registro
    console.log('🔑 Todos os campos do 1º registro:\n');
    const campos = Object.keys(lista[0]);
    campos.forEach(c => {
      const val = lista[0][c];
      const tipo = typeof val;
      const preview = tipo === 'object' ? JSON.stringify(val)?.slice(0, 100) : String(val)?.slice(0, 80);
      console.log(`  ${c} (${tipo}): ${preview}`);
    });

    // Mostra os 3 primeiros completos como JSON
    console.log('\n\n📄 Primeiros 3 registros (JSON completo):\n');
    lista.forEach((c, i) => {
      console.log(`--- Colaborador ${i + 1} ---`);
      console.log(JSON.stringify(c, null, 2));
      console.log('');
    });

  } catch (e: any) {
    console.error('❌ Erro:', e?.response?.status, e?.response?.data || e.message);
  }
}

inspecionar().catch(console.error);
