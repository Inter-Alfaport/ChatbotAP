// src/routes/relatorios.controller.ts
import { Router, Request, Response } from 'express';
import { pool } from '../services/db.service';
import { sqlInicioDiaBr, sqlFimDiaBrExclusivo, TZ_BRASIL } from '../utils/horario';

const router = Router();

// Middleware de autenticação simples do dashboard
function relatoriosAuth(req: Request, res: Response, next: Function): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) { next(); return; }
  const querySecret = req.query.secret || req.headers['x-admin-secret'] || req.headers['authorization'];
  if (querySecret !== secret) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  next();
}

router.use(relatoriosAuth);

// ─── Helpers ───────────────────────────────────────────────────────────────────
function buildDateFilter(
  de: string | undefined,
  ate: string | undefined,
  params: any[],
  paramIndex: number,
  campo = 'data_inicio'
): { clause: string; nextIndex: number } {
  const filters: string[] = [];
  if (de) {
    filters.push(`${campo} >= ${sqlInicioDiaBr(`$${paramIndex}`)}`);
    params.push(de);
    paramIndex++;
  }
  if (ate) {
    filters.push(`${campo} < ${sqlFimDiaBrExclusivo(`$${paramIndex}`)}`);
    params.push(ate);
    paramIndex++;
  }
  return { clause: filters.length ? filters.join(' AND ') : '', nextIndex: paramIndex };
}

// Helper para filtrar transbordos válidos para SLA (Seg-Sex, 09h às 17h no fuso de Brasília)
const sqlHorarioValidoSla = `(
  EXTRACT(ISODOW FROM (data_transbordo AT TIME ZONE '${TZ_BRASIL}')) BETWEEN 1 AND 5
  AND (data_transbordo AT TIME ZONE '${TZ_BRASIL}')::time >= '09:00:00'::time
  AND (data_transbordo AT TIME ZONE '${TZ_BRASIL}')::time < '17:00:00'::time
)`;

