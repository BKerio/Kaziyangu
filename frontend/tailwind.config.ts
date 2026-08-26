import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#005A32',
          sidebar: '#06231A',
          teal: '#15211B',
        },
        surface: {
          page: '#F4F7F5',
          card: '#ffffff',
          border: '#E3E8E5',
        },
        slate: {
          text: '#6B7670',
        },
        status: {
          danger: '#D62828',
          warning: '#B7791F',
          success: '#169A5B',
          info: '#2563EB',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
        lg: '10px',
        full: '9999px',
      },
    },
  },
} satisfies Config;
