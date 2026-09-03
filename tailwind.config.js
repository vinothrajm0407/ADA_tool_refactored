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
        // 300/700 shades are WCAG-AA text-contrast pairs (verified >=4.5:1) for
        // using these colors as TEXT on a light tint of themselves (badges,
        // pills, alerts) — 700 for light mode, 300 for dark mode. DEFAULT is
        // unchanged so every existing bg-x/text-x/border-x usage is untouched.
        terracotta: { DEFAULT: '#D97757', 300: '#F0A583', 700: '#A3502F' },
        sage:       { DEFAULT: '#6BA368', 300: '#8FCB8A', 700: '#3F6B3D' },
        amber:      { DEFAULT: '#F59E0B', 300: '#F6C453', 700: '#92640A', 800: '#7A5407' },
        coral:      { DEFAULT: '#E76F51', 300: '#F0947C', 700: '#B23D22' },
        night:      '#161616',
        charcoal:   '#1F1F1F',
        'brand-blue': { DEFAULT: '#2563EB', 300: '#93C5FD', 700: '#1E40AF' },
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
