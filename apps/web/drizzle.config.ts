import { env } from '@jomma/shared/env'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: env().DATABASE_URL,
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
