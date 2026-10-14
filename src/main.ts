import 'reflect-metadata';
import { APP_CONFIG } from './config/configuration.js';
import type { AppConfig } from './config/config.types.js';
import { createApplication } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, config.host);
  console.log(
    `mobie starter: http://localhost:${config.port}\nOpen the page and sign in with your staging passenger account. Tokens stay in memory; restart requires login.`,
  );
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  console.error(message);
  process.exitCode = 1;
});
