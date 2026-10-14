import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { HttpError } from '../errors/http.error.js';

@Injectable()
export class JsonContentTypeGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'Use Content-Type: application/json.');
    }
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      throw new HttpError(400, 'Request body must be a JSON object.');
    }
    return true;
  }
}
