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
          950: '#120721',
          900: '#1a0b2e',
          800: '#2D1B4E',
          700: '#3d2666',
          600: '#523485',
        },
        signal: {
          orange: '#FF6B35',
          orangeHover: '#ff8255',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      keyframes: {
        fogDrift: {
          '0%': { transform: 'translate3d(-4%, -2%, 0) scale(1.03)', opacity: '0.22' },
          '50%': { transform: 'translate3d(4%, 2%, 0) scale(1.08)', opacity: '0.34' },
          '100%': { transform: 'translate3d(-4%, -2%, 0) scale(1.03)', opacity: '0.22' },
        },
        pulseGlow: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.45)', opacity: '0.2' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        }
      },
      animation: {
        fog: 'fogDrift 22s ease-in-out infinite',
        fogSlow: 'fogDrift 34s ease-in-out infinite reverse',
        pulseGlow: 'pulseGlow 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        shimmer: 'shimmer 2.2s infinite',
      }
    },
  },
  plugins: [],
};
