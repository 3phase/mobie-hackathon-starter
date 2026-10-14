import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG } from '../../config/configuration.js';
import type { AppConfig } from '../../config/config.types.js';
import { IS_PUBLIC } from '../decorators/public.decorator.js';
import { HttpError } from '../errors/http.error.js';

export function equalSecret(actual: unknown, expected: unknown): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!equalSecret(request.headers.authorization, `Bearer ${this.config.apiKey}`)) {
      throw new HttpError(401, 'Use the STARTER_API_KEY as a Bearer token for this server.');
    }
    return true;
  }
}
