// src/scripts/carga-inicial.ts
// Roda UMA ÚNICA VEZ para importar todos os colaboradores da Solides para o SQLite local.
// Uso: npm run seed
//
// O que faz:
// 1. Busca todos os colaboradores via GET /employee/find-all (paginado)
// 2. Para cada um, busca o detalhe individual GET /employee/find?tangerinoId=X
//    (o detalhe traz telefone e CPF que podem não vir na listagem)
// 3. Grava tudo no SQLite em lotes de 50

import 'dotenv/config';
import axios from 'axios';
import { dbService } from '../services/db.service';

const api = axios.create({
  baseURL: process.env.SOLIDES_BASE_URL || 'http://employer.tangerino.com.br',
  headers: {
    Authorization: process.env.SOLIDES_TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

function mapear(c: any) {
  return {
    id:           Number(c.id),
    nome:         c.name ?? c.nome ?? '',
    phone:        c.phone ?? null,
    cpf:          c.cpf ?? null,
    email:        c.email ?? null,
    cargo:        c.jobRoleDTO?.description ?? c.jobRole?.description ?? null,
    departamento: c.currentWorkplaceDTO?.name ?? c.workplaceList?.[0]?.name ?? null,
    dataAdmissao: c.admissionDate ? new Date(c.admissionDate).toLocaleDateString('pt-BR') : null,
    ativo:        !c.fired,
  };
}

async function buscarDetalhe(id: number): Promise<any> {
  try {
    const { data } = await api.get('/employee/find', { params: { tangerinoId: id } });
    return data;
  } catch {
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Carga inicial — Colaboradores Solides → SQLite');
  console.log('═══════════════════════════════════════════════\n');

  const syncId = dbService.iniciarSync('carga_inicial');
  let totalProcessados = 0;
  let totalAtualizados = 0;
  let totalErros = 0;
  let page = 0;
  const size = 50;

  try {
    while (true) {
      console.log(`📄 Buscando página ${page}...`);

      const { data } = await api.get('/employee/find-all', {
        params: { page, size },
      });

      const lista: any[] = data?.content ?? [];
      const totalPages: number = data?.totalPages ?? 1;

      if (lista.length === 0) break;

      console.log(`   ${lista.length} colaboradores encontrados`);

      // Para cada colaborador da página, busca o detalhe individual
      // para garantir que temos telefone e CPF
      const lote: ReturnType<typeof mapear>[] = [];

      for (const c of lista) {
        try {
          // Se a listagem já trouxe phone e cpf, evita chamada extra
          const temDadosCompletos = c.phone && c.cpf;
          const detalhe = temDadosCompletos ? c : (await buscarDetalhe(c.id)) ?? c;
          lote.push(mapear(detalhe));
          totalProcessados++;
        } catch (err) {
          console.error(`   ⚠️  Erro ao processar colaborador ${c.id}:`, err);
          totalErros++;
        }
      }

      // Grava o lote inteiro de uma vez (transação SQLite)
      dbService.upsertLote(lote);
      totalAtualizados += lote.length;

      console.log(`   ✅ Lote gravado (${totalAtualizados} total)\n`);

      if (page + 1 >= totalPages) break;
      page++;

      // Pequena pausa para não sobrecarregar a API
      await new Promise((r) => setTimeout(r, 300));
    }

    dbService.finalizarSync(syncId, {
      total: totalProcessados,
      atualizados: totalAtualizados,
      erros: totalErros,
      status: 'ok',
    });

    const stats = dbService.stats();
    console.log('═══════════════════════════════════════════════');
    console.log('  Carga inicial concluída!');
    console.log(`  Total processados : ${totalProcessados}`);
    console.log(`  Gravados no banco : ${totalAtualizados}`);
    console.log(`  Erros             : ${totalErros}`);
    console.log('───────────────────────────────────────────────');
    console.log(`  Ativos no banco   : ${stats.ativos}`);
    console.log(`  Com telefone      : ${stats.comTelefone} de ${stats.ativos}`);

    if (stats.comTelefone < stats.ativos * 0.5) {
      console.log('\n  ⚠️  ATENÇÃO: menos de 50% dos colaboradores têm telefone cadastrado.');
      console.log('     O bot só consegue autenticar quem tem telefone preenchido na Solides.');
      console.log('     Peça ao cliente para preencher os dados antes de ir ao ar.\n');
    }

    console.log('═══════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Erro fatal na carga inicial:', err);
    dbService.finalizarSync(syncId, {
      total: totalProcessados,
      atualizados: totalAtualizados,
      erros: totalErros + 1,
      status: 'erro',
    });
    process.exit(1);
  }
}

main();