// ── Visão Geral: KPIs ────────────────────────────────────────────────────────
router.get('/visao-geral', async (req: Request, res: Response) => {
  const { de, ate, atendente } = req.query;
  const params: any[] = [];
  const filters: string[] = [];
  let paramIndex = 1;

  const { clause, nextIndex } = buildDateFilter(de as string, ate as string, params, paramIndex);
  if (clause) filters.push(clause);
  paramIndex = nextIndex;

  if (atendente) {
    filters.push(`atendente_telefone = $${paramIndex}`);
    params.push(atendente);
    paramIndex++;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const whereAnd = filters.length > 0 ? `WHERE ${filters.join(' AND ')} AND` : 'WHERE';

  try {
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM atendimentos ${whereClause}`, params
    );
    const total = totalRes.rows[0].count;

    const resolvidosBotRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM atendimentos ${whereAnd} resolvido_pelo_bot = TRUE`, params
    );
    const resolvidosBot = resolvidosBotRes.rows[0].count;

    const transbordosRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM atendimentos ${whereAnd} houve_transbordo = TRUE`, params
    );
    const transbordos = transbordosRes.rows[0].count;

    const taxaAutomacao = total > 0 ? Math.round((resolvidosBot / total) * 1000) / 10 : 0;

    const tmedRes = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)))::float as avg_time
       FROM atendimentos ${whereAnd} data_primeira_resposta IS NOT NULL AND data_transbordo IS NOT NULL AND ${sqlHorarioValidoSla}`, params
    );
    const tempoMedio = tmedRes.rows[0].avg_time || 0;

    const slaRes = await pool.query(`
      SELECT
        COUNT(*)::int as total_respondido,
        COUNT(CASE WHEN (data_primeira_resposta - data_transbordo) <= INTERVAL '2 hours' THEN 1 END)::int as no_sla
      FROM atendimentos
      ${whereAnd} data_primeira_resposta IS NOT NULL AND data_transbordo IS NOT NULL AND ${sqlHorarioValidoSla}
    `, params);
    const totalRespondido = slaRes.rows[0].total_respondido || 0;
    const noSla = slaRes.rows[0].no_sla || 0;
    const slaCumprido = totalRespondido > 0 ? Math.round((noSla / totalRespondido) * 100) : 100;

    const satRes = await pool.query(
      `SELECT AVG(avaliacao_nota)::float as avg_nota, COUNT(avaliacao_nota)::int as total_notas
       FROM atendimentos ${whereAnd} avaliacao_respondida = TRUE`, params
    );
    const satisfacaoMedia = satRes.rows[0].avg_nota
      ? Math.round(satRes.rows[0].avg_nota * 10) / 10 : 0;
    const totalAvaliacoes = satRes.rows[0].total_notas || 0;

    const atrasosRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM atendimentos ${whereAnd} atraso_sla = TRUE`, params
    );
    const atrasosCount = atrasosRes.rows[0].count || 0;

    res.json({
      total,
      resolvidosBot,
      transbordos,
      taxaAutomacao,
      tempoMedio,
      slaCumprido,
      satisfacaoMedia,
      totalAvaliacoes,
      atrasosCount,
    });
  } catch (err: any) {
    console.error('[Relatorios] visao-geral error:', err.message);
    res.json({ total: 0, resolvidosBot: 0, transbordos: 0, taxaAutomacao: 0, tempoMedio: 0, slaCumprido: 0, satisfacaoMedia: 0, totalAvaliacoes: 0, atrasosCount: 0 });
  }
});

// ── Atendimentos por dia ──────────────────────────────────────────────────────
router.get('/atendimentos-por-dia', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const whereClause = clause ? `WHERE ${clause}` : '';

  try {
    const result = await pool.query(`
      SELECT
        TO_CHAR(data_inicio AT TIME ZONE '${TZ_BRASIL}', 'DD/MM') as dia,
        COUNT(*)::int as count
      FROM atendimentos ${whereClause}
      GROUP BY DATE_TRUNC('day', data_inicio AT TIME ZONE '${TZ_BRASIL}'), TO_CHAR(data_inicio AT TIME ZONE '${TZ_BRASIL}', 'DD/MM')
      ORDER BY DATE_TRUNC('day', data_inicio AT TIME ZONE '${TZ_BRASIL}') ASC
    `, params);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[Relatorios] atendimentos-por-dia error:', err.message);
    res.json([]);
  }
});

// ── Distribuição por Categoria ────────────────────────────────────────────────
router.get('/transbordos-por-motivo', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  try {
    const result = await pool.query(`
      SELECT
        COALESCE(
          NULLIF(categoria_assunto, ''),
          CASE categoria
            WHEN 'Ponto' THEN 'Ponto Eletrônico'
            WHEN 'Pagamento' THEN 'Salário e Pagamento'
            WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
            WHEN 'Férias' THEN 'Férias'
            WHEN 'Cadastro' THEN 'Identificação / Cadastro'
            WHEN 'Outro assunto' THEN 'Outros'
            ELSE NULLIF(categoria, '')
          END,
          motivo_transbordo,
          'Outros'
        ) as motivo,
        COUNT(*)::int as count
      FROM atendimentos
      WHERE houve_transbordo = TRUE ${extraFilter}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
    `, params);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[Relatorios] transbordos-por-motivo error:', err.message);
    res.json([]);
  }
});

// ── Distribuição do tempo de resposta ────────────────────────────────────────
router.get('/distribuicao-tempo-resposta', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  try {
    const result = await pool.query(`
      SELECT
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) <= 900 THEN 1 END)::int as ate_15m,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) > 900
                    AND EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) <= 1800 THEN 1 END)::int as de_15_30m,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) > 1800
                    AND EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) <= 3600 THEN 1 END)::int as de_30_60m,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) > 3600
                    AND EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) <= 7200 THEN 1 END)::int as de_1_2h,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (data_primeira_resposta - data_transbordo)) > 7200 THEN 1 END)::int as mais_2h
      FROM atendimentos
      WHERE data_primeira_resposta IS NOT NULL AND data_transbordo IS NOT NULL AND ${sqlHorarioValidoSla} ${extraFilter}
    `, params);

    const row = result.rows[0];
    res.json([
      { label: 'Até 15 min', count: row.ate_15m || 0 },
      { label: '15 a 30 min', count: row.de_15_30m || 0 },
      { label: '30 a 60 min', count: row.de_30_60m || 0 },
      { label: '1h a 2 horas', count: row.de_1_2h || 0 },
      { label: 'Mais de 2h (Fora SLA)', count: row.mais_2h || 0 },
    ]);
  } catch (err: any) {
    console.error('[Relatorios] distribuicao-tempo-resposta error:', err.message);
    res.json([]);
  }
});

// ── Desempenho da Equipe ───────────────────────────────────────────────────────
router.get('/desempenho-equipe', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  const sqlHorarioValidoAtd = sqlHorarioValidoSla.replace(/data_transbordo/g, 'a.data_transbordo');

  try {
    const result = await pool.query(`
      SELECT
        a.atendente_telefone as telefone,
        COALESCE(
          c.nome,
          CASE
            WHEN a.atendente_telefone = 'fromMe' THEN 'Atendimento Direto (Celular/Web)'
            WHEN a.encerrado_por = 'inatividade' THEN 'Inativo'
            ELSE a.atendente_telefone
          END
        ) as nome,
        COUNT(*)::int as atendimentos,
        AVG(CASE WHEN ${sqlHorarioValidoAtd} THEN EXTRACT(EPOCH FROM (a.data_primeira_resposta - a.data_transbordo)) END)::float as tempo_medio,
        COUNT(CASE WHEN ${sqlHorarioValidoAtd} AND (a.data_primeira_resposta - a.data_transbordo) <= INTERVAL '2 hours' THEN 1 END)::float
          / NULLIF(COUNT(CASE WHEN ${sqlHorarioValidoAtd} AND a.data_primeira_resposta IS NOT NULL AND a.data_transbordo IS NOT NULL THEN 1 END), 0)
          * 100 as sla,
        AVG(a.avaliacao_nota)::float as satisfacao
      FROM atendimentos a
      LEFT JOIN colaboradores c ON c.phone = a.atendente_telefone
      WHERE a.atendente_telefone IS NOT NULL ${extraFilter}
      GROUP BY a.atendente_telefone, c.nome, a.encerrado_por
      ORDER BY atendimentos DESC
    `, params);

    const formatted = result.rows.map((row: any) => {
      const totalSec = row.tempo_medio ? Math.round(row.tempo_medio) : null;
      const tempoMedioStr = totalSec
        ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`
        : '--';
      return {
        nome: row.nome || 'Inativo',
        telefone: row.telefone,
        atendimentos: row.atendimentos,
        tempoMedioStr,
        sla: row.sla !== null ? Math.round(row.sla) : 100,
        satisfacao: row.satisfacao ? Math.round(row.satisfacao * 10) / 10 : 0,
      };
    });

    res.json(formatted);
  } catch (err: any) {
    console.error('[Relatorios] desempenho-equipe error:', err.message);
    res.json([]);
  }
});

