/** @type {import('tailwindcss').Config} */
// Every colour / radius / size reads a token from src/index.css (DESIGN_RULES.md).
const v = (name) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: v('font-ui'),
        mono: v('font-code'),
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],      // 11px
        xs:    ['0.75rem',   { lineHeight: '1.125rem' }],  // 12px
        sm:    ['0.8125rem', { lineHeight: '1.25rem' }],   // 13px
        base:  ['0.875rem',  { lineHeight: '1.375rem' }],  // 14px
      },
      fontWeight: {
        normal: '450',
        medium: '560',
        semibold: '650',
        bold: '700',
      },
      colors: {
        canvas: v('canvas'),
        surface: { DEFAULT: v('surface'), alt: v('surface-alt') },
        'surface-alt': v('surface-alt'),
        'neutral-soft': v('neutral-soft'),
        tile: v('tile'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        'line-strong': v('line-strong'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2') },
        'ink-2': v('ink-2'),
        muted: v('muted'),
        primary: { DEFAULT: v('primary'), strong: v('primary-strong'), hover: v('primary-hover'), soft: v('primary-soft') },
        secondary: { DEFAULT: v('secondary'), soft: v('secondary-soft') },
        tertiary: v('tertiary'),
        link: v('link'),
        success: { DEFAULT: v('success'), soft: v('success-soft'), light: v('success-soft') },
        warning: { DEFAULT: v('warning-text'), bright: v('warning'), soft: v('warning-soft'), light: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft'), light: v('danger-soft') },

        // legacy names (older markup) → tokens
        accent: { DEFAULT: v('primary-strong'), dark: v('primary-hover'), light: v('primary-soft') },
        border: v('line'),
        page: v('canvas'),
        card: v('surface'),
        info: { DEFAULT: v('secondary'), light: v('secondary-soft') },
      },
      borderRadius: {
        none: '0',
        sm: v('radius'),
        DEFAULT: v('radius'),
        md: v('radius'),
        lg: v('cell-radius'),
        xl: v('tile-radius'),
        '2xl': v('sheet-radius'),
        '3xl': v('sheet-radius'),
        full: '9999px',
      },
      boxShadow: {
        none: 'none',
        sm: 'none', DEFAULT: 'none', md: 'none', lg: 'none', xl: 'none', '2xl': 'none',
        card: 'none', 'card-md': 'none', 'card-lg': 'none', hover: 'none',
      },
      height: { control: v('control-h') },
      minHeight: { control: v('control-h') },
      transitionDuration: { fast: '120ms' },
    },
  },
  plugins: [],
};
