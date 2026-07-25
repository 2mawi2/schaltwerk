import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildManualAction,
  parseStatusOutput,
  prepareDesktopCommands,
} from './harnessConfig.js'

const repoRoot = resolve(import.meta.dirname, '..', '..')

describe('prepareDesktopCommands', () => {
  it('creates the disposable fixture before launching Schaltwerk', () => {
    expect(prepareDesktopCommands).toEqual([
      'wait-for-computer-server',
      'sync-source',
      'install-deps',
      'build-app',
      'reset-app-state',
      'prepare-fixture',
      'launch-app',
      'wait-for-window',
    ])
  })
})

describe('buildManualAction', () => {
  it('builds coordinate and text actions for the manual CLI', () => {
    expect(buildManualAction('click', { x: '100', y: '200', button: 'right' })).toEqual({
      type: 'click',
      x: 100,
      y: 200,
      button: 'right',
    })
    expect(buildManualAction('type', { text: 'hello Schaltwerk' })).toEqual({
      type: 'type',
      text: 'hello Schaltwerk',
    })
    expect(buildManualAction('press', { keys: 'CTRL+SHIFT+P' })).toEqual({
      type: 'keypress',
      keys: ['CTRL', 'SHIFT', 'P'],
    })
  })

  it('rejects a click without coordinates', () => {
    expect(() => buildManualAction('click', { x: '100' })).toThrow('click requires --x and --y')
  })
})

describe('parseStatusOutput', () => {
  it('parses desktop status into structured fields', () => {
    expect(parseStatusOutput([
      'schaltwerk_running=yes',
      'fixture_repo=/home/schaltwerk/runtime/fixture-project',
      'fixture_head=abc123',
    ].join('\n'))).toEqual({
      schaltwerk_running: 'yes',
      fixture_repo: '/home/schaltwerk/runtime/fixture-project',
      fixture_head: 'abc123',
    })
  })
})

describe('repository integration', () => {
  it('exposes the complete CUA lifecycle through package scripts', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts).toMatchObject({
      'cua:container:prepare': 'node scripts/cua/schaltwerk-cua.js prepare',
      'cua:container:stop': 'node scripts/cua/schaltwerk-cua.js stop-container',
      'cua:container:probe': 'node scripts/cua/schaltwerk-cua.js probe',
      'cua:container:smoke': 'node scripts/cua/schaltwerk-cua.js smoke-test',
      'cua:container:status': 'node scripts/cua/schaltwerk-cua.js status',
      'cua:container:observe': 'node scripts/cua/schaltwerk-cua.js observe',
      'cua:container:test': 'node scripts/cua/schaltwerk-cua.js openai-test',
    })
  })

  it('runs CUA unit tests in the normal frontend suite', () => {
    const vitestConfig = readFileSync(resolve(repoRoot, 'vitest.config.ts'), 'utf8')

    expect(vitestConfig).toContain("'scripts/cua/**/*.test.js'")
  })

  it('launches Schaltwerk against an isolated Git fixture', () => {
    const desktopControl = readFileSync(resolve(repoRoot, 'docker/cua/desktopctl.sh'), 'utf8')

    expect(desktopControl).toContain('FIXTURE_DIR=')
    expect(desktopControl).toContain('prepare_fixture()')
    expect(desktopControl).toContain('git init --initial-branch=main')
    expect(desktopControl).toContain('dbus-run-session -- "$binary" "$FIXTURE_DIR"')
  })
})
