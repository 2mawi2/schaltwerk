import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildCodexTrustConfig,
  buildMacosLaunchEnv,
  createMacosHarnessPaths,
  parseOwnedPid,
} from './macosHarness.js'

const repoRoot = resolve(import.meta.dirname, '..', '..')

function expectDescendant(parent, child) {
  const pathFromParent = relative(parent, child)
  expect(isAbsolute(pathFromParent)).toBe(false)
  expect(pathFromParent).not.toBe('..')
  expect(pathFromParent.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)).toBe(false)
}

describe('createMacosHarnessPaths', () => {
  it('keeps all mutable app state inside the disposable runtime directory', () => {
    const paths = createMacosHarnessPaths(repoRoot)

    expect(paths.runtimeDir).toBe(resolve(repoRoot, 'logs', 'cua', 'macos-runtime'))
    expectDescendant(paths.runtimeDir, paths.homeDir)
    expectDescendant(paths.runtimeDir, paths.fixtureDir)
    expectDescendant(paths.runtimeDir, paths.configDatabase)
    expectDescendant(paths.runtimeDir, paths.logFile)
    expectDescendant(paths.runtimeDir, paths.pidFile)
    expectDescendant(paths.runtimeDir, paths.agentBinDir)
    expectDescendant(paths.runtimeDir, paths.codexHomeDir)
    expectDescendant(paths.runtimeDir, paths.codexAuthLink)
    expectDescendant(paths.runtimeDir, paths.codexConfigFile)
    expectDescendant(paths.runtimeDir, paths.piAgentDir)
    expectDescendant(paths.runtimeDir, paths.piAuthFile)
    expectDescendant(paths.runtimeDir, paths.piSettingsFile)
    expectDescendant(paths.runtimeDir, paths.piModelsFile)
  })

  it('targets the executable in the release macOS app bundle', () => {
    const paths = createMacosHarnessPaths(repoRoot)

    expect(paths.appBundle).toBe(resolve(
      repoRoot,
      'src-tauri',
      'target',
      'release',
      'bundle',
      'macos',
      'schaltwerk.app',
    ))
    expect(paths.appExecutable).toBe(resolve(paths.appBundle, 'Contents', 'MacOS', 'schaltwerk'))
  })
})

describe('buildMacosLaunchEnv', () => {
  it('isolates home, XDG, database, logs, and agent discovery', () => {
    const paths = createMacosHarnessPaths(repoRoot)
    const env = buildMacosLaunchEnv(paths, {
      HOME: '/Users/tester',
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
    })

    expect(env).toMatchObject({
      HOME: paths.homeDir,
      XDG_CONFIG_HOME: paths.xdgConfigDir,
      XDG_DATA_HOME: paths.xdgDataDir,
      SCHALTWERK_APP_CONFIG_DB_PATH: paths.configDatabase,
      SCHALTWERK_CUA_RUNTIME_DIR: paths.runtimeDir,
      SCHALTWERK_CODEX_BINARY_PATH: resolve(paths.agentBinDir, 'codex'),
      SCHALTWERK_PI_BINARY_PATH: resolve(paths.agentBinDir, 'pi'),
      CODEX_HOME: paths.codexHomeDir,
      PI_CODING_AGENT_DIR: paths.piAgentDir,
      RUST_LOG: 'schaltwerk=debug',
      LANG: 'en_US.UTF-8',
    })
    expect(env.PATH).toBe(`${paths.agentBinDir}:/usr/bin:/bin`)
  })
})

describe('buildCodexTrustConfig', () => {
  it('pre-trusts only the disposable fixture root for unattended first-run testing', () => {
    const paths = createMacosHarnessPaths('/tmp/schaltwerk "self-test"')

    expect(buildCodexTrustConfig(paths)).toBe(
      `[projects."/tmp/schaltwerk \\"self-test\\"/logs/cua/macos-runtime/fixture-project"]\n`
      + 'trust_level = "trusted"\n',
    )
  })
})

describe('parseOwnedPid', () => {
  it('accepts only a positive integer process id', () => {
    expect(parseOwnedPid('12345\n')).toBe(12345)
    expect(() => parseOwnedPid('')).toThrow('does not contain a valid process id')
    expect(() => parseOwnedPid('-1')).toThrow('does not contain a valid process id')
    expect(() => parseOwnedPid('12 other')).toThrow('does not contain a valid process id')
  })
})

describe('native macOS repository integration', () => {
  it('makes native macOS the default CUA lifecycle', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts).toMatchObject({
      'cua:prepare': 'node scripts/cua/schaltwerk-macos.js prepare',
      'cua:start': 'node scripts/cua/schaltwerk-macos.js start',
      'cua:stop': 'node scripts/cua/schaltwerk-macos.js stop',
      'cua:status': 'node scripts/cua/schaltwerk-macos.js status',
      'cua:logs': 'node scripts/cua/schaltwerk-macos.js logs',
      'cua:fixture-status': 'node scripts/cua/schaltwerk-macos.js fixture-status',
      'cua:verify-isolation': 'node scripts/cua/schaltwerk-macos.js verify-isolation',
    })
  })

  it('documents Computer Use as the native UI driver', () => {
    const skill = readFileSync(
      resolve(repoRoot, 'codex-skills', 'schaltwerk-macos-cua', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('computer-use')
    expect(skill).toContain('bun run cua:prepare')
    expect(skill).toContain('bun run cua:verify-isolation')
    expect(skill).toContain('No Codex project-trust prompt should appear')
    expect(skill).toContain('SCHALTWERK_CUA_CODEX_BIN')
    expect(skill).toContain('SCHALTWERK_CUA_PI_BIN')
  })

  it('launches the signed Codex app CLI instead of generated agent stubs', () => {
    const harness = readFileSync(
      resolve(repoRoot, 'scripts', 'cua', 'schaltwerk-macos.js'),
      'utf8',
    )

    expect(harness).toContain('/Applications/ChatGPT.app/Contents/Resources/codex')
    expect(harness).toContain('symlinkSync')
    expect(harness).toContain("run(candidate, ['--version']")
    expect(harness).not.toContain('prepareAgentStubs')
    expect(harness).not.toContain('Schaltwerk CUA agent stub')
  })

  it('launches the authenticated host Pi CLI with isolated mutable state', () => {
    const harness = readFileSync(
      resolve(repoRoot, 'scripts', 'cua', 'schaltwerk-macos.js'),
      'utf8',
    )

    expect(harness).toContain('SCHALTWERK_CUA_PI_BIN')
    expect(harness).toContain('prepareRealPi')
    expect(harness).toContain("run(candidate, ['--version']")
    expect(harness).toContain("run(piLink, ['--list-models']")
  })

  it('provides a Pi stub in the isolated Linux harness', () => {
    const dockerfile = readFileSync(resolve(repoRoot, 'docker', 'cua', 'Dockerfile'), 'utf8')
    expect(dockerfile).toMatch(/for agent in [^\n]*\bpi\b/)
  })
})
