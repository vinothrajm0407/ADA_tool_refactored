/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        ivory:      '#F8F6F1',
        ink:        '#1F2937',
        body:       '#4B5563',
        teal: {
          DEFAULT:  '#0F766E',
          50:       '#f0fdfa',
          100:      '#ccfbf1',
          200:      '#99f6e4',
          300:      '#5eead4',
          400:      '#2dd4bf',
          500:      '#14b8a6',
          600:      '#0d9488',
          700:      '#0f766e',
          800:      '#115e59',
          900:      '#134e4a',
        },
        terracotta: '#D97757',
        sage:       '#6BA368',
        amber:      '#F59E0B',
        coral:      '#E76F51',
        night:      '#161616',
        charcoal:   '#1F1F1F',
        'brand-blue': '#2563EB',
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 18px 60px rgba(31, 41, 55, 0.09)',
        glow: '0 22px 80px rgba(15, 118, 110, 0.2)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
