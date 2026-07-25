import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

import {
  buildCodexTrustConfig,
  buildMacosLaunchEnv,
  createMacosHarnessPaths,
  parseOwnedPid,
} from './macosHarness.js'

const repoRoot = process.cwd()
const paths = createMacosHarnessPaths(repoRoot)
const command = process.argv[2] ?? 'help'
const flags = new Set(process.argv.slice(3))
const bundledCodexBinary = '/Applications/ChatGPT.app/Contents/Resources/codex'

function fail(message) {
  throw new Error(message)
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : ''
    fail(detail || `${program} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

function assertMacos() {
  if (process.platform !== 'darwin') {
    fail('The native Schaltwerk CUA harness requires macOS')
  }
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      return false
    }
    throw error
  }
}

function readOwnedPid() {
  if (!existsSync(paths.pidFile)) {
    return null
  }
  return parseOwnedPid(readFileSync(paths.pidFile, 'utf8'))
}

function readOwnedProcessCommand(pid) {
  return run('ps', ['-p', `${pid}`, '-o', 'command='], { capture: true })
}

function assertOwnedProcess(pid) {
  const processCommand = readOwnedProcessCommand(pid)
  if (!processCommand.startsWith(paths.appExecutable)) {
    fail(`Refusing to signal process ${pid}; it is not the Schaltwerk CUA executable`)
  }
}

function assertNoRunningHarness() {
  const pid = readOwnedPid()
  if (pid === null) {
    return
  }
  if (processIsRunning(pid)) {
    assertOwnedProcess(pid)
    fail(`Schaltwerk CUA is already running as process ${pid}; run bun run cua:stop first`)
  }
  rmSync(paths.pidFile)
}

function resetRuntime() {
  const expected = resolve(repoRoot, 'logs', 'cua', 'macos-runtime')
  if (paths.runtimeDir !== expected || !relative(repoRoot, paths.runtimeDir).startsWith('logs/cua/')) {
    fail(`Refusing to reset unexpected runtime path: ${paths.runtimeDir}`)
  }
  rmSync(paths.runtimeDir, { recursive: true, force: true })
  mkdirSync(paths.homeDir, { recursive: true })
  mkdirSync(paths.xdgConfigDir, { recursive: true })
  mkdirSync(paths.xdgDataDir, { recursive: true })
  mkdirSync(resolve(paths.configDatabase, '..'), { recursive: true })
  mkdirSync(paths.agentBinDir, { recursive: true })
  mkdirSync(paths.codexHomeDir, { recursive: true, mode: 0o700 })
  mkdirSync(paths.piAgentDir, { recursive: true, mode: 0o700 })
}

function prepareFixture() {
  mkdirSync(paths.fixtureDir, { recursive: true })
  run('git', ['init', '--initial-branch=main'], { cwd: paths.fixtureDir })
  run('git', ['config', 'user.name', 'Schaltwerk CUA'], { cwd: paths.fixtureDir })
  run('git', ['config', 'user.email', 'cua@schaltwerk.test'], { cwd: paths.fixtureDir })
  writeFileSync(
    resolve(paths.fixtureDir, 'README.md'),
    '# Schaltwerk macOS CUA fixture\n\nThis disposable repository is used for native UI tests.\n',
  )
  writeFileSync(
    resolve(paths.fixtureDir, 'fixture.txt'),
    'The native Schaltwerk computer-use harness created this repository.\n',
  )
  run('git', ['add', 'README.md', 'fixture.txt'], { cwd: paths.fixtureDir })
  run('git', ['commit', '-m', 'Initial CUA fixture'], { cwd: paths.fixtureDir })
}

function resolveRealCodexBinary() {
  let pathCodex
  try {
    pathCodex = run('/usr/bin/which', ['codex'], { capture: true })
  } catch {
    pathCodex = null
  }
  const candidates = [
    process.env.SCHALTWERK_CUA_CODEX_BIN,
    pathCodex,
    bundledCodexBinary,
    '/Applications/Codex.app/Contents/Resources/codex',
  ].filter(Boolean)

  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) {
      continue
    }
    try {
      const version = run(candidate, ['--version'], { capture: true })
      if (version.startsWith('codex-cli ')) {
        return { binary: candidate, version }
      }
    } catch {
      continue
    }
  }
  fail('No working real Codex CLI was found; reinstall @openai/codex or set SCHALTWERK_CUA_CODEX_BIN')
}

function prepareRealCodex() {
  const { binary, version } = resolveRealCodexBinary()
  const codexLink = resolve(paths.agentBinDir, 'codex')
  mkdirSync(paths.agentBinDir, { recursive: true })
  mkdirSync(paths.codexHomeDir, { recursive: true, mode: 0o700 })
  rmSync(codexLink, { force: true })
  rmSync(paths.codexAuthLink, { force: true })
  symlinkSync(binary, codexLink)
  writeFileSync(paths.codexConfigFile, buildCodexTrustConfig(paths), { mode: 0o600 })

  const sourceCodexHome = process.env.CODEX_HOME ?? resolve(process.env.HOME, '.codex')
  const sourceAuth = resolve(sourceCodexHome, 'auth.json')
  if (!existsSync(sourceAuth)) {
    fail(`Real Codex is not logged in; expected authentication at ${sourceAuth}`)
  }
  symlinkSync(sourceAuth, paths.codexAuthLink)
  run(codexLink, ['login', 'status'], {
    capture: true,
    env: buildMacosLaunchEnv(paths),
  })

  writeFileSync(
    resolve(paths.runtimeDir, 'codex.json'),
    `${JSON.stringify({ binary, version }, null, 2)}\n`,
  )
  process.stdout.write(`Using real ${version} from ${binary}\n`)
}

function resolveRealPiBinary() {
  let pathPi
  try {
    pathPi = run('/usr/bin/which', ['pi'], { capture: true })
  } catch {
    pathPi = null
  }
  const candidates = [
    process.env.SCHALTWERK_CUA_PI_BIN,
    pathPi,
  ].filter(Boolean)

  for (const candidate of [...new Set(candidates)]) {
    if (!existsSync(candidate)) {
      continue
    }
    try {
      const version = run(candidate, ['--version'], { capture: true })
      if (/^\d+\.\d+\.\d+/.test(version)) {
        return { binary: candidate, version }
      }
    } catch {
      continue
    }
  }
  fail('No working real Pi CLI was found; install Pi or set SCHALTWERK_CUA_PI_BIN')
}

function copyPrivateFile(source, destination) {
  copyFileSync(source, destination)
  chmodSync(destination, 0o600)
}

function prepareRealPi() {
  const { binary, version } = resolveRealPiBinary()
  const piLink = resolve(paths.agentBinDir, 'pi')
  const sourceAgentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(process.env.HOME, '.pi', 'agent')
  const sourceAuth = resolve(sourceAgentDir, 'auth.json')
  const sourceSettings = resolve(sourceAgentDir, 'settings.json')
  const sourceModels = resolve(sourceAgentDir, 'models.json')

  if (!existsSync(sourceAuth)) {
    fail(`Real Pi is not logged in; expected authentication at ${sourceAuth}`)
  }

  mkdirSync(paths.agentBinDir, { recursive: true })
  mkdirSync(paths.piAgentDir, { recursive: true, mode: 0o700 })
  rmSync(piLink, { force: true })
  rmSync(paths.piAuthFile, { force: true })
  rmSync(paths.piSettingsFile, { force: true })
  rmSync(paths.piModelsFile, { force: true })
  symlinkSync(binary, piLink)
  copyPrivateFile(sourceAuth, paths.piAuthFile)

  if (existsSync(sourceSettings)) {
    const settings = JSON.parse(readFileSync(sourceSettings, 'utf8'))
    delete settings.packages
    writeFileSync(paths.piSettingsFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  }
  if (existsSync(sourceModels)) {
    copyPrivateFile(sourceModels, paths.piModelsFile)
  }

  run(piLink, ['--list-models'], {
    capture: true,
    env: buildMacosLaunchEnv(paths),
  })

  writeFileSync(
    resolve(paths.runtimeDir, 'pi.json'),
    `${JSON.stringify({ binary, version }, null, 2)}\n`,
  )
  process.stdout.write(`Using real Pi ${version} from ${binary}\n`)
}

function removePiPrivateFiles() {
  rmSync(paths.piAuthFile, { force: true })
  rmSync(paths.piSettingsFile, { force: true })
  rmSync(paths.piModelsFile, { force: true })
}

function buildApp() {
  run('bun', ['run', 'tauri', 'build', '--bundles', 'app'])
  if (!existsSync(paths.appExecutable)) {
    fail(`Tauri build completed without creating ${paths.appExecutable}`)
  }
}

function startApp() {
  assertMacos()
  assertNoRunningHarness()
  if (!existsSync(paths.fixtureDir)) {
    fail('The disposable fixture is missing; run bun run cua:prepare')
  }
  if (!existsSync(paths.appExecutable)) {
    fail('The Schaltwerk app bundle is missing; run bun run cua:prepare')
  }

  try {
    prepareRealCodex()
    prepareRealPi()
    mkdirSync(paths.runtimeDir, { recursive: true })
    const logFd = openSync(paths.logFile, 'a')
    const child = spawn(paths.appExecutable, [paths.fixtureDir], {
      detached: true,
      cwd: paths.fixtureDir,
      env: buildMacosLaunchEnv(paths),
      stdio: ['ignore', logFd, logFd],
    })
    child.unref()
    closeSync(logFd)
    writeFileSync(paths.pidFile, `${child.pid}\n`)

    process.stdout.write(`Started isolated Schaltwerk CUA process ${child.pid}\n`)
    printStatus()
  } catch (error) {
    rmSync(paths.codexAuthLink, { force: true })
    removePiPrivateFiles()
    throw error
  }
}

function stopApp() {
  const pid = readOwnedPid()
  if (pid === null) {
    rmSync(paths.codexAuthLink, { force: true })
    removePiPrivateFiles()
    process.stdout.write('Schaltwerk CUA is not running\n')
    return
  }
  if (!processIsRunning(pid)) {
    rmSync(paths.pidFile)
    rmSync(paths.codexAuthLink, { force: true })
    removePiPrivateFiles()
    process.stdout.write(`Removed stale CUA pid file for process ${pid}\n`)
    return
  }

  assertOwnedProcess(pid)
  process.kill(pid, 'SIGTERM')
  rmSync(paths.pidFile)
  rmSync(paths.codexAuthLink, { force: true })
  removePiPrivateFiles()
  process.stdout.write(`Stopped Schaltwerk CUA process ${pid}\n`)
}

function gitOutput(args) {
  if (!existsSync(resolve(paths.fixtureDir, '.git'))) {
    return 'fixture_missing=yes'
  }
  return run('git', args, { cwd: paths.fixtureDir, capture: true })
}

function printStatus() {
  const pid = readOwnedPid()
  const running = pid !== null && processIsRunning(pid)
  const head = existsSync(resolve(paths.fixtureDir, '.git'))
    ? gitOutput(['rev-parse', '--short', 'HEAD'])
    : ''
  const status = {
    running,
    pid: running ? pid : null,
    appBundle: paths.appBundle,
    fixture: paths.fixtureDir,
    fixtureHead: head,
    isolatedHome: paths.homeDir,
    configDatabase: paths.configDatabase,
    piAgentDir: paths.piAgentDir,
    log: paths.logFile,
  }
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
}

function printFixtureStatus() {
  process.stdout.write(`${gitOutput(['status', '--short', '--branch'])}\n`)
  if (existsSync(resolve(paths.fixtureDir, '.git'))) {
    process.stdout.write(`${gitOutput(['worktree', 'list', '--porcelain'])}\n`)
  }
}

function printLogs() {
  if (!existsSync(paths.logFile)) {
    fail(`No CUA log exists at ${paths.logFile}`)
  }
  const lines = readFileSync(paths.logFile, 'utf8').split('\n')
  process.stdout.write(`${lines.slice(-200).join('\n')}\n`)
}

function verifyIsolation() {
  const pid = readOwnedPid()
  if (pid === null || !processIsRunning(pid)) {
    fail('Schaltwerk CUA is not running')
  }
  assertOwnedProcess(pid)

  const lsof = run('lsof', ['-a', '-p', `${pid}`, '-Fn'], { capture: true })
  const openPaths = lsof
    .split('\n')
    .filter(line => line.startsWith('n/'))
    .map(line => line.slice(1))
  const normalHome = process.env.HOME
  const forbiddenRoots = [
    resolve(normalHome, 'Library', 'Application Support', 'schaltwerk'),
    resolve(normalHome, 'Library', 'Application Support', 'com.mariuswichtner.schaltwerk'),
    resolve(normalHome, 'Library', 'Preferences', 'schaltwerk'),
    resolve(normalHome, 'Library', 'Preferences', 'com.mariuswichtner.schaltwerk'),
  ]
  const leaks = openPaths.filter(path => forbiddenRoots.some(root => path === root || path.startsWith(`${root}/`)))

  if (leaks.length > 0) {
    fail(`Isolation verification failed; the CUA process opened normal app state:\n${leaks.join('\n')}`)
  }

  const isolatedPaths = openPaths.filter(path => path.startsWith(`${paths.runtimeDir}/`))
  process.stdout.write(`${JSON.stringify({
    isolated: true,
    pid,
    runtime: paths.runtimeDir,
    isolatedOpenFiles: isolatedPaths,
  }, null, 2)}\n`)
}

function prepare() {
  assertMacos()
  assertNoRunningHarness()
  resetRuntime()
  prepareFixture()
  if (!flags.has('--no-build')) {
    buildApp()
  }
  startApp()
}

function printHelp() {
  process.stdout.write(`Native macOS Schaltwerk Computer Use harness

Commands:
  prepare [--no-build]  Reset isolated state, build the app, and launch it
  start                 Launch the existing isolated fixture and app build
  stop                  Stop only the app process launched by this harness
  status                Show process and artifact paths
  logs                  Print the last 200 app log lines
  fixture-status        Show fixture branch, changes, and worktrees
  verify-isolation      Fail if the app has opened normal Schaltwerk state
`)
}

try {
  switch (command) {
    case 'prepare':
      prepare()
      break
    case 'start':
      startApp()
      break
    case 'stop':
      stopApp()
      break
    case 'status':
      printStatus()
      break
    case 'logs':
      printLogs()
      break
    case 'fixture-status':
      printFixtureStatus()
      break
    case 'verify-isolation':
      verifyIsolation()
      break
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      break
    default:
      fail(`Unknown command: ${command}`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : `${error}`}\n`)
  process.exitCode = 1
}
