/**
 * Tailwind config for the Kashroot web client (Next.js App Router).
 * Pulls every colour from the shared design tokens so web + native never drift.
 *
 * Pair with Shadcn UI: run `npx shadcn@latest init` and point its CSS variables
 * at the `brand`/`slate` scales below. Shadcn gives us accessible, unstyled-by-
 * default primitives (Dialog, Table, DropdownMenu, Sheet) that we skin with
 * these tokens — ideal for the data-dense buyer/admin consoles.
 */
import type { Config } from 'tailwindcss';

import { palette, tokens } from './theme';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: palette.brand,
        saffron: palette.saffron,
        trend: palette.trend,
        buyer: palette.buyer,
        slate: palette.slate,
        status: palette.status,
        // Shadcn semantic aliases -> our brand.
        primary: { DEFAULT: palette.brand[500], foreground: '#ffffff' },
        secondary: { DEFAULT: palette.saffron[400], foreground: palette.slate[900] },
        destructive: { DEFAULT: palette.status.danger, foreground: '#ffffff' },
      },
      borderRadius: {
        sm: tokens.radius.sm,
        md: tokens.radius.md,
        lg: tokens.radius.lg,
        pill: tokens.radius.pill,
      },
      fontFamily: { sans: [tokens.font.sans] },
      boxShadow: { card: tokens.shadow.card, float: tokens.shadow.float },
      keyframes: {
        'kr-pulse': {
          '0%,100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.08)', opacity: '0.85' },
        },
        'kr-spin': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'kr-pulse': 'kr-pulse 1s infinite',
        'kr-spin': 'kr-spin 1.2s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
