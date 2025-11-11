const DISALLOWED = [
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
  'text-[',
]

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow legacy Tailwind font-size utilities in favor of theme.fontSize tokens',
    },
    schema: [],
    messages: {
      unexpected: 'Use theme.fontSize / typography tokens instead of "{{token}}"',
    },
  },
  create(context) {
    const reportMatch = (value, node) => {
      for (const token of DISALLOWED) {
        if (value.includes(token)) {
          context.report({
            node,
            messageId: 'unexpected',
            data: { token },
          })
          return
        }
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          reportMatch(node.value, node)
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (typeof quasi.value.cooked === 'string') {
            reportMatch(quasi.value.cooked, node)
          }
        }
      },
    }
  },
}
