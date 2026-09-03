import { fileURLToPath } from 'node:url'
import { env } from '@jomma/shared/env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

async function main() {
  const config = env()
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 })
  const db = drizzle(pool)

  console.log(`Migrating ${redact(config.DATABASE_URL)}`)
  await migrate(db, { migrationsFolder })
  console.log('Migrations applied.')

  await pool.end()
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@')
}

main().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
