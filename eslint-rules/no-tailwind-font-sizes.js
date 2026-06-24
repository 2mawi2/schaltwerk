const ARBITRARY_FONT_SIZE_PATTERN = /text-\[/

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'disallow arbitrary fixed Tailwind font-size values like text-[12px]',
    },
    schema: [],
    messages: {
      unexpected: 'Use Tailwind scale classes (text-sm, text-base, …) instead of arbitrary "{{token}}"',
    },
  },
  create(context) {
    const reportMatch = (value, node) => {
      const match = value.match(ARBITRARY_FONT_SIZE_PATTERN)
      if (match) {
        const startIdx = match.index
        const endIdx = value.indexOf(']', startIdx)
        const token = endIdx !== -1
          ? value.slice(startIdx, endIdx + 1)
          : value.slice(startIdx)
        context.report({
          node,
          messageId: 'unexpected',
          data: { token },
        })
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
