import { expect, test } from 'bun:test'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syncBuildOutput } from './sync-build-output.js'

test('syncs changed files, removes stale files, and preserves unchanged mtimes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'schaltwerk-build-sync-'))
  const source = path.join(root, 'source')
  const destination = path.join(root, 'destination')

  try {
    await Promise.all([
      mkdir(path.join(source, 'assets'), { recursive: true }),
      mkdir(path.join(destination, 'assets'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(source, 'index.html'), 'new'),
      writeFile(path.join(destination, 'index.html'), 'old'),
      writeFile(path.join(source, 'assets', 'stable.js'), 'stable'),
      writeFile(path.join(destination, 'assets', 'stable.js'), 'stable'),
      writeFile(path.join(destination, 'stale.js'), 'stale'),
    ])

    const stablePath = path.join(destination, 'assets', 'stable.js')
    const stableTimestamp = new Date('2020-01-02T03:04:05.000Z')
    await utimes(stablePath, stableTimestamp, stableTimestamp)

    await syncBuildOutput(source, destination)

    expect(await readFile(path.join(destination, 'index.html'), 'utf8')).toBe('new')
    expect((await stat(stablePath)).mtimeMs).toBe(stableTimestamp.getTime())
    await expect(access(path.join(destination, 'stale.js'))).rejects.toHaveProperty('code', 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
