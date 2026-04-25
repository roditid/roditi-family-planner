import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: { 50: '#FDFAF3', 100: '#FBF6EC', 200: '#F5ECD9' },
        sage: { 400: '#7FA87D', 500: '#5C7A5F', 600: '#45604A', 700: '#344B38' },
        coral: { 400: '#F0A98A', 500: '#E89070', 600: '#D2745A' },
        ink: { 700: '#3A3A36', 800: '#26261F', 900: '#141410' },
        adam: '#6BA3C5',
        liam: '#7FA87D',
        yali: '#E89070',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Georgia', 'Cambria', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,20,16,0.04), 0 8px 24px -12px rgba(20,20,16,0.12)',
        cardHover: '0 2px 4px rgba(20,20,16,0.06), 0 12px 32px -10px rgba(20,20,16,0.18)',
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
    },
  },
  plugins: [],
};
export default config;
