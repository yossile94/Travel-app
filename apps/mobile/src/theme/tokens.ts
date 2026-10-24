/**
 * Design tokens used by the app. Values mirror docs/design/tokens.json (the
 * designer's source of truth); scripts/tokens.test.mjs fails if they drift.
 */

export const colors = {
  light: {
    surface: '#FFFFFF',
    textPrimary: '#121C36',
    textSecondary: '#4A5573',
    textTertiary: '#646E8A',
    borderSubtle: '#F4E7D0',
    focusRing: '#1F78DB',
    pressed: '#FBF4E8',
    tag: '#FBF4E8',
    chromeBg: 'rgba(255,255,255,0.92)',
    chromeFg: '#121C36',
    chromeBorder: 'rgba(18,28,54,0.08)',
  },
  dark: {
    surface: '#121C36',
    textPrimary: '#F3F6FC',
    textSecondary: '#A3B3DB',
    textTertiary: '#7487BD',
    borderSubtle: '#1A2749',
    focusRing: '#6FB3FA',
    pressed: '#1A2749',
    tag: '#1A2749',
    chromeBg: 'rgba(18,28,54,0.88)',
    chromeFg: '#F3F6FC',
    chromeBorder: 'rgba(163,179,219,0.32)',
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
  /** Around a selected small country, which is too small to see highlighted (sprint 1 AC-7). */
  selectionRing: {
    radius: 10,
    width: 2,
    color: '#F3F6FC',
    underlayWidth: 4,
    underlayColor: '#03060F',
    underlayOpacity: 0.6,
  },
  /** Dims the globe behind open search (sprint 1 design 2.1). */
  searchScrim: 'rgba(3,6,15,0.40)',
} as const;

export const motion = {
  micro: 100,
  short: 200,
  medium: 300,
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
  /** Delay before the screen reader hears the result count (sprint 1 AC-6). */
  searchAnnounceDelay: 600,
} as const;

/** Sizes and positions of the controls over the globe (sprint 1 design 1). */
export const layout = {
  touchTargetMin: 48,
  listRowMin: 56,
  chromeEdge: 12,
  /** Below insets.top. */
  chromeRowTop: 52,
  /** Below insets.top: the hint, offline pill, error banner and toast. */
  overlayTop: 112,
  mapboxLogoTop: 12,
  mapboxLogoLeft: 12,
  mapboxAttributionLeft: 100,
} as const;

export const radius = { xs: 4, lg: 16, sheet: 28, pill: 999, flap: 4 } as const;

export const fonts = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;
