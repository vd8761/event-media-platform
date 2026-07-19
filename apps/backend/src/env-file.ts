// Loads apps/backend/.env into process.env for local development.
//
// Must be imported before anything that reads config: app.module.ts calls
// ConfigRepository.getEnv() at module scope, and module bodies run in import
// order, so this has to be the first import in main.ts.
//
// Deployed environments inject env directly (compose env_file, the platform's
// dashboard) and simply have no .env to find — a missing file is not an error.
// Real environment variables always win: loadEnvFile does not overwrite them.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = process.env.EL_ENV_FILE || resolve(process.cwd(), '.env');

if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    // A malformed .env should be loud — it silently changes which database
    // and which R2 bucket the process talks to.
    console.error(`Failed to load env file ${envFile}:`, error);
    process.exit(1);
  }
}
