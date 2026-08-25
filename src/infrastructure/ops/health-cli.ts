import { loadEnv } from '../../config/env.js';

/**
 * Docker HEALTHCHECK: HTTP GET /health. Код 0 — процесс жив и миграции на месте.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const url = `http://${env.HEALTH_HOST}:${String(env.HEALTH_PORT)}/health`;
  const response = await fetch(url);
  const body: unknown = await response.json();
  if (!response.ok) {
    console.error(body);
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
