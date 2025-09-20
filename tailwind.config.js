/** @type {import('tailwindcss').Config} */
const withOpacityValue = (variable) => ({ opacityValue }) => {
  if (opacityValue === undefined || opacityValue === null) {
    return `rgb(var(${variable}) / 1)`
  }
  return `rgb(var(${variable}) / ${opacityValue})`
}

const createScale = (prefix, shades) =>
  shades.reduce((scale, shade) => {
    scale[shade] = withOpacityValue(`--color-${prefix}-${shade}-rgb`)
    return scale
  }, {})

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        panel: withOpacityValue('--color-panel-rgb'),
        panelAlt: withOpacityValue('--color-panel-alt-rgb'),
        'bg-primary': withOpacityValue('--color-bg-primary-rgb'),
        'bg-secondary': withOpacityValue('--color-bg-secondary-rgb'),
        'bg-tertiary': withOpacityValue('--color-bg-tertiary-rgb'),
        'bg-elevated': withOpacityValue('--color-bg-elevated-rgb'),
        'bg-hover': withOpacityValue('--color-bg-hover-rgb'),
        'bg-active': withOpacityValue('--color-bg-active-rgb'),

        'text-primary': withOpacityValue('--color-text-primary-rgb'),
        'text-secondary': withOpacityValue('--color-text-secondary-rgb'),
        'text-tertiary': withOpacityValue('--color-text-tertiary-rgb'),
        'text-muted': withOpacityValue('--color-text-muted-rgb'),
        'text-inverse': withOpacityValue('--color-text-inverse-rgb'),

        'border-default': withOpacityValue('--color-border-default-rgb'),
        'border-subtle': withOpacityValue('--color-border-subtle-rgb'),
        'border-strong': withOpacityValue('--color-border-strong-rgb'),
        'border-focus': withOpacityValue('--color-border-focus-rgb'),

        'accent-blue': withOpacityValue('--color-accent-blue-rgb'),
        'accent-green': withOpacityValue('--color-accent-green-rgb'),
        'accent-amber': withOpacityValue('--color-accent-amber-rgb'),
        'accent-red': withOpacityValue('--color-accent-red-rgb'),
        'accent-violet': withOpacityValue('--color-accent-violet-rgb'),
        'accent-purple': withOpacityValue('--color-accent-purple-rgb'),
        'accent-yellow': withOpacityValue('--color-accent-yellow-rgb'),
        'accent-cyan': withOpacityValue('--color-accent-cyan-rgb'),

        'status-info': withOpacityValue('--color-status-info-rgb'),
        'status-success': withOpacityValue('--color-status-success-rgb'),
        'status-warning': withOpacityValue('--color-status-warning-rgb'),
        'status-error': withOpacityValue('--color-status-error-rgb'),

        slate: createScale('gray', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        gray: createScale('gray', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        blue: createScale('blue', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        green: createScale('green', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        amber: createScale('amber', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        red: createScale('red', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        yellow: createScale('yellow', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        cyan: createScale('cyan', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        purple: createScale('purple', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        violet: createScale('violet', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),

        white: withOpacityValue('--color-white-rgb'),
        black: withOpacityValue('--color-bg-primary-rgb'),
        transparent: 'transparent',
      },
      fontSize: {
        // Semantic font sizes that replace legacy sizes
        'caption': '0.6875rem',     // 11px - Small labels, metadata (replaces text-xs use cases for metadata)
        'body': '0.875rem',         // 14px - Primary body text (replaces text-sm use cases)
        'body-large': '1rem',       // 16px - Larger body text (replaces text-base use cases)
        'heading': '1.125rem',      // 18px - Section headings (replaces text-lg use cases)
        'heading-large': '1.25rem', // 20px - Main headings (replaces text-xl use cases)
        'heading-xlarge': '1.5rem', // 24px - Page titles (replaces text-2xl use cases)
        'display': '2rem',          // 32px - Hero text, important notices
        // UI-specific sizes
        'button': '0.875rem',       // 14px - Button text
        'input': '0.875rem',        // 14px - Input field text  
        'label': '0.8125rem',       // 13px - Form labels
        'code': '0.8125rem',        // 13px - Code snippets (monospace)
        'terminal': '0.8125rem',    // 13px - Terminal text
      },
    },
  },
  plugins: [],
}
