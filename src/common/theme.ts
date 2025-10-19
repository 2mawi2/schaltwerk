import { withOpacity } from './colorUtils'

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
      focus: '#06b6d4',      // cyan-500 (less neon)
    },
    
    accent: {
      blue: {
        DEFAULT: '#22d3ee',  // cyan-400 (logo color - now primary blue)
        light: '#22d3ee',    // cyan-400 (logo color)
        dark: '#0891b2',     // cyan-600
        bg: withOpacity('#22d3ee', 0.1),
        border: withOpacity('#22d3ee', 0.5),
      },
      green: {
        DEFAULT: '#22c55e',  // green-500
        light: '#4ade80',    // green-400
        dark: '#16a34a',     // green-600
        bg: withOpacity('#22c55e', 0.1),
        border: withOpacity('#22c55e', 0.5),
      },
      amber: {
        DEFAULT: '#f59e0b',  // amber-500
        light: '#fbbf24',    // amber-400
        dark: '#d97706',     // amber-600
        bg: withOpacity('#f59e0b', 0.1),
        border: withOpacity('#f59e0b', 0.5),
      },
      red: {
        DEFAULT: '#ef4444',  // red-500
        light: '#f87171',    // red-400
        dark: '#dc2626',     // red-600
        bg: withOpacity('#ef4444', 0.1),
        border: withOpacity('#ef4444', 0.5),
      },
      violet: {
        DEFAULT: '#8b5cf6',  // violet-500
        light: '#a78bfa',    // violet-400
        dark: '#7c3aed',     // violet-600
        bg: withOpacity('#8b5cf6', 0.1),
        border: withOpacity('#8b5cf6', 0.5),
      },
      purple: {
        DEFAULT: '#a855f7',  // purple-500
        light: '#c084fc',    // purple-400
        dark: '#9333ea',     // purple-600
        bg: withOpacity('#a855f7', 0.1),
        border: withOpacity('#a855f7', 0.5),
      },
      magenta: {
        DEFAULT: '#ec4899',  // magenta-500 (pink-500)
        light: '#f472b6',    // magenta-400 (pink-400)
        dark: '#db2777',     // magenta-600 (pink-600)
        bg: withOpacity('#ec4899', 0.1),
        border: withOpacity('#ec4899', 0.5),
      },
      yellow: {
        DEFAULT: '#eab308',  // yellow-500
        light: '#fde047',    // yellow-300
        dark: '#ca8a04',     // yellow-600
        bg: withOpacity('#eab308', 0.1),
        border: withOpacity('#eab308', 0.5),
      },
      cyan: {
        DEFAULT: '#06b6d4',  // cyan-500
        light: '#67e8f9',    // cyan-300
        dark: '#0891b2',     // cyan-600
        bg: withOpacity('#06b6d4', 0.1),
        border: withOpacity('#06b6d4', 0.5),
      },
    },
    
    status: {
      info: '#06b6d4',       // cyan-500 (less neon)
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
      bracket: '#ffd700',
      constant: '#4fc1ff',
      decorator: '#dcdcaa',
      regex: '#d16969',
      escape: '#d7ba7d',
      emphasis: '#c586c0',
      highlight: '#c6c6c6',
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
      bg: 'rgba(6, 182, 212, 0.5)',
    },
    
    overlay: {
      backdrop: 'rgba(0, 0, 0, 0.6)',
      light: 'rgba(255, 255, 255, 0.1)',
      dark: 'rgba(0, 0, 0, 0.3)',
      strong: 'rgba(0, 0, 0, 0.8)',
    },

    surface: {
      modal: '#1a1a1a',
    },

    editor: {
      background: '#0b1220',
      text: '#e2e8f0',
      caret: '#d4d4d4',
      gutterText: '#475569',
      gutterActiveText: '#c6c6c6',
      activeLine: 'rgba(255, 255, 255, 0.04)',
      inlineCodeBg: 'rgba(30, 30, 30, 0.8)',
      codeBlockBg: 'rgba(30, 30, 30, 0.5)',
      blockquoteBorder: '#404040',
      lineRule: '#404040',
      strikethrough: '#808080',
      selection: withOpacity('#06b6d4', 0.3),
      focusedSelection: withOpacity('#06b6d4', 0.4),
      selectionAlt: withOpacity('#ffffff', 0.04),
    },

    palette: {
      blue: {
        50: '#ecfeff',   // cyan-50
        100: '#cffafe',  // cyan-100
        200: '#a5f3fc',  // cyan-200
        300: '#67e8f9',  // cyan-300
        400: '#22d3ee',  // logo color (cyan-400)
        500: '#06b6d4',  // cyan-500
        600: '#0891b2',  // cyan-600
        700: '#0e7490',  // cyan-700
        800: '#155e75',  // cyan-800
        900: '#164e63',  // cyan-900
        950: '#083344',  // cyan-950
      },
      green: {
        50: '#f0fdf4',
        100: '#dcfce7',
        200: '#bbf7d0',
        300: '#86efac',
        400: '#4ade80',
        500: '#22c55e',
        600: '#16a34a',
        700: '#15803d',
        800: '#166534',
        900: '#14532d',
        950: '#052e16',
      },
      amber: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        300: '#fcd34d',
        400: '#fbbf24',
        500: '#f59e0b',
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
        950: '#451a03',
      },
      red: {
        50: '#fef2f2',
        100: '#fee2e2',
        200: '#fecaca',
        300: '#fca5a5',
        400: '#f87171',
        500: '#ef4444',
        600: '#dc2626',
        700: '#b91c1c',
        800: '#991b1b',
        900: '#7f1d1d',
        950: '#450a0a',
      },
      yellow: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        300: '#fde047',
        400: '#facc15',
        500: '#eab308',
        600: '#ca8a04',
        700: '#a16207',
        800: '#854d0e',
        900: '#713f12',
      },
      cyan: {
        50: '#ecfeff',
        100: '#cffafe',
        200: '#a5f3fc',
        300: '#67e8f9',
        400: '#22d3ee',
        500: '#06b6d4',
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
        950: '#083344',
      },
      purple: {
        50: '#faf5ff',
        100: '#f3e8ff',
        200: '#e9d5ff',
        300: '#d8b4fe',
        400: '#c084fc',
        500: '#a855f7',
        600: '#9333ea',
        700: '#7e22ce',
        800: '#6b21a8',
        900: '#581c87',
        950: '#3b0764',
      },
      violet: {
        50: '#f5f3ff',
        100: '#ede9fe',
        200: '#ddd6fe',
        300: '#c4b5fd',
        400: '#a78bfa',
        500: '#8b5cf6',
        600: '#7c3aed',
        700: '#6d28d9',
        800: '#5b21b6',
        900: '#4c1d95',
        950: '#2e1065',
      },
    },
  },

  layers: {
    modalOverlay: 1600,
    modalContent: 1610,
    dropdownOverlay: 2000,
    dropdownMenu: 2010,
  },
  
  spacing: {
    xs: '0.25rem',  // 4px
    sm: '0.5rem',   // 8px
    md: '1rem',     // 16px
    lg: '1.5rem',   // 24px
    xl: '2rem',     // 32px
    '2xl': '3rem',  // 48px
  },

  lineHeight: {
    body: 1.35,        // match VS Code baseline to avoid emoji clipping
    heading: 1.25,     // tighter for headings while keeping emoji visible
    compact: 1.15,     // compact stacks (badges, pills)
    badge: 1.2,        // inline badges with mixed text/emoji
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
      return theme.colors.accent.magenta
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