// ── Alertas ────────────────────────────────────────────────────────────────────
router.get('/alertas', async (_req: Request, res: Response) => {
  try {
    const aguardandoRes = await pool.query(`
      SELECT COUNT(*)::int as count FROM atendimentos
      WHERE status = 'em_transbordo'
        AND data_transbordo IS NOT NULL
        AND data_transbordo < NOW() - INTERVAL '2 hours'
        AND ${sqlHorarioValidoSla}
    `);
    const foraSlaRes = await pool.query(`
      SELECT COUNT(*)::int as count FROM atendimentos
      WHERE atraso_sla = TRUE
    `);
    const reincidentesRes = await pool.query(`
      SELECT COUNT(*)::int as count FROM (
        SELECT telefone FROM atendimentos
        WHERE data_inicio > NOW() - INTERVAL '7 days'
        GROUP BY telefone HAVING COUNT(*) >= 2
      ) as sub
    `);

    res.json({
      aguardando: aguardandoRes.rows[0].count,
      foraSla: foraSlaRes.rows[0].count,
      reincidentes: reincidentesRes.rows[0].count,
    });
  } catch (err: any) {
    console.error('[Relatorios] alertas error:', err.message);
    res.json({ aguardando: 0, foraSla: 0, reincidentes: 0 });
  }
});

