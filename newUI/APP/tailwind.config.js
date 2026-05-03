/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        phi: {
          primary: '#146ef5',
          secondary: '#7a3dff',
          accent: '#00d722',
          success: '#00d722',
          warning: '#ffae13',
          danger: '#ee1d36',
          dark: '#080808',
          light: '#ffffff',
        },
        // phicoin.net dark palette - slate-based
        dark: {
          bg: '#0f172a',       // slate-900 - main background
          surface: '#1e293b',  // slate-800 - cards, sidebar
          elevated: '#334155', // slate-700 - inputs, hover states
          border: '#334155',   // slate-700 - borders
          muted: '#475569',    // slate-600 - subtle borders
          text: '#f8fafc',     // slate-50 - primary text
          secondary: '#e2e8f0', // slate-200 - secondary text
          mutedText: '#94a3b8', // slate-400 - muted text
          accent: '#3b82f6',   // blue-500 - accent glows
          purple: '#8b5cf6',   // violet-500 - accent
          cyan: '#06b6d4',     // cyan-500 - accent
        },
        gray: {
          800: '#222222',
          700: '#363636',
          600: '#5a5a5a',
          400: '#ababab',
          300: '#d8d8d8',
        },
      },
    },
  },
  plugins: [],
};
