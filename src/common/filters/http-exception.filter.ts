import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HttpError } from '../errors/http.error.js';
import { guidedError, isGuidedRoute } from '../../voice/guided-error.js';

interface BodyParserError extends Error {
  readonly type?: string;
  readonly status?: number;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const { status, message } = this.describe(exception);

    if (status >= 500) {
      if (exception instanceof HttpError) {
        this.logger.error(`${request.method} ${request.originalUrl}: ${exception.message}`);
      } else {
        this.logger.error(
          `${request.method} ${request.originalUrl} failed`,
          exception instanceof Error ? exception.stack : undefined,
        );
      }
    }
    if (!response.headersSent) {
      response.status(status).json(isGuidedRoute(request.originalUrl) ? guidedError(status, message) : { error: message });
    }
  }

  private describe(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpError) return { status: exception.status, message: exception.message };

    if (exception instanceof Error) {
      const parserException = exception as BodyParserError;
      if (parserException.type === 'entity.too.large' || parserException.status === 413) {
        return { status: 413, message: 'JSON body is too large (maximum 16 KiB).' };
      }
      if (parserException.type === 'entity.parse.failed') {
        return { status: 400, message: 'Request body must be valid JSON.' };
      }
    }

    if (exception instanceof HttpException) {
      const cause = (exception as HttpException & { cause?: unknown }).cause;
      if (cause instanceof Error) {
        const parserCause = cause as BodyParserError;
        if (parserCause.type === 'entity.too.large' || parserCause.status === 413) {
          return { status: 413, message: 'JSON body is too large (maximum 16 KiB).' };
        }
        if (parserCause.type === 'entity.parse.failed') {
          return { status: 400, message: 'Request body must be valid JSON.' };
        }
      }
      const value = exception.getResponse();
      const rawMessage =
        typeof value === 'string'
          ? value
          : 'message' in value
            ? (value as { message?: unknown }).message
            : undefined;
      const message: unknown = Array.isArray(rawMessage) ? (rawMessage as unknown[])[0] : rawMessage;
      return { status: exception.getStatus(), message: typeof message === 'string' ? message : exception.message };
    }

    return { status: 500, message: 'Unexpected server error.' };
  }
}
