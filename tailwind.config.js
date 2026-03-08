/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        panel: '0 8px 24px -12px rgba(24, 24, 27, 0.28)',
      },
    },
  },
  plugins: [],
}
