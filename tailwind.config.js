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
        // Exact palette from the Figma Make redesign — light-only, no dark variant.
        ivory:      '#F9FAFB',
        ink:        '#111827',
        body:       '#6B7280',
        teal: {
          DEFAULT:  '#1a7a6a',
          50:       '#f0faf8',
          100:      '#e8f5f2',
          200:      '#b2d8d0',
          300:      '#8fcbc0',
          400:      '#4fa696',
          500:      '#2a9483',
          600:      '#1f8874',
          700:      '#1a7a6a',
          800:      '#155f53',
          900:      '#0f4a41',
        },
        // Mapped to Tailwind's own red/emerald/orange scales so every existing
        // bg-x/10 + text-x-700 badge/pill usage renders as the mockup's flat
        // bg-red-100/text-red-700 etc. look without touching each call site.
        terracotta: { DEFAULT: '#D97757', 300: '#F0A583', 700: '#A3502F' },
        sage:       { DEFAULT: '#059669', 300: '#6ee7b7', 700: '#047857' },
        amber:      { DEFAULT: '#ea580c', 300: '#fdba74', 700: '#c2410c', 800: '#9a3412' },
        coral:      { DEFAULT: '#dc2626', 300: '#fca5a5', 700: '#b91c1c' },
        night:      '#0D1117',
        charcoal:   '#161B22',
        'brand-blue': { DEFAULT: '#2563EB', 300: '#93C5FD', 700: '#1E40AF' },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06)',
        glow: '0 12px 40px rgba(26, 122, 106, 0.22)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
