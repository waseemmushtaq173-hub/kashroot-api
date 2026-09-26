/**
 * Kashroot design tokens — the single source of truth for the premium
 * agricultural look, consumed by tailwind.config.ts (web) and usable directly
 * by React Native Paper's theme (mobile).
 *
 * Palette intent:
 *   - brand.*   Kashroot Green — primary actions, farmer surfaces, "trust".
 *   - saffron.* Kashmir saffron — secondary accent / premium highlights.
 *   - trend.*   HIGH-CONTRAST mandi movement (never rely on colour alone —
 *               pair with the ▲ ▼ — glyphs in MandiPriceCard).
 *   - slate.*   Neutral institutional greys for admin/buyer data tables.
 *   - buyer.*   B2B blue accent for the buyer console.
 */

export const palette = {
  brand: {
    50: '#e9f6ee',
    100: '#c9e9d4',
    300: '#6cc088',
    500: '#1f7a3d', // Kashroot Green — primary
    600: '#186531',
    700: '#124b25',
    900: '#0a2c16',
  },
  saffron: {
    100: '#fbeccb',
    400: '#e8a33d',
    600: '#c8801a', // premium accent / expert highlights
  },
  trend: {
    up: '#1b8a3a', // price rose   — green
    down: '#d32f2f', // price fell   — red
    stable: '#9e9e9e', // unchanged    — grey
  },
  buyer: {
    500: '#0d47a1', // B2B console accent
    600: '#093578',
  },
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    400: '#94a3b8',
    600: '#475569',
    800: '#1e293b',
    900: '#0f172a', // admin back-office chrome
  },
  status: {
    success: '#1b8a3a',
    warning: '#e8a33d',
    danger: '#d32f2f',
    info: '#0d47a1',
  },
} as const;

/** Non-colour tokens shared across layouts. */
export const tokens = {
  radius: { sm: '8px', md: '12px', lg: '20px', pill: '999px' },
  font: {
    sans: `'Inter', 'Segoe UI', system-ui, sans-serif`,
    // Farmer surfaces scale everything up for low-literacy / low-vision users.
    farmerBase: '20px',
  },
  shadow: {
    card: '0 4px 16px rgba(0,0,0,0.12)',
    float: '0 8px 24px rgba(0,0,0,0.25)',
  },
} as const;

export type Palette = typeof palette;
