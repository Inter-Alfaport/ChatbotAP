// src/routes/admin.controller.ts
// Rotas administrativas — todas protegidas com ADMIN_SECRET
import { Router, Request, Response } from 'express';
import { dbService } from '../services/db.service';

const router = Router();

// ─── Middleware de autenticação admin ─────────────────────────────────────────
function adminAuth(req: Request, res: Response, next: Function): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  next();
}

router.use(adminAuth);

// ── Seed manual de colaboradores Alfaport (solução temporária) ─────────────────
router.post('/seed-alfaport', async (req: Request, res: Response) => {
  const membros = [
    { id: 9001, nome: 'Yasmin Gonçalves Fontes', phone: '5521983594047', cargo: 'Atendente',       departamento: 'Atendimento' },
    { id: 9002, nome: 'Ana',                     phone: '5521979376817', cargo: 'Atendente',       departamento: 'Atendimento' },
    { id: 9003, nome: 'Patricia Almeida',         phone: '5521964650514', cargo: 'Analista',        departamento: 'Financeiro'  },
    { id: 9004, nome: 'Dantas',                   phone: '5521964530259', cargo: 'Diretor',         departamento: 'Diretoria'   },
  ];

  try {
    for (const m of membros) {
      await dbService.upsert({
        id:           m.id,
        nome:         m.nome,
        phone:        m.phone,
        cargo:        m.cargo,
        departamento: m.departamento,
        ativo:        true,
      });
    }
    console.log(`[Seed] ${membros.length} membros Alfaport inseridos com sucesso.`);
    res.json({ ok: true, inseridos: membros.length, membros });
  } catch (err: any) {
    console.error('[Seed] Erro ao inserir membros:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Backup de telefones ──────────────────────────────────────────────────────
router.get('/export-phones', async (_req: Request, res: Response) => {
  try {
    const backup = await dbService.exportarTelefones();
    res.json({ ok: true, totalVinculos: backup.vinculos.length, totalHistorico: backup.historico.length, data: backup });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Restauração de telefones ─────────────────────────────────────────────────
router.post('/restore-phones', async (req: Request, res: Response) => {
  try {
    const vinculos = req.body?.vinculos || req.body;
    if (!Array.isArray(vinculos)) {
      res.status(400).json({ error: 'Formato inválido. Envie um array de { cpf, phone }.' });
      return;
    }
    const restaurados = await dbService.restaurarTelefones(vinculos);
    res.json({ ok: true, restaurados });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: listar colaboradores (agora protegido e no Postgres) ───────────────
router.get('/colaboradores', async (_req: Request, res: Response) => {
  try {
    const stats = await dbService.stats();
    const rows = await dbService.listarColaboradores();
    res.json({ total: rows.length, stats, colaboradores: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
