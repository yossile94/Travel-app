/**
 * Design tokens used by the app. Values mirror docs/design/tokens.json (the
 * designer's source of truth); scripts/tokens.test.mjs fails if they drift.
 */

export const colors = {
  light: {
    surface: '#FFFFFF',
    textPrimary: '#121C36',
    textSecondary: '#4A5573',
    borderSubtle: '#F4E7D0',
    focusRing: '#1F78DB',
  },
  dark: {
    surface: '#121C36',
    textPrimary: '#F3F6FC',
    textSecondary: '#A3B3DB',
    borderSubtle: '#1A2749',
    focusRing: '#6FB3FA',
  },
} as const;

export type ColorScheme = keyof typeof colors;

/** Selection accent on the globe and the card strip (region colours come later, spec 12.2). */
export const highlightColor = '#FF7A57';

export const globe = {
  raster: { saturation: 0.35, contrast: 0.12, fadeDuration: 300 },
  atmosphere: {
    color: '#9FD0FF',
    highColor: '#2F7BE0',
    horizonBlend: 0.035,
    spaceColor: '#03060F',
    starIntensity: 0.4,
  },
  /** Shown under the imagery while it loads, and when it can't (offline). */
  baseOcean: '#0A1A3C',
  border: 'rgba(243,246,252,0.42)',
  borderWidthZ0: 0.5,
  borderWidthZ5: 1,
  highlight: {
    fillOpacity: 0.3,
    glowWidth: 8,
    glowBlur: 6,
    outline: '#F3F6FC',
    outlineWidth: 1.6,
  },
} as const;

export const motion = {
  short: 200,
  sheet: 320,
  highlight: 600,
  splitFlap: 700,
  flyToMin: 1200,
  flyToMax: 1800,
  reduceFadeOut: 150,
  reduceFadeIn: 250,
  autoRotateDegPerSec: 3,
  autoRotateResumeDelay: 5000,
  autoRotateRamp: 1000,
} as const;

export const radius = { sheet: 28, flap: 4 } as const;

export const fonts = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;
