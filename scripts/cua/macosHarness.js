import { delimiter, resolve } from 'node:path'

export function createMacosHarnessPaths(repoRoot) {
  const runtimeDir = resolve(repoRoot, 'logs', 'cua', 'macos-runtime')
  const homeDir = resolve(runtimeDir, 'home')
  const appBundle = resolve(
    repoRoot,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'macos',
    'schaltwerk.app',
  )

  return Object.freeze({
    repoRoot: resolve(repoRoot),
    runtimeDir,
    homeDir,
    xdgConfigDir: resolve(homeDir, '.config'),
    xdgDataDir: resolve(homeDir, '.local', 'share'),
    fixtureDir: resolve(runtimeDir, 'fixture-project'),
    configDatabase: resolve(runtimeDir, 'app-config', 'sessions.db'),
    logFile: resolve(runtimeDir, 'schaltwerk.log'),
    pidFile: resolve(runtimeDir, 'schaltwerk.pid'),
    agentBinDir: resolve(runtimeDir, 'bin'),
    codexHomeDir: resolve(runtimeDir, 'codex-home'),
    codexAuthLink: resolve(runtimeDir, 'codex-home', 'auth.json'),
    codexConfigFile: resolve(runtimeDir, 'codex-home', 'config.toml'),
    appBundle,
    appExecutable: resolve(appBundle, 'Contents', 'MacOS', 'schaltwerk'),
  })
}

export function buildMacosLaunchEnv(paths, baseEnv = process.env) {
  const systemPath = baseEnv.PATH ?? '/usr/bin:/bin'

  return {
    ...baseEnv,
    HOME: paths.homeDir,
    XDG_CONFIG_HOME: paths.xdgConfigDir,
    XDG_DATA_HOME: paths.xdgDataDir,
    SCHALTWERK_APP_CONFIG_DB_PATH: paths.configDatabase,
    SCHALTWERK_CUA_RUNTIME_DIR: paths.runtimeDir,
    SCHALTWERK_CODEX_BINARY_PATH: resolve(paths.agentBinDir, 'codex'),
    CODEX_HOME: paths.codexHomeDir,
    RUST_LOG: baseEnv.RUST_LOG ?? 'schaltwerk=debug',
    PATH: `${paths.agentBinDir}${delimiter}${systemPath}`,
  }
}

export function buildCodexTrustConfig(paths) {
  return `[projects.${JSON.stringify(paths.fixtureDir)}]\ntrust_level = "trusted"\n`
}

export function parseOwnedPid(contents) {
  const value = contents.trim()
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('The CUA pid file does not contain a valid process id')
  }

  const pid = Number(value)
  if (!Number.isSafeInteger(pid)) {
    throw new Error('The CUA pid file does not contain a valid process id')
  }
  return pid
}
