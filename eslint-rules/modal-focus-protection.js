/**
 * ESLint rule to enforce proper focus protection in modal components.
 *
 * Problem: When a modal has a backdrop with onClick for closing, clicking on inputs
 * inside the modal can trigger focus loss because pointerdown events bubble up to
 * the backdrop before the click handler runs.
 *
 * Solution: Modal content containers must stop pointerdown propagation to protect
 * input focus. This rule detects modal patterns and ensures proper event handling.
 *
 * Patterns detected:
 * 1. Backdrop divs with onClick handlers (typically for closing modals)
 * 2. Dialog role elements that need content protection
 * 3. Modal content containers that need onPointerDown stopPropagation
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'enforce onPointerDown stopPropagation on modal content to protect input focus',
    },
    schema: [],
    messages: {
      missingPointerDownOnContent:
        'Modal content container should have onPointerDown={(e) => e.stopPropagation()} to protect input focus. ' +
        'Without this, inputs inside the modal may lose focus when clicked.',
      dialogNeedsContentProtection:
        'Dialog modal should have onPointerDown={(e) => e.stopPropagation()} on its content container. ' +
        'Add onPointerDown={(e) => e.stopPropagation()} to the first child div inside the dialog.',
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        if (node.openingElement.name.type !== 'JSXIdentifier' || node.openingElement.name.name !== 'div') {
          return
        }

        const attributes = node.openingElement.attributes
        const backdropInfo = getBackdropInfo(attributes)

        if (!backdropInfo.isBackdrop) {
          return
        }

        const children = node.children.filter(
          child => child.type === 'JSXElement'
        )

        if (children.length === 0) {
          return
        }

        if (backdropInfo.hasOnClick) {
          for (const child of children) {
            if (child.openingElement.name.type !== 'JSXIdentifier') {
              continue
            }

            const childAttrs = child.openingElement.attributes

            const hasStopPropagationOnClick = childAttrs.some(attr =>
              attr.type === 'JSXAttribute' &&
              attr.name.type === 'JSXIdentifier' &&
              attr.name.name === 'onClick' &&
              isStopPropagationHandler(attr.value)
            )

            if (!hasStopPropagationOnClick) {
              continue
            }

            const hasPointerDownHandler = childAttrs.some(attr =>
              attr.type === 'JSXAttribute' &&
              attr.name.type === 'JSXIdentifier' &&
              attr.name.name === 'onPointerDown'
            )

            if (!hasPointerDownHandler) {
              context.report({
                node: child.openingElement,
                messageId: 'missingPointerDownOnContent',
              })
            }
          }
        }

        if (backdropInfo.isDialog) {
          const hasPointerDownOnDialog = attributes.some(attr =>
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === 'onPointerDown'
          )

          if (hasPointerDownOnDialog) {
            return
          }

          if (!backdropInfo.hasOnClick) {
            const firstChild = children[0]
            if (firstChild && firstChild.openingElement.name.type === 'JSXIdentifier') {
              const childAttrs = firstChild.openingElement.attributes

              const hasPointerDownHandler = childAttrs.some(attr =>
                attr.type === 'JSXAttribute' &&
                attr.name.type === 'JSXIdentifier' &&
                attr.name.name === 'onPointerDown'
              )

              if (!hasPointerDownHandler) {
                context.report({
                  node: firstChild.openingElement,
                  messageId: 'dialogNeedsContentProtection',
                })
              }
            }
          }
        }
      },
    }
  },
}

function getBackdropInfo(attributes) {
  const result = {
    isBackdrop: false,
    isDialog: false,
    hasOnClick: false,
  }

  for (const attr of attributes) {
    if (attr.type !== 'JSXAttribute') continue
    if (attr.name.type !== 'JSXIdentifier') continue

    if (attr.name.name === 'onClick') {
      result.hasOnClick = true
    }

    if (attr.name.name === 'className' && attr.value) {
      const classValue = getStringValue(attr.value)
      if (classValue && (
        classValue.includes('fixed inset-0') ||
        classValue.includes('modal-backdrop') ||
        (classValue.includes('z-50') && classValue.includes('fixed'))
      )) {
        result.isBackdrop = true
      }
    }

    if (attr.name.name === 'role' && attr.value) {
      const roleValue = getStringValue(attr.value)
      if (roleValue === 'dialog' || roleValue === 'alertdialog') {
        result.isBackdrop = true
        result.isDialog = true
      }
    }
  }
  return result
}

function isStopPropagationHandler(value) {
  if (!value) return false

  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression

    if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
      const body = expr.body
      if (body.type === 'CallExpression') {
        return isStopPropagationCall(body)
      }
      if (body.type === 'BlockStatement') {
        for (const stmt of body.body) {
          if (stmt.type === 'ExpressionStatement' &&
              stmt.expression.type === 'CallExpression' &&
              isStopPropagationCall(stmt.expression)) {
            return true
          }
        }
      }
    }
  }
  return false
}

function isStopPropagationCall(callExpr) {
  if (callExpr.callee.type === 'MemberExpression' &&
      callExpr.callee.property.type === 'Identifier' &&
      callExpr.callee.property.name === 'stopPropagation') {
    return true
  }
  return false
}

function getStringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node.type === 'JSXExpressionContainer' &&
      node.expression.type === 'Literal' &&
      typeof node.expression.value === 'string') {
    return node.expression.value
  }
  if (node.type === 'JSXExpressionContainer' &&
      node.expression.type === 'TemplateLiteral') {
    return node.expression.quasis.map(q => q.value.cooked).join('')
  }
  return null
}
