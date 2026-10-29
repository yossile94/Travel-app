/**
 * Design tokens used by the app. Values mirror docs/design/tokens.json (the
 * designer's source of truth); scripts/tokens.test.mjs fails if they drift.
 */

export const colors = {
  light: {
    /** bg.surfaceRaised: sheets, the card, search. */
    surfaceRaised: '#FFFFFF',
    /** bg.surface: cards and fields on the canvas (sprint 2). */
    surface: '#FFFFFF',
    textPrimary: '#121C36',
    textSecondary: '#4A5573',
    textTertiary: '#646E8A',
    borderSubtle: '#F4E7D0',
    focusRing: '#1F78DB',
    pressed: '#FBF4E8',
    tag: '#FBF4E8',
    /** bg.tilePressed: a pressed card tile, whose rest colour is bg.tag (fix-country-card 12). */
    tilePressed: '#F4E7D0',
    chromeBg: 'rgba(255,255,255,0.92)',
    chromeFg: '#121C36',
    chromeBorder: 'rgba(18,28,54,0.08)',
    canvas: '#FFFBF5',
    scrim: 'rgba(6,11,24,0.48)',
    primary: '#1561BC',
    onPrimary: '#FFFFFF',
    secondaryBg: '#EEF6FF',
    secondaryFg: '#104C94',
    disabledBg: '#E9EEFA',
    disabledFg: '#646E8A',
    infoBg: '#EEF6FF',
    infoFg: '#104C94',
    link: '#1561BC',
    borderControl: '#7D869E',
    // Sprint 2 (tokens 0.3.0).
    surfaceAlt: '#FBF4E8',
    /** An expanded trip row in the card (design 2.1). */
    openRow: '#FBF4E8',
    ctaBg: '#C8441F',
    ctaFg: '#FFFFFF',
    ctaPressed: '#A8381A',
    successSubtleBg: '#E8FAF7',
    successSubtleFg: '#0A665D',
    activeBar: '#0B7F73',
    textAlert: '#C81E16',
    skeleton: '#F4E7D0',
    // Sprint 4 (design 5.1, 6.1): entry tags and the NSC bar. Red only for "no entry" and level 4.
    entryBannedBg: '#C81E16',
    entryBannedFg: '#FFFFFF',
    entryRestrictedBg: '#FFF2EE',
    entryRestrictedFg: '#A8381A',
    advisory1: '#0B7F73',
    advisory2: '#8F7550',
    advisory3: '#B45309',
    advisory4: '#C81E16',
    advisoryEmpty: '#7D869E',
    // Sprint 9 (design 8.2): the list dot that ties a row to the globe colour.
    discoverSwatch: '#9B6BEA',
    // Sprint 10 (design 6.3): the red passport banner, from tokens.json status.alert.
    alertSubtleBg: '#FFF0EF',
    alertSubtleFg: '#A0170F',
  },
  dark: {
    surfaceRaised: '#121C36',
    surface: '#0B1326',
    textPrimary: '#F3F6FC',
    textSecondary: '#A3B3DB',
    textTertiary: '#7487BD',
    borderSubtle: '#1A2749',
    focusRing: '#6FB3FA',
    pressed: '#1A2749',
    tag: '#1A2749',
    tilePressed: '#24355F',
    chromeBg: 'rgba(18,28,54,0.88)',
    chromeFg: '#F3F6FC',
    chromeBorder: 'rgba(163,179,219,0.32)',
    canvas: '#060B18',
    scrim: 'rgba(0,0,0,0.6)',
    primary: '#6FB3FA',
    onPrimary: '#060B18',
    secondaryBg: '#1A2749',
    secondaryFg: '#A9D2FF',
    disabledBg: '#1A2749',
    disabledFg: '#7487BD',
    infoBg: '#1A2749',
    infoFg: '#A9D2FF',
    link: '#6FB3FA',
    borderControl: '#7487BD',
    surfaceAlt: '#121C36',
    // Not surfaceAlt: in dark it equals the card's own surface (design 2.1).
    openRow: '#1A2749',
    ctaBg: '#FF7A57',
    ctaFg: '#060B18',
    ctaPressed: '#FF9677',
    successSubtleBg: '#0D2B2E',
    successSubtleFg: '#8FE3D6',
    activeBar: '#4FCFBE',
    textAlert: '#FF5D52',
    skeleton: '#1A2749',
    entryBannedBg: '#FF5D52',
    entryBannedFg: '#060B18',
    entryRestrictedBg: '#1A2749',
    entryRestrictedFg: '#FF9677',
    advisory1: '#4FCFBE',
    advisory2: '#D9BE90',
    advisory3: '#FFA94D',
    advisory4: '#FF5D52',
    advisoryEmpty: '#7487BD',
    discoverSwatch: '#B896F5',
    alertSubtleBg: '#3A1414',
    alertSubtleFg: '#FF8A80',
  },
} as const;

export type ColorScheme = keyof typeof colors;

/**
 * "Sign in with Google" button colours (design 4.3). Google's branding rules
 * fix these; checked against developers.google.com/identity/branding-guidelines.
 */
export const googleBrand = {
  light: { bg: '#FFFFFF', border: '#747775', fg: '#1F1F1F' },
  dark: { bg: '#131314', border: '#8E918F', fg: '#E3E3E3' },
} as const;

/** Toasts sit over the globe, so they are dark in both modes (design 7.5). */
export const toastColors = { bg: '#121C36', fg: '#F3F6FC' } as const;

/** Selection accent on the globe and the card strip (region colours come later, spec 12.2). */
export const highlightColor = '#FF7A57';

