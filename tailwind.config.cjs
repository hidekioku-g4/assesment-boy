/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./client/index.html', './client/src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        foreground: '#111827',
        accent: {
          DEFAULT: '#ff7a1a',
          foreground: '#ffffff',
        },
        sidebar: '#0f172a',
      },
      fontFamily: {
        sans: [
          'Inter',
          '"Noto Sans JP"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
      },
      boxShadow: {
        none: '0 0 #0000',
      },
      borderRadius: {
        xl: '1.25rem',
      },
    },
  },
  corePlugins: {
    boxShadow: true,
  },
  plugins: [],
};
