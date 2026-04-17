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
          DEFAULT: '#d4587a',
          foreground: '#ffffff',
        },
        sidebar: '#0f172a',
      },
      fontFamily: {
        sans: [
          '"M PLUS Rounded 1c"',
          '"Noto Sans JP"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
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