export const globe = {
  // Sprint 1 AC-8: no contrast (it crushed the dark ocean to black) and calmer
  // deserts; nothing is fully black or blinding (design 6.2).
  raster: {
    saturation: 0.12,
    contrast: 0,
    brightnessMin: 0.02,
    brightnessMax: 0.96,
    fadeDuration: 300,
  },
  /** Navy over the sea at the whole-globe view, gone by zoom 4 (AC-8). */
  oceanTint: '#1561BC',
  oceanTintOpacity: 0.4,
  oceanTintFadeStartZoom: 2,
  oceanTintFadeEndZoom: 4,
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
  borderWidthZ3: 0.75,
  borderWidthZ5: 1,
  borderWidthZ8: 1.6,
  /** Detailed borders replace the coarse ones from this zoom (AC-13a). */
  borderDetailMinZoom: 3,
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
  /**
   * Behind the status and navigation bars, so their light icons stay at least
   * 3:1 over bright imagery (sprint 1 AC-9). Alpha never below 0.5 (design 6.4).
   */
  systemScrim: {
    color: '#03060F',
    opacityEdge: 0.6,
    opacityInset: 0.5,
    fadeLength: 16,
    bottomFadeLength: 24,
  },
  /** Countries with trips (sprint 2 design 7): under the selection, never on the selected country. */
  trips: {
    color: '#4FCFBE',
    fillOpacity: 0.22,
    lineWidth: 1.2,
    underlayColor: '#03060F',
    underlayOpacity: 0.7,
    underlayWidth: 3.6,
    ringRadius: 7,
    ringWidth: 2,
    ringUnderlayWidth: 4,
  },
  /**
   * Discovery search (sprint 9 design 5–7): matching countries over the dim
   * of the rest; trips hide while it is on (5.3). One value for both themes.
   */
  discover: {
    color: '#B896F5',
    fillOpacity: 0.35,
    lineWidth: 1.4,
    underlayColor: '#03060F',
    underlayOpacity: 0.7,
    underlayWidth: 3.6,
    ringRadius: 7,
    ringWidth: 2,
    ringUnderlayWidth: 4,
    dimColor: '#03060F',
    dimOpacity: 0.55,
    layerFadeIn: 300,
    layerFadeOut: 200,
  },
  /** A city chosen in search (sprint 9 design 10.2): a temporary pin at a fixed city zoom. */
  cityPin: {
    radius: 6,
    fill: '#F3F6FC',
    strokeColor: '#FF7A57',
    strokeWidth: 3,
    underlayColor: '#03060F',
    underlayOpacity: 0.6,
    underlayWidth: 5,
    zoom: 5.5,
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
  /** How long a toast stays (design 7.5). */
  toastVisible: 3000,
  /** The account-deleted toast stays longer: it has no screen of its own (sprint 2 design 11.3). */
  toastVisibleLong: 5000,
  /** A loading skeleton shows only after this long, so a fast answer doesn't flash. */
  skeletonDelay: 150,
  skeletonPulse: 1000,
  /** Sprint 9 design 14. */
  discoverRefineIn: 200,
  discoverRefineOut: 150,
  discoverPanelEnter: 320,
  discoverPanelExit: 200,
  discoverPanelResize: 300,
  discoverCityPin: 200,
  discoverAnnounceDelay: 600,
} as const;

/** Lengths in code points after trim, as Postgres char_length counts them (sprint 2 design 3.3). */
export const limits = {
  tripNameMax: 80,
  tripNotesMax: 2000,
  profileNameMax: 60,
  tripNameCounterFrom: 60,
  tripNotesCounterFrom: 1800,
  profileNameCounterFrom: 50,
} as const;

export const timing = { tripSaveTimeout: 15000, accountDeleteTimeout: 20000 } as const;

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
  /** A country name longer than this steps down from title1 to title2 (sprint 1 AC-11). */
  cardNameStepDownChars: 16,
  /**
   * A generous width per character (pt, at font scale 1) of the card's
   * English name with its letter spacing: a name keeps the spacing only if
   * this many times its length fits the row (sprint 1 QA, BoardingPassCard).
   */
  cardNameEnSpacedCharWidth: 13,
  /** Above insets.bottom: the "My trips" button (sprint 2 design 1). */
  tripsButtonBottom: 16,
  tripRowMin: 72,
  dateFieldMinWidth: 160,
  formBarHeight: 56,
  couponNotchRadius: 11,
  /** Sprint 9 design 2.1, 8.9: the discovery rows below insets.top, and the panel. */
  discoverChipsTop: 108,
  discoverRefineTop: 156,
  discoverOverlayTopOneRow: 164,
  discoverOverlayTopTwoRows: 212,
  discoverPanelMaxRatio: 0.45,
  discoverPanelPeek: 72,
  discoverChipHeight: 40,
  discoverChipHitSlop: 4,
  discoverChipPadding: 14,
  discoverChipGap: 8,
  discoverRowMin: 64,
  discoverSwatch: 10,
  discoverMonthCellMin: 48,
  discoverChipMaxFontScale: 1.6,
  discoverPageSize: 50,
  /** The country card's tiles (fix-country-card 5.2, 5.3). */
  cardTileMinWidth: 64,
  cardTileMinHeight: 76,
  cardTileMaxWidthFew: 112,
  cardTileGap: 8,
  cardTileBadge: 20,
  cardTilesListFromFontScale: 1.6,
} as const;

export const radius = { xs: 4, md: 12, lg: 16, sheet: 28, pill: 999, flap: 4 } as const;

export const fonts = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;
