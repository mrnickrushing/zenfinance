import type { Config } from 'tailwindcss';

// Zen ledger-glass tokens: graphite, warm porcelain, coach teal, and restrained value gold.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eefaf8',
          100: '#dcefeb',
          200: '#b8ddd8',
          300: '#8fcac3',
          400: '#6bd2c7',
          500: '#42a39c',
          600: '#2f7f7a',
          700: '#256864',
          800: '#1d514e',
          900: '#173f3d',
          950: '#0d2928',
        },
        accent: {
          100: '#f7ead1',
          400: '#d8a143',
          500: '#c8902e',
          600: '#9e6e1f',
        },
        ledger: {
          ink: '#12161c',
          graphite: '#0d1117',
          panel: '#ffffff',
          panelDark: '#151b22',
          border: '#d9e0e2',
          borderDark: '#26313a',
          warm: '#f6f3ed',
          muted: '#617078',
          verified: '#2f8f5b',
          risk: '#c2413a',
        },
      },
      borderRadius: {
        card: '0.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(18 22 28 / 0.04), 0 10px 24px -18px rgb(18 22 28 / 0.28)',
        glow: '0 10px 28px -12px rgb(47 127 122 / 0.45)',
      },
      transitionDuration: {
        standard: '200ms',
      },
      transitionTimingFunction: {
        'out-zen': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
