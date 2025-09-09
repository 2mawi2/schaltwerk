/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'panel': '#0b1220',
        'panelAlt': '#0f172a',
        'bg-primary': '#020617',
        'bg-secondary': '#0b1220',
        'bg-tertiary': '#0f172a',
        'bg-elevated': '#1e293b',
        'bg-hover': '#334155',
        'text-primary': '#f1f5f9',
        'text-secondary': '#cbd5e1',
        'text-tertiary': '#94a3b8',
        'text-muted': '#64748b',
        'border-default': '#1e293b',
        'border-subtle': '#334155',
        'border-strong': '#475569',
        'accent-blue': '#3b82f6',
        'accent-green': '#22c55e',
        'accent-amber': '#f59e0b',
        'accent-red': '#ef4444',
        'accent-violet': '#8b5cf6',
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