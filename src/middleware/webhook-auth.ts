// src/middleware/webhook-auth.ts
import { Request, Response, NextFunction } from 'express';

// Valida que a requisição veio realmente da Z-API usando um segredo no header
export function webhookAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-webhook-secret'];

  if (!process.env.WEBHOOK_SECRET) {
    // Se não configurou segredo, passa (útil em desenvolvimento)
    next();
    return;
  }

  if (secret !== process.env.WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
