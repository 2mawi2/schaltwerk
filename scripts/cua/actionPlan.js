const BUTTONS = new Set(['left', 'middle', 'right'])
const MODIFIER_KEYS = new Set(['ctrl', 'alt', 'shift', 'super'])
const KEY_ALIASES = new Map([
  ['ALT', 'alt'],
  ['ARROWDOWN', 'Down'],
  ['ARROWLEFT', 'Left'],
  ['ARROWRIGHT', 'Right'],
  ['ARROWUP', 'Up'],
  ['BACKSPACE', 'BackSpace'],
  ['CMD', 'ctrl'],
  ['CMDORCTRL', 'ctrl'],
  ['CONTROL', 'ctrl'],
  ['CTRL', 'ctrl'],
  ['DELETE', 'Delete'],
  ['DOWN', 'Down'],
  ['END', 'End'],
  ['ENTER', 'Return'],
  ['ESC', 'Escape'],
  ['ESCAPE', 'Escape'],
  ['HOME', 'Home'],
  ['LEFT', 'Left'],
  ['META', 'super'],
  ['OPTION', 'alt'],
  ['PAGEDOWN', 'Page_Down'],
  ['PAGEUP', 'Page_Up'],
  ['RETURN', 'Return'],
  ['RIGHT', 'Right'],
  ['SHIFT', 'shift'],
  ['SPACE', 'space'],
  ['SUPER', 'super'],
  ['TAB', 'Tab'],
  ['UP', 'Up'],
])

function roundCoordinate(value) {
  return `${Math.round(Number(value ?? 0))}`
}

function normalizeButton(button) {
  if (typeof button !== 'string') {
    return 'left'
  }

  const candidate = button.toLowerCase()
  return BUTTONS.has(candidate) ? candidate : 'left'
}

function normalizeKey(key) {
  const trimmed = `${key ?? ''}`.trim()
  if (!trimmed) {
    throw new Error('Missing keypress key')
  }

  const upper = trimmed.toUpperCase()
  return KEY_ALIASES.get(upper) ?? (trimmed.length === 1 ? trimmed.toLowerCase() : trimmed)
}

export function encodeTextArgument(text) {
  return Buffer.from(`${text ?? ''}`, 'utf8').toString('base64')
}

export function normalizeShortcut(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('Missing keypress keys')
  }

  const normalized = keys.map(normalizeKey)
  const hasModifier = normalized.some((key) => MODIFIER_KEYS.has(key))
  const hasDuplicates = new Set(normalized).size !== normalized.length

  if (normalized.length > 1 && hasModifier && !hasDuplicates) {
    return normalized.join('+')
  }

  return normalized
}

export function resolveDragPoints(action) {
  if (Array.isArray(action.path) && action.path.length >= 2) {
    const [start, ...rest] = action.path
    const end = rest.at(-1)
    return {
      startX: Math.round(Number(start.x)),
      startY: Math.round(Number(start.y)),
      endX: Math.round(Number(end.x)),
      endY: Math.round(Number(end.y)),
    }
  }

  if (
    Number.isFinite(action.fromX) &&
    Number.isFinite(action.fromY) &&
    Number.isFinite(action.toX) &&
    Number.isFinite(action.toY)
  ) {
    return {
      startX: Math.round(Number(action.fromX)),
      startY: Math.round(Number(action.fromY)),
      endX: Math.round(Number(action.toX)),
      endY: Math.round(Number(action.toY)),
    }
  }

  if (
    Number.isFinite(action.x) &&
    Number.isFinite(action.y) &&
    Number.isFinite(action.endX) &&
    Number.isFinite(action.endY)
  ) {
    return {
      startX: Math.round(Number(action.x)),
      startY: Math.round(Number(action.y)),
      endX: Math.round(Number(action.endX)),
      endY: Math.round(Number(action.endY)),
    }
  }

  throw new Error(`Unsupported drag action payload: ${JSON.stringify(action)}`)
}

export function buildDesktopOperations(actions) {
  const operations = []

  for (const action of actions ?? []) {
    switch (action?.type) {
      case 'click':
        operations.push({
          command: 'click',
          args: [roundCoordinate(action.x), roundCoordinate(action.y), normalizeButton(action.button)],
        })
        break
      case 'double_click':
        operations.push({
          command: 'double-click',
          args: [roundCoordinate(action.x), roundCoordinate(action.y), normalizeButton(action.button)],
        })
        break
      case 'drag': {
        const points = resolveDragPoints(action)
        operations.push({
          command: 'drag',
          args: [
            `${points.startX}`,
            `${points.startY}`,
            `${points.endX}`,
            `${points.endY}`,
          ],
        })
        break
      }
      case 'keypress': {
        const shortcut = normalizeShortcut(action.keys ?? [])
        if (Array.isArray(shortcut)) {
          for (const key of shortcut) {
            operations.push({ command: 'keypress', args: [key] })
          }
        } else {
          operations.push({ command: 'keypress', args: [shortcut] })
        }
        break
      }
      case 'move':
        operations.push({
          command: 'move',
          args: [roundCoordinate(action.x), roundCoordinate(action.y)],
        })
        break
      case 'scroll':
        operations.push({
          command: 'scroll',
          args: [
            roundCoordinate(action.x),
            roundCoordinate(action.y),
            `${Math.round(Number(action.scrollX ?? 0))}`,
            `${Math.round(Number(action.scrollY ?? 0))}`,
          ],
        })
        break
      case 'screenshot':
        break
      case 'type':
        operations.push({
          command: 'type',
          args: [encodeTextArgument(action.text ?? '')],
        })
        break
      case 'wait':
        operations.push({
          command: 'wait',
          args: [`${Math.max(250, Math.round(Number(action.ms ?? action.duration ?? 1000)))}`],
        })
        break
      default:
        throw new Error(`Unsupported computer action: ${JSON.stringify(action)}`)
    }
  }

  return operations
}
