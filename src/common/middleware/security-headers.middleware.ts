import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export function applySecurityHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  public use(_request: Request, response: Response, next: NextFunction): void {
    applySecurityHeaders(response);
    next();
  }
}
