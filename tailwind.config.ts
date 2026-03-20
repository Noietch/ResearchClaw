import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
      },
      colors: {
        notion: {
          bg: '#ffffff',
          sidebar: '#f7f7f5',
          'sidebar-hover': '#ebebea',
          border: '#e8e8e5',
          text: '#37352f',
          'text-secondary': '#6b6b6b',
          'text-tertiary': '#9b9a97',
          accent: '#2eaadc',
          'accent-light': '#e8f4f8',
          red: '#eb5757',
          orange: '#fa8c16',
          yellow: '#dfab01',
          green: '#0f7b0f',
          blue: '#2eaadc',
          purple: '#9065b0',
          pink: '#e255a1',
          'tag-bg': '#f1f1ef',
          'tag-blue': '#d3e5ef',
          'tag-green': '#dbeddb',
          'tag-orange': '#fadec9',
          'tag-purple': '#e8deee',
          'tag-pink': '#f5e0e9',
          'tag-yellow': '#fdecc8',
          'tag-red': '#ffe2dd',
        },
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        notion: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)',
        'notion-hover': '0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)',
        'notion-modal': '0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.3s ease-out forwards',
        'fade-in': 'fade-in 0.2s ease-out forwards',
        'scale-in': 'scale-in 0.2s ease-out forwards',
      },
    },
  },
  plugins: [typography],
};

export default config;
