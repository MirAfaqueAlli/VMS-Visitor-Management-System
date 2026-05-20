/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ── Page & Content ────────────────────────────────────────────────
        page:   '#f8fafc',
        card:   '#ffffff',
        border: '#e2e8f0',

        // ── Text ─────────────────────────────────────────────────────────
        primary: '#0f172a',
        muted:   '#475569',

        // ── Accent ───────────────────────────────────────────────────────
        accent: {
          DEFAULT: '#f59e0b',
          dark:    '#d97706',
          light:   '#fef3c7',
        },

        // ── Sidebar ──────────────────────────────────────────────────────
        sidebar: {
          bg:            '#0f172a',
          text:          '#94a3b8',
          'active-bg':   '#f59e0b',
          'active-text': '#0f172a',
        },

        // ── Status ────────────────────────────────────────────────────────
        success: { DEFAULT: '#16a34a', light: '#f0fdf4' },
        warning: { DEFAULT: '#f59e0b', light: '#fffbeb' },
        danger:  { DEFAULT: '#dc2626', light: '#fef2f2' },
        info:    { DEFAULT: '#0284c7', light: '#eff6ff' },

        // ── Pastel stat card bgs ──────────────────────────────────────────
        pastel: {
          pink:   '#fdf2f8',
          purple: '#f5f3ff',
          green:  '#f0fdf4',
          blue:   '#eff6ff',
          orange: '#fffbeb',
        },

        // ── Botanical aliases — keeps all old pages working ───────────────
        botanical: {
          bg:           '#f8fafc',
          fg:           '#0f172a',
          primary:      '#f59e0b',
          muted:        '#e2e8f0',
          border:       '#e2e8f0',
          interactive:  '#d97706',
          card:         '#f1f5f9',
          'card-white': '#ffffff',
        },
      },

      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '14px',    // map xl → lg (restaurant uses lg max)
        '2xl': '14px', // flatten the very round corners
        '4xl': '14px',
      },

      boxShadow: {
        'card':    '0 1px 3px rgba(15,23,42,0.06)',
        'card-md': '0 4px 12px rgba(15,23,42,0.08)',
        'card-lg': '0 8px 24px rgba(15,23,42,0.10)',
        'sidebar': '1px 0 0 rgba(255,255,255,0.06)',
        // keep old names for compat:
        'soft-sm': '0 1px 3px rgba(0,0,0,0.06)',
        'soft-md': '0 4px 12px rgba(0,0,0,0.08)',
        'soft-lg': '0 8px 24px rgba(0,0,0,0.10)',
        'soft-xl': '0 8px 24px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};
