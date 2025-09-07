/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html','./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          600: '#0b76e0',
          700: '#0a66c2',
        }
      },
      boxShadow: {
        soft: '0 6px 24px rgba(0,0,0,0.06)'
      }
    }
  },
  plugins: []
}

