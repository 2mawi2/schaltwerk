export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow empty .catch() handlers and catch blocks without proper error logging',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      emptyCatchHandler: 'Empty .catch() handler detected. Must log or handle the error properly.',
      catchWithOnlyComment: 'Catch block with only comments detected. Must log or handle the error properly.',
      noErrorLogging: '.catch() handler does not log the error. Must include console.error(), console.warn(), or logger call.',
    },
  },
  create(context) {
    // Helper to check if a node contains error logging
    function containsErrorLogging(node) {
      let hasLogging = false;
      const visited = new Set();
      
      function checkNode(n) {
        if (!n || visited.has(n)) return;
        visited.add(n);
        
        // Check for console.error, console.warn, logger calls
        if (n.type === 'CallExpression') {
          if (n.callee && n.callee.type === 'MemberExpression') {
            const obj = n.callee.object;
            const prop = n.callee.property;
            
            // Check for console.error, console.warn
            if (obj && obj.name === 'console' && prop && (prop.name === 'error' || prop.name === 'warn')) {
              hasLogging = true;
              return;
            }
            
            // Check for logger.error, logger.warn, etc.
            if (obj && obj.name === 'logger' && prop && ['error', 'warn', 'info', 'debug'].includes(prop.name)) {
              hasLogging = true;
              return;
            }
          }
        }
        
        // Only check specific properties that contain child nodes
        const propertiesToCheck = ['body', 'expression', 'argument', 'arguments', 'consequent', 'alternate', 'elements', 'properties'];
        
        for (const key of propertiesToCheck) {
          if (n[key]) {
            if (Array.isArray(n[key])) {
              for (const child of n[key]) {
                checkNode(child);
                if (hasLogging) return;
              }
            } else if (typeof n[key] === 'object') {
              checkNode(n[key]);
              if (hasLogging) return;
            }
          }
        }
      }
      
      checkNode(node);
      return hasLogging;
    }
    
    return {
      // Check for .catch(() => {}) patterns
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.name === 'catch' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'ArrowFunctionExpression'
        ) {
          const handler = node.arguments[0];
          const body = handler.body;
          
          // Check if it's an empty function body
          if (body.type === 'BlockStatement' && body.body.length === 0) {
            context.report({
              node: handler,
              messageId: 'emptyCatchHandler',
            });
          } else if (body.type === 'BlockStatement' && !containsErrorLogging(body)) {
            // Check if the body doesn't contain error logging
            context.report({
              node: handler,
              messageId: 'noErrorLogging',
            });
          }
        }
      },
      
      // Check for catch blocks with only comments
      CatchClause(node) {
        const body = node.body;
        
        // Check if catch block is empty or contains only comments
        if (body.type === 'BlockStatement' && body.body.length === 0) {
          // The no-empty rule already handles completely empty blocks
          // This would handle blocks with only comments if needed
          const sourceCode = context.getSourceCode();
          const blockText = sourceCode.getText(body);
          
          // Check if block contains only whitespace and comments
          const strippedText = blockText.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
          if (strippedText === '{}' || strippedText === '{ }') {
            context.report({
              node: body,
              messageId: 'catchWithOnlyComment',
            });
          }
        }
      },
    };
  },
};