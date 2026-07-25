export const prepareDesktopCommands = Object.freeze([
  'wait-for-computer-server',
  'sync-source',
  'install-deps',
  'build-app',
  'reset-app-state',
  'prepare-fixture',
  'launch-app',
  'wait-for-window',
])

function requiredNumber(options, name, command) {
  const value = Number(options[name])
  if (!Number.isFinite(value)) {
    throw new Error(`${command} requires --${name}`)
  }
  return value
}

function requiredText(options, name, command) {
  const value = options[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${command} requires --${name}`)
  }
  return value
}

export function buildManualAction(command, options) {
  switch (command) {
    case 'click':
    case 'double-click': {
      if (!Number.isFinite(Number(options.x)) || !Number.isFinite(Number(options.y))) {
        throw new Error(`${command} requires --x and --y`)
      }
      return {
        type: command === 'double-click' ? 'double_click' : 'click',
        x: Number(options.x),
        y: Number(options.y),
        button: options.button ?? 'left',
      }
    }
    case 'drag':
      return {
        type: 'drag',
        fromX: requiredNumber(options, 'from-x', command),
        fromY: requiredNumber(options, 'from-y', command),
        toX: requiredNumber(options, 'to-x', command),
        toY: requiredNumber(options, 'to-y', command),
      }
    case 'move':
      return {
        type: 'move',
        x: requiredNumber(options, 'x', command),
        y: requiredNumber(options, 'y', command),
      }
    case 'press':
      return {
        type: 'keypress',
        keys: requiredText(options, 'keys', command).split('+').filter(Boolean),
      }
    case 'scroll':
      return {
        type: 'scroll',
        x: Number.isFinite(Number(options.x)) ? Number(options.x) : 720,
        y: Number.isFinite(Number(options.y)) ? Number(options.y) : 450,
        scrollX: Number(options['delta-x'] ?? 0),
        scrollY: Number(options['delta-y'] ?? 0),
      }
    case 'type':
      return {
        type: 'type',
        text: requiredText(options, 'text', command),
      }
    default:
      throw new Error(`Unsupported manual action: ${command}`)
  }
}

export function parseStatusOutput(output) {
  const status = {}
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }
    status[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return status
}