// ── Lista paginada de Atendimentos ─────────────────────────────────────────────
router.get('/atendimentos', async (req: Request, res: Response) => {
  const { de, ate, status, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;

  const params: any[] = [];
  const filters: string[] = [];
  const { clause, nextIndex } = buildDateFilter(de as string, ate as string, params, 1);
  if (clause) filters.push(clause);
  let paramIndex = nextIndex;

  if (status && status !== 'todos') {
    filters.push(`a.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    filters.push(`(
      a.id::text ILIKE $${paramIndex} OR
      a.nome_colaborador ILIKE $${paramIndex} OR
      a.telefone ILIKE $${paramIndex}
    )`);
    params.push(term);
    paramIndex++;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    // Total para paginação
    const countRes = await pool.query(
      `SELECT COUNT(*)::int as total FROM atendimentos a ${whereClause}`, params
    );
    const total = countRes.rows[0].total;

    // Dados paginados
    const dataParams = [...params, perPage, offset];
    const result = await pool.query(`
      SELECT
        a.id,
        a.telefone,
        a.nome_colaborador,
        a.status,
        a.data_inicio,
        a.data_encerramento,
        a.data_transbordo,
        a.data_primeira_resposta,
        a.houve_transbordo,
        a.resolvido_pelo_bot,
        a.encerrado_por,
        a.atraso_sla,
        a.avaliacao_nota,
        a.avaliacao_respondida,
        a.motivo_transbordo,
        COALESCE(
          NULLIF(a.categoria_assunto, ''),
          CASE a.categoria
            WHEN 'Ponto' THEN 'Ponto Eletrônico'
            WHEN 'Pagamento' THEN 'Salário e Pagamento'
            WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
            WHEN 'Férias' THEN 'Férias'
            WHEN 'Cadastro' THEN 'Identificação / Cadastro'
            WHEN 'Outro assunto' THEN 'Outros'
            ELSE NULLIF(a.categoria, '')
          END,
          CASE WHEN a.houve_transbordo THEN a.motivo_transbordo ELSE 'Outros' END,
          'Outros'
        ) as categoria_display,
        COALESCE(
          c.nome,
          CASE
            WHEN a.atendente_telefone = 'fromMe' THEN 'Atendimento Direto (Celular/Web)'
            WHEN a.encerrado_por = 'inatividade' THEN 'Inativo'
            ELSE a.atendente_telefone
          END
        ) as atendente_nome
      FROM atendimentos a
      LEFT JOIN colaboradores c ON c.phone = a.atendente_telefone
      ${whereClause}
      ORDER BY a.data_inicio DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, dataParams);

    res.json({
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      data: result.rows,
    });
  } catch (err: any) {
    console.error('[Relatorios] atendimentos error:', err.message);
    res.json({ total: 0, page: 1, perPage: 20, totalPages: 0, data: [] });
  }
});

// ── Distribuição de Satisfação (para aba Satisfação) ──────────────────────────
router.get('/satisfacao', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  try {
    const distRes = await pool.query(`
      SELECT avaliacao_nota as nota, COUNT(*)::int as count
      FROM atendimentos
      WHERE avaliacao_respondida = TRUE ${extraFilter}
      GROUP BY avaliacao_nota
      ORDER BY avaliacao_nota
    `, params);

    const totalRes = await pool.query(`
      SELECT
        AVG(avaliacao_nota)::float as media,
        COUNT(*)::int as total
      FROM atendimentos
      WHERE avaliacao_respondida = TRUE ${extraFilter}
    `, params);

    // Distribuição por canal (bot vs humano)
    const canalRes = await pool.query(`
      SELECT
        CASE WHEN houve_transbordo THEN 'Humano' ELSE 'Bot' END as canal,
        AVG(avaliacao_nota)::float as media,
        COUNT(*)::int as total
      FROM atendimentos
      WHERE avaliacao_respondida = TRUE ${extraFilter}
      GROUP BY 1
    `, params);

    const etiquetas: Record<number, string> = { 1: 'Péssimo', 2: 'Ruim', 3: 'Regular', 4: 'Bom', 5: 'Excelente' };
    const distribuicao = [1, 2, 3, 4, 5].map(n => {
      const found = distRes.rows.find((r: any) => r.nota === n);
      return { nota: n, label: etiquetas[n], count: found ? found.count : 0 };
    });

    res.json({
      media: totalRes.rows[0].media ? Math.round(totalRes.rows[0].media * 10) / 10 : 0,
      total: totalRes.rows[0].total || 0,
      distribuicao,
      porCanal: canalRes.rows,
    });
  } catch (err: any) {
    console.error('[Relatorios] satisfacao error:', err.message);
    res.json({ media: 0, total: 0, distribuicao: [], porCanal: [] });
  }
});

