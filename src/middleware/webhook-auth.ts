import { Request, Response, NextFunction } from 'express';

export function webhookAuth(req: Request, res: Response, next: NextFunction): void {
  next();
}