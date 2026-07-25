const supportedBackends = new Set(['cua', 'desktopctl'])

export function resolveBackendName(candidate, fallback = 'cua') {
  const normalizedFallback = `${fallback ?? 'cua'}`.trim().toLowerCase()
  if (!supportedBackends.has(normalizedFallback)) {
    throw new Error(`Unsupported fallback backend: ${fallback}`)
  }

  if (candidate === undefined || candidate === null || `${candidate}`.trim() === '') {
    return normalizedFallback
  }

  const normalized = `${candidate}`.trim().toLowerCase()
  if (!supportedBackends.has(normalized)) {
    throw new Error(`Unsupported desktop backend: ${candidate}`)
  }

  return normalized
}

export function buildCuaClientArgs({ scriptPath, host, port, command, args = [] }) {
  if (!scriptPath) {
    throw new Error('scriptPath is required for the Cua client')
  }

  if (!command) {
    throw new Error('command is required for the Cua client')
  }

  return [
    'run',
    '--quiet',
    '--with',
    'cua-computer',
    'python',
    scriptPath,
    '--host',
    `${host}`,
    '--port',
    `${port}`,
    command,
    ...args,
  ]
}
