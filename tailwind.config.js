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
    },
  },
  plugins: [],
}