import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrateScriptUrl = new URL('../../scripts/migrate.sh', import.meta.url)
const migrationsDirUrl = new URL('../migrations/', import.meta.url)

describe('scripts/migrate.sh migration coverage', () => {
  it('all migration files are listed in order', async () => {
    const script = await readFile(fileURLToPath(migrateScriptUrl), 'utf8')
    const listed = [...script.matchAll(/apply_if_missing\s+(\d{4}_[^\s]+\.sql)\s+/g)]
      .map(match => match[1])
    const migrationFiles = (await readdir(fileURLToPath(migrationsDirUrl)))
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort()

    expect(listed).toEqual(migrationFiles)
  })
})
