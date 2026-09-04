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
        ivory:      '#F5F6FA',
        ink:        '#10121A',
        body:       '#4A4F63',
        // Brand scale (referenced app-wide as `teal-*`) remapped to electric
        // indigo for the "precision instrument" identity. 300/700 remain
        // WCAG-AA text-on-tint pairs (300 for dark, 700 for light).
        teal: {
          DEFAULT:  '#4F46E5',
          50:       '#eef2ff',
          100:      '#e0e7ff',
          200:      '#c7d2fe',
          300:      '#a5b4fc',
          400:      '#818cf8',
          500:      '#6366f1',
          600:      '#4f46e5',
          700:      '#4338ca',
          800:      '#3730a3',
          900:      '#312e81',
        },
        // 300/700 shades are WCAG-AA text-contrast pairs (verified >=4.5:1) for
        // using these colors as TEXT on a light tint of themselves (badges,
        // pills, alerts) — 700 for light mode, 300 for dark mode. DEFAULT is
        // unchanged so every existing bg-x/text-x/border-x usage is untouched.
        terracotta: { DEFAULT: '#D97757', 300: '#F0A583', 700: '#A3502F' },
        sage:       { DEFAULT: '#6BA368', 300: '#8FCB8A', 700: '#3F6B3D' },
        amber:      { DEFAULT: '#F59E0B', 300: '#F6C453', 700: '#92640A', 800: '#7A5407' },
        coral:      { DEFAULT: '#E76F51', 300: '#F0947C', 700: '#B23D22' },
        night:      '#0B0C12',
        charcoal:   '#181A26',
        'brand-blue': { DEFAULT: '#4F46E5', 300: '#A5B4FC', 700: '#3730A3' },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        body:    ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16, 18, 26, 0.04), 0 8px 24px rgba(16, 18, 26, 0.06)',
        glow: '0 12px 40px rgba(79, 70, 229, 0.24)',
      },
      borderRadius: {
        '2xl': '0.875rem',
        '3xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
