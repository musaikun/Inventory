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

  // 本番の preflight（読むだけ）が確かめる sentinel が、migrate.sh の sentinel と同じであること。
  // 片方だけ足すと、preflight で「どこまで当たっているか」が見えないまま apply することになる。
  it('scripts/preflight-prod.sh は migrate.sh と同じ sentinel を確かめる', async () => {
    const script = await readFile(fileURLToPath(migrateScriptUrl), 'utf8')
    const sentinels = [...script.matchAll(/apply_if_missing\s+\d{4}_[^\s]+\.sql\s+(\S+)/g)].map(m => m[1])
    const preflight = await readFile(fileURLToPath(new URL('../../scripts/preflight-prod.sh', import.meta.url)), 'utf8')
    const block = preflight.match(/WHERE name IN \(([\s\S]*?)\)/)[1]
    const checked = [...block.matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(checked).toEqual(sentinels)
  })
})
