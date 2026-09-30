/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gov: {
          navy: '#0b2545',
          navyDark: '#081a33',
          navyLight: '#13315c',
          blue: '#13315c',
          gold: '#b08d2b',
          goldLight: '#d4af5a',
          green: '#1e7a46',
          red: '#b3261e',
          amber: '#a35b00',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(120deg, #081a33 0%, #0b2545 45%, #164272 100%)',
        'hero-contour': "radial-gradient(circle at 15% 25%, rgba(255,255,255,0.06) 0, transparent 45%), radial-gradient(circle at 85% 15%, rgba(212,175,90,0.10) 0, transparent 40%)",
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.08)',
        'card-hover': '0 8px 20px -6px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.08)',
        header: '0 1px 0 rgba(255,255,255,0.08) inset, 0 4px 14px rgba(8,26,51,0.18)',
      },
    },
  },
  plugins: [],
};
