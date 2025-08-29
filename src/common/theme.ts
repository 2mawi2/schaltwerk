export const theme = {
  colors: {
    background: {
      primary: '#020617',    // slate-950
      secondary: '#0b1220',  // panel background
      tertiary: '#0f172a',   // slate-900
      elevated: '#1e293b',   // slate-800
      hover: '#334155',      // slate-700
      active: '#475569',     // slate-600
    },
    
    text: {
      primary: '#f1f5f9',    // slate-100
      secondary: '#cbd5e1',  // slate-300
      tertiary: '#94a3b8',   // slate-400
      muted: '#64748b',      // slate-500
      inverse: '#020617',    // slate-950
    },
    
    border: {
      default: '#1e293b',    // slate-800
      subtle: '#334155',     // slate-700
      strong: '#475569',     // slate-600
      focus: '#3b82f6',      // blue-500
    },
    
    accent: {
      blue: {
        DEFAULT: '#3b82f6',  // blue-500
        light: '#60a5fa',    // blue-400
        dark: '#2563eb',     // blue-600
        bg: 'rgba(59, 130, 246, 0.1)',
        border: 'rgba(59, 130, 246, 0.5)',
      },
      green: {
        DEFAULT: '#22c55e',  // green-500
        light: '#4ade80',    // green-400
        dark: '#16a34a',     // green-600
        bg: 'rgba(34, 197, 94, 0.1)',
        border: 'rgba(34, 197, 94, 0.5)',
      },
      amber: {
        DEFAULT: '#f59e0b',  // amber-500
        light: '#fbbf24',    // amber-400
        dark: '#d97706',     // amber-600
        bg: 'rgba(245, 158, 11, 0.1)',
        border: 'rgba(245, 158, 11, 0.5)',
      },
      red: {
        DEFAULT: '#ef4444',  // red-500
        light: '#f87171',    // red-400
        dark: '#dc2626',     // red-600
        bg: 'rgba(239, 68, 68, 0.1)',
        border: 'rgba(239, 68, 68, 0.5)',
      },
      violet: {
        DEFAULT: '#8b5cf6',  // violet-500
        light: '#a78bfa',    // violet-400
        dark: '#7c3aed',     // violet-600
        bg: 'rgba(139, 92, 246, 0.1)',
        border: 'rgba(139, 92, 246, 0.5)',
      },
      purple: {
        DEFAULT: '#a855f7',  // purple-500
        light: '#c084fc',    // purple-400
        dark: '#9333ea',     // purple-600
        bg: 'rgba(168, 85, 247, 0.1)',
        border: 'rgba(168, 85, 247, 0.5)',
      },
      yellow: {
        DEFAULT: '#eab308',  // yellow-500
        light: '#fde047',    // yellow-300
        dark: '#ca8a04',     // yellow-600
        bg: 'rgba(234, 179, 8, 0.1)',
        border: 'rgba(234, 179, 8, 0.5)',
      },
      cyan: {
        DEFAULT: '#06b6d4',  // cyan-500
        light: '#67e8f9',    // cyan-300
        dark: '#0891b2',     // cyan-600
        bg: 'rgba(6, 182, 212, 0.1)',
        border: 'rgba(6, 182, 212, 0.5)',
      },
    },
    
    status: {
      info: '#3b82f6',       // blue-500
      success: '#22c55e',    // green-500
      warning: '#f59e0b',    // amber-500
      error: '#ef4444',      // red-500
    },
    
    syntax: {
      // VS Code dark theme colors for syntax highlighting
      default: '#d4d4d4',
      comment: '#6a9955',
      variable: '#9cdcfe',
      number: '#b5cea8',
      type: '#4ec9b0',
      keyword: '#569cd6',
      string: '#ce9178',
      function: '#dcdcaa',
      operator: '#d4d4d4',
      punctuation: '#808080',
      tag: '#569cd6',
      attribute: '#9cdcfe',
      selector: '#d7ba7d',
      property: '#9cdcfe',
    },
    
    diff: {
      addedBg: 'rgba(87, 166, 74, 0.15)',
      addedText: '#57a64a',
      removedBg: 'rgba(244, 135, 113, 0.15)',
      removedText: '#f48771',
      modifiedBg: 'rgba(245, 158, 11, 0.15)',
      modifiedText: '#f59e0b',
    },
    
    scrollbar: {
      track: 'rgba(30, 41, 59, 0.5)',
      thumb: 'rgba(71, 85, 105, 0.8)',
      thumbHover: 'rgba(100, 116, 139, 0.9)',
    },
    
    selection: {
      bg: 'rgba(59, 130, 246, 0.5)',
    },
    
    overlay: {
      backdrop: 'rgba(0, 0, 0, 0.6)',
      light: 'rgba(255, 255, 255, 0.1)',
      dark: 'rgba(0, 0, 0, 0.3)',
    },
  },
  
  spacing: {
    xs: '0.25rem',  // 4px
    sm: '0.5rem',   // 8px
    md: '1rem',     // 16px
    lg: '1.5rem',   // 24px
    xl: '2rem',     // 32px
    '2xl': '3rem',  // 48px
  },
  
  borderRadius: {
    none: '0',
    sm: '0.125rem',  // 2px
    DEFAULT: '0.25rem', // 4px
    md: '0.375rem',  // 6px
    lg: '0.5rem',    // 8px
    xl: '0.75rem',   // 12px
    full: '9999px',
  },
  
   fontSize: {
     // Legacy sizes (for backward compatibility)
     xs: '0.75rem',   // 12px
     sm: '0.875rem',  // 14px
     base: '1rem',    // 16px
     lg: '1.125rem',  // 18px
     xl: '1.25rem',   // 20px
     '2xl': '1.5rem', // 24px

     // Standardized semantic font sizes
     caption: '0.6875rem',  // 11px - Small labels, metadata
     body: '0.875rem',      // 14px - Primary body text
     bodyLarge: '1rem',     // 16px - Larger body text
     heading: '1.125rem',   // 18px - Section headings
     headingLarge: '1.25rem', // 20px - Main headings
     headingXLarge: '1.5rem', // 24px - Page titles
     display: '2rem',       // 32px - Hero text, important notices

     // UI-specific sizes
     button: '0.875rem',    // 14px - Button text
     input: '0.875rem',     // 14px - Input field text
     label: '0.8125rem',    // 13px - Form labels
     code: '0.8125rem',     // 13px - Code snippets (monospace)
     terminal: '0.8125rem', // 13px - Terminal text
   },
  
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
    DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.5), 0 1px 2px 0 rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
  },
  
  animation: {
    duration: {
      fast: '150ms',
      normal: '300ms',
      slow: '500ms',
    },
    easing: {
      ease: 'ease',
      easeIn: 'ease-in',
      easeOut: 'ease-out',
      easeInOut: 'ease-in-out',
    },
  },
}

export const getSessionColor = (status: string) => {
  switch (status) {
    case 'running':
      return theme.colors.accent.blue
    case 'completed':
      return theme.colors.accent.green
    case 'spec':
      return theme.colors.accent.amber
    case 'error':
      return theme.colors.accent.red
    default:
      return theme.colors.border
  }
}

export const getFileStatusColor = (status: string) => {
  switch (status) {
    case 'added':
      return theme.colors.accent.green.DEFAULT
    case 'modified':
      return theme.colors.accent.amber.DEFAULT
    case 'deleted':
      return theme.colors.accent.red.DEFAULT
    default:
      return theme.colors.accent.blue.DEFAULT
  }
}