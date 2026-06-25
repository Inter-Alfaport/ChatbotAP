// src/services/sync.service.ts
// Sync diário às 02:00 — busca apenas colaboradores alterados desde ontem
// e atualiza o banco local. Roda automaticamente junto com o servidor.

import cron from 'node-cron';
import axios from 'axios';
import { dbService } from './db.service';

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
    nome:         c.name ?? '',
    phone:        c.phone ?? null,
    cpf:          c.cpf ?? null,
    email:        c.email ?? null,
    cargo:        c.jobRoleDTO?.description ?? null,
    departamento: c.currentWorkplaceDTO?.name ?? c.workplaceList?.[0]?.name ?? null,
    dataAdmissao: c.admissionDate ? new Date(c.admissionDate).toLocaleDateString('pt-BR') : null,
    ativo:        !c.fired,
  };
}

export async function executarSync(): Promise<void> {
  const syncId = dbService.iniciarSync('sync_diario');
  let total = 0;
  let atualizados = 0;
  let erros = 0;

  try {
    // Busca colaboradores atualizados desde ontem à meia-noite
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    ontem.setHours(0, 0, 0, 0);
    const lastUpdate = ontem.getTime(); // milissegundos, conforme API Tangerino

    console.log(`[Sync] Iniciando sync diário — alterações desde ${ontem.toLocaleDateString('pt-BR')}`);

    let page = 0;
    const size = 50;

    while (true) {
      const { data } = await api.get('/employee/find-all', {
        params: { page, size, lastUpdate },
      });

      const lista: any[] = data?.content ?? [];
      const totalPages: number = data?.totalPages ?? 1;

      if (lista.length === 0) break;

      const lote = lista.map(mapear);
      dbService.upsertLote(lote);

      total += lista.length;
      atualizados += lote.length;

      if (page + 1 >= totalPages) break;
      page++;

      await new Promise((r) => setTimeout(r, 200));
    }

    dbService.finalizarSync(syncId, { total, atualizados, erros, status: 'ok' });

    const stats = dbService.stats();
    console.log(`[Sync] ✅ Concluído — ${atualizados} colaboradores atualizados | Total ativo: ${stats.ativos} | Com telefone: ${stats.comTelefone}`);

  } catch (err) {
    console.error('[Sync] ❌ Erro no sync diário:', err);
    dbService.finalizarSync(syncId, { total, atualizados, erros: erros + 1, status: 'erro' });
  }
}

// Registra o cron job — roda todo dia às 02:00 (horário de Brasília)
export function iniciarSyncScheduler(): void {
  cron.schedule('0 2 * * *', () => {
    executarSync();
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[Sync] Scheduler registrado — sync diário às 02:00 (Brasília)');
}
