import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { HttpError } from './common/errors/http.error.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { applySecurityHeaders } from './common/middleware/security-headers.middleware.js';

export function configureApplication(app: NestExpressApplication): NestExpressApplication {
  app.use(express.json({ limit: 16_384, strict: false }));
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction): void => {
    const parserError = error as { type?: unknown; status?: unknown };
    if (parserError.type === 'entity.too.large' || parserError.status === 413) {
      applySecurityHeaders(response);
      response.status(413).json({ error: 'JSON body is too large (maximum 16 KiB).' });
      return;
    }
    if (parserError.type === 'entity.parse.failed') {
      applySecurityHeaders(response);
      response.status(400).json({ error: 'Request body must be valid JSON.' });
      return;
    }
    next(error);
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
      stopAtFirstError: true,
      exceptionFactory: (errors) => {
        const first = errors[0];
        const message = first?.constraints ? Object.values(first.constraints)[0] : undefined;
        return new HttpError(400, message ?? 'Request validation failed.');
      },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const server: import('node:http').Server = app.getHttpServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return app;
}

export async function createApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  return configureApplication(app);
}
