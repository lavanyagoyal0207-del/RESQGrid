/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        night: {
          950: '#090d16', // Deep command navy-black
          900: '#0f172a', // Slate 900
          800: '#1e293b', // Slate 800
          700: '#334155', // Slate 700
          600: '#475569', // Slate 600
        },
        command: {
          bg: '#090d16',
          surface: '#0f172a',
          surfaceRaised: '#1e293b',
          border: 'rgba(148, 163, 184, 0.12)',
          accent: '#ea580c',
        },
        signal: {
          orange: '#ea580c',
          orangeHover: '#c2410c',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.2)', opacity: '0.3' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        }
      },
      animation: {
        pulseGlow: 'pulseGlow 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2.2s infinite',
      }
    },
  },
  plugins: [],
};
