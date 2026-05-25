/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glow: '0 0 0 1px rgba(148, 163, 184, 0.22), 0 24px 80px rgba(15, 23, 42, 0.35)',
      },
      fontFamily: {
        sans: ['Aptos', 'Segoe UI Variable', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#050816',
          900: '#0b1120',
          800: '#11182c',
          700: '#1c2740',
        },
      },
    },
  },
  plugins: [],
};
