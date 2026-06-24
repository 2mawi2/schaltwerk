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
        'bg-selected': withOpacityValue('--color-bg-selected-rgb'),

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
        'xs':   'calc(var(--ui-font-size) * 0.786)',
        'sm':   'calc(var(--ui-font-size) * 0.929)',
        'base': 'var(--ui-font-size)',
        'lg':   'calc(var(--ui-font-size) * 1.143)',
        'xl':   'calc(var(--ui-font-size) * 1.286)',
        '2xl':  'calc(var(--ui-font-size) * 1.571)',
        '3xl':  'calc(var(--ui-font-size) * 1.857)',
        '4xl':  'calc(var(--ui-font-size) * 2.286)',
        'caption': 'var(--font-caption)',
        'body': 'var(--font-body)',
        'body-large': 'var(--font-body-large)',
        'heading': 'var(--font-heading)',
        'heading-large': 'var(--font-heading-large)',
        'heading-xlarge': 'var(--font-heading-xlarge)',
        'display': 'var(--font-display)',
        'button': 'var(--font-button)',
        'input': 'var(--font-input)',
        'label': 'var(--font-label)',
        'code': 'var(--font-code)',
        'terminal': 'var(--font-terminal)',
      },
    },
  },
  plugins: [],
}
