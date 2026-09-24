import './scripts/load-env';
import { getEnvVariable, VARS } from '@/lib/utils/env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: getEnvVariable(VARS.APP_CONFIG_DATABASE_URL, true),
    ssl: false,
  },
});
