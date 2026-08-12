import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de autenticação do webhook da Evolution API.
 * Valida o header x-webhook-secret contra WEBHOOK_SECRET.
 * Se WEBHOOK_SECRET não estiver definido, permite todas as requisições (compatibilidade).
 */
export function webhookAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.WEBHOOK_SECRET;

  // Se não há secret configurado, permite tudo (mantém compatibilidade com deploy atual)
  if (!secret) {
    next();
    return;
  }

  const headerSecret = req.headers['x-webhook-secret'] as string | undefined;

  if (headerSecret === secret) {
    next();
    return;
  }

  console.warn(`[WebhookAuth] Requisição bloqueada — secret inválido de ${req.ip}`);
  res.status(401).json({ error: 'Não autorizado.' });
}