// ── Lista de Atendimentos Recentes Avaliados (Aba Satisfação) ─────────────────
router.get('/atendimentos-avaliados', async (req: Request, res: Response) => {
  const { de, ate, nota } = req.query;
  const params: any[] = [];
  const filters: string[] = ['a.avaliacao_respondida = TRUE'];
  let paramIndex = 1;

  const { clause, nextIndex } = buildDateFilter(de as string, ate as string, params, paramIndex);
  if (clause) filters.push(clause);
  paramIndex = nextIndex;

  if (nota && nota !== 'todas') {
    const notaNum = parseInt(nota as string, 10);
    if (!isNaN(notaNum)) {
      filters.push(`a.avaliacao_nota = $${paramIndex}`);
      params.push(notaNum);
      paramIndex++;
    }
  }

  const whereClause = `WHERE ${filters.join(' AND ')}`;

  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.nome_colaborador,
        a.telefone,
        a.data_inicio,
        a.data_encerramento,
        a.avaliacao_nota,
        COALESCE(
          NULLIF(a.categoria_assunto, ''),
          CASE a.categoria
            WHEN 'Ponto' THEN 'Ponto Eletrônico'
            WHEN 'Pagamento' THEN 'Salário e Pagamento'
            WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
            WHEN 'Férias' THEN 'Férias'
            WHEN 'Cadastro' THEN 'Identificação / Cadastro'
            WHEN 'Outro assunto' THEN 'Outros'
            ELSE NULLIF(a.categoria, '')
          END,
          CASE WHEN a.houve_transbordo THEN a.motivo_transbordo ELSE 'Outros' END,
          'Outros'
        ) as assunto,
        COALESCE(
          c.nome,
          CASE
            WHEN a.atendente_telefone = 'fromMe' THEN 'Atendimento Direto (Celular/Web)'
            WHEN a.encerrado_por = 'inatividade' THEN 'Inativo'
            ELSE a.atendente_telefone
          END
        ) as atendente_nome
      FROM atendimentos a
      LEFT JOIN colaboradores c ON c.phone = a.atendente_telefone
      ${whereClause}
      ORDER BY a.data_inicio DESC
      LIMIT 20
    `, params);

    res.json(result.rows);
  } catch (err: any) {
    console.error('[Relatorios] atendimentos-avaliados error:', err.message);
    res.json([]);
  }
});

// ── Origem dos Transbordos ───────────────────────────────────────────────────
router.get('/origem-transbordos', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  try {
    const result = await pool.query(`
      SELECT
        COALESCE(origem_transbordo, 'desconhecido') as origem,
        COUNT(*)::int as count
      FROM atendimentos
      WHERE houve_transbordo = TRUE ${extraFilter}
      GROUP BY 1
      ORDER BY count DESC
    `, params);
    res.json(result.rows);
  } catch (err: any) {
    console.error('[Relatorios] origem-transbordos error:', err.message);
    res.json([]);
  }
});

// ── Motivos e Assuntos (categorias) ────────────────────────────────────────────
router.get('/motivos-assuntos', async (req: Request, res: Response) => {
  const { de, ate } = req.query;
  const params: any[] = [];
  const { clause } = buildDateFilter(de as string, ate as string, params, 1);
  const extraFilter = clause ? `AND ${clause}` : '';

  try {
    const result = await pool.query(`
      SELECT
        COALESCE(
          NULLIF(categoria_assunto, ''),
          CASE categoria
            WHEN 'Ponto' THEN 'Ponto Eletrônico'
            WHEN 'Pagamento' THEN 'Salário e Pagamento'
            WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
            WHEN 'Férias' THEN 'Férias'
            WHEN 'Cadastro' THEN 'Identificação / Cadastro'
            WHEN 'Outro assunto' THEN 'Outros'
            ELSE NULLIF(categoria, '')
          END,
          CASE WHEN houve_transbordo THEN motivo_transbordo ELSE 'Outros' END,
          'Outros'
        ) as assunto,
        COUNT(*)::int as count
      FROM atendimentos
      WHERE 1=1 ${extraFilter}
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 15
    `, params);

    const total = result.rows.reduce((sum: number, r: any) => sum + r.count, 0);
    const items = result.rows.map((row: any) => ({
      assunto: row.assunto,
      count: row.count,
      percentual: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0,
    }));

    res.json({ total, items });
  } catch (err: any) {
    console.error('[Relatorios] motivos-assuntos error:', err.message);
    res.json({ total: 0, items: [] });
  }
});

// ── Lista de Atendimentos Recentes por Motivo/Assunto (Aba Motivos) ───────────
router.get('/atendimentos-motivos', async (req: Request, res: Response) => {
  const { de, ate, motivo } = req.query;
  const params: any[] = [];
  const filters: string[] = [];
  let paramIndex = 1;

  const { clause, nextIndex } = buildDateFilter(de as string, ate as string, params, paramIndex);
  if (clause) filters.push(clause);
  paramIndex = nextIndex;

  const exprAssunto = `
    COALESCE(
      NULLIF(a.categoria_assunto, ''),
      CASE a.categoria
        WHEN 'Ponto' THEN 'Ponto Eletrônico'
        WHEN 'Pagamento' THEN 'Salário e Pagamento'
        WHEN 'Benefícios' THEN 'Benefícios (VR / VT)'
        WHEN 'Férias' THEN 'Férias'
        WHEN 'Cadastro' THEN 'Identificação / Cadastro'
        WHEN 'Outro assunto' THEN 'Outros'
        ELSE NULLIF(a.categoria, '')
      END,
      CASE WHEN a.houve_transbordo THEN a.motivo_transbordo ELSE 'Outros' END,
      'Outros'
    )
  `;

  if (motivo && String(motivo).trim() && String(motivo).trim() !== 'todos') {
    filters.push(`${exprAssunto} = $${paramIndex}`);
    params.push(String(motivo).trim());
    paramIndex++;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.nome_colaborador,
        a.telefone,
        a.data_inicio,
        a.data_encerramento,
        a.status,
        ${exprAssunto} as assunto,
        COALESCE(
          c.nome,
          CASE
            WHEN a.atendente_telefone = 'fromMe' THEN 'Atendimento Direto (Celular/Web)'
            WHEN a.encerrado_por = 'inatividade' THEN 'Inativo'
            ELSE a.atendente_telefone
          END
        ) as atendente_nome
      FROM atendimentos a
      LEFT JOIN colaboradores c ON c.phone = a.atendente_telefone
      ${whereClause}
      ORDER BY a.data_inicio DESC
      LIMIT 20
    `, params);

    res.json(result.rows);
  } catch (err: any) {
    console.error('[Relatorios] atendimentos-motivos error:', err.message);
    res.json([]);
  }
});

export default router;
