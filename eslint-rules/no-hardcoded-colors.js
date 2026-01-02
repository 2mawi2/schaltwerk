/**
 * ESLint rule to enforce theme-aware colors in UI components.
 *
 * Disallows:
 * - theme.colors.* in style props (static values that don't respond to theme changes)
 * - Hardcoded hex colors (#fff, #ffffff) in style props
 * - Hardcoded rgb/rgba colors in style props
 *
 * Allows:
 * - CSS variables: var(--color-*)
 * - Tailwind classes (handled by CSS variable system)
 * - Colors in non-style contexts (e.g., canvas drawing, charts)
 */

const HEX_COLOR_REGEX = /#([0-9a-fA-F]{3}){1,2}\b/
const RGB_RGBA_REGEX = /rgba?\s*\(/i
const THEME_COLORS_REGEX = /theme\.colors\./

const STYLE_PROP_NAMES = new Set([
  'style',
  'sx',
  'css',
])

const COLOR_STYLE_PROPERTIES = new Set([
  'color',
  'backgroundColor',
  'background',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'fill',
  'stroke',
  'caretColor',
  'columnRuleColor',
  'accentColor',
])

function isInsideStyleProp(node) {
  let current = node.parent
  while (current) {
    if (current.type === 'JSXAttribute' && current.name && STYLE_PROP_NAMES.has(current.name.name)) {
      return true
    }
    if (current.type === 'Property' && current.key) {
      const keyName = current.key.name || current.key.value
      if (COLOR_STYLE_PROPERTIES.has(keyName)) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

function isInsideStyleObject(node) {
  let current = node.parent
  while (current) {
    if (current.type === 'ObjectExpression') {
      const parent = current.parent
      if (parent && parent.type === 'JSXExpressionContainer') {
        const grandparent = parent.parent
        if (grandparent && grandparent.type === 'JSXAttribute' && grandparent.name) {
          return STYLE_PROP_NAMES.has(grandparent.name.name)
        }
      }
    }
    current = current.parent
  }
  return false
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded colors in style props to ensure theme compatibility',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      themeColors: 'Avoid theme.colors.* in styles - use CSS variable var(--color-*) instead for theme support',
      hexColor: 'Avoid hardcoded hex color "{{color}}" - use CSS variable var(--color-*) or Tailwind class instead',
      rgbColor: 'Avoid hardcoded rgb/rgba color - use CSS variable var(--color-*) or Tailwind class instead',
    },
  },

  create(context) {
    return {
      MemberExpression(node) {
        const sourceCode = context.getSourceCode()
        const text = sourceCode.getText(node)

        if (THEME_COLORS_REGEX.test(text) && isInsideStyleProp(node)) {
          context.report({
            node,
            messageId: 'themeColors',
          })
        }
      },

      Literal(node) {
        if (typeof node.value !== 'string') return
        if (!isInsideStyleObject(node) && !isInsideStyleProp(node)) return

        const value = node.value

        if (HEX_COLOR_REGEX.test(value)) {
          const match = value.match(HEX_COLOR_REGEX)
          context.report({
            node,
            messageId: 'hexColor',
            data: { color: match ? match[0] : value },
          })
          return
        }

        if (RGB_RGBA_REGEX.test(value)) {
          context.report({
            node,
            messageId: 'rgbColor',
          })
        }
      },

      TemplateLiteral(node) {
        if (!isInsideStyleObject(node) && !isInsideStyleProp(node)) return

        for (const quasi of node.quasis) {
          const value = quasi.value.cooked
          if (typeof value !== 'string') continue

          if (HEX_COLOR_REGEX.test(value)) {
            const match = value.match(HEX_COLOR_REGEX)
            context.report({
              node,
              messageId: 'hexColor',
              data: { color: match ? match[0] : value },
            })
            return
          }

          if (RGB_RGBA_REGEX.test(value)) {
            context.report({
              node,
              messageId: 'rgbColor',
            })
            return
          }
        }
      },
    }
  },
}
