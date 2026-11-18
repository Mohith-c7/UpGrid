/**
 * UpGrid design tokens (Indigo enterprise system).  See app/DESIGN.md for usage.
 * Every text/background pair below is checked against WCAG 2.1 AA (>= 4.5:1 for text, >= 3:1 for UI boundaries/icons).
 * Legacy keys (primary, muted, error, coral, teal, ...) are kept so existing screens keep compiling; they map onto the new palette.
 */
import { Platform, type TextStyle } from 'react-native';

/* ---------------- Official palette ---------------- */
/** The brand palette exactly as specified. Screens should consume `colors` / `toneColors`, not these raw values. */
export const palette = {
  primary: '#4F46E5',
  primaryHover: '#4338CA',
  primaryLight: '#EEF2FF',
  text: '#111827',
  textSecondary: '#64748B',
  background: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E5E7EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#2563EB',
} as const;

/* ---------------- Scales ---------------- */
export const indigo = {
  900: '#312E81',
  800: '#3730A3',
  700: palette.primaryHover, // hover / pressed
  600: palette.primary, // brand (6.3:1 on white)
  500: '#6366F1',
  200: '#C7D2FE',
  100: '#E0E7FF',
  50: palette.primaryLight,
} as const;

/** @deprecated The brand moved from teal to indigo. Alias kept for backwards compatibility. */
export const teal = indigo;

export const slate = {
  50: palette.background,
  100: '#F1F5F9',
  200: palette.border, // hairline
  300: '#D1D5DB',
  400: '#8492A6', // control outline (3.2:1 on white)
  500: '#6B7280', // icons, placeholders (4.8:1 on white)
  600: palette.textSecondary, // secondary text (4.8:1 on white, 4.5:1 on canvas)
  700: '#374151',
  800: '#1F2937',
  900: palette.text,
} as const;

/** Urgency now uses the Danger family. `fill` shapes take white text (4.8:1); `text` is for red text on white/tints. */
export const coral = {
  500: palette.danger,
  600: '#B91C1C',
  50: '#FEF2F2',
  text: '#B91C1C', // 6.5:1 on white, 5.9:1 on #FEF2F2
} as const;

export const amber = {
  500: palette.warning,
  50: '#FFFBEB',
  text: '#B45309', // 5.0:1 on white, 4.8:1 on #FFFBEB
} as const;

export const colors = {
  /* brand */
  primary: indigo[600],
  primaryDark: indigo[700],
  primaryHover: indigo[700],
  primaryDeep: indigo[800],
  primarySoft: indigo[500],
  primaryTint: indigo[50],
  primaryTint2: indigo[100],
  primaryBorder: indigo[200],
  /* urgency + warning accents (legacy names) */
  coral: coral[500],
  coralDark: coral[600],
  coralTint: coral[50],
  coralText: coral.text,
  amber: amber[500],
  amberTint: amber[50],
  amberText: amber.text,
  /* neutrals */
  ink: slate[900],
  text: slate[900],
  textSecondary: slate[700],
  muted: slate[600],
  subtle: slate[500],
  disabled: '#9CA3AF',
  canvas: palette.background,
  surface: palette.card,
  surfaceAlt: palette.background,
  pressed: slate[100],
  border: slate[200], // hairline for cards / dividers / tables
  borderStrong: slate[400], // form control outline
  onPrimary: '#FFFFFF',
  onPrimaryMuted: indigo[200], // secondary text on indigo-700+ (5.2:1)
  /* status: text-safe colours (text + icons on white and on their tinted backgrounds) */
  success: '#15803D',
  warning: amber.text,
  error: coral.text,
  info: '#1D4ED8',
  /* status: official solid colours for fills, bars, dots, chart series and filled buttons */
  successSolid: palette.success,
  warningSolid: palette.warning,
  errorSolid: palette.danger,
  errorSolidPressed: coral[600],
  infoSolid: palette.info,
  /* status: tinted backgrounds */
  successBg: '#F0FDF4',
  warningBg: amber[50],
  errorBg: coral[50],
  infoBg: '#EFF6FF',
  neutralBg: slate[100],
  /* status: soft borders to pair with tinted backgrounds */
  successBorder: '#BBF7D0',
  warningBorder: '#FDE68A',
  errorBorder: '#FECACA',
  infoBorder: '#BFDBFE',
  neutralBorder: slate[200],
  overlay: 'rgba(17,24,39,0.45)',
  /** pressed state for controls placed on an indigo fill */
  pressedOnPrimary: 'rgba(255,255,255,0.14)',
  /* status icons on the dark ink surface (toasts); each >= 7:1 on #111827 */
  onInkSuccess: '#4ADE80',
  onInkError: '#F87171',
  onInkInfo: '#A5B4FC',
} as const;

/** Ordered series colours for charts: brand first, then semantic hues. Each is >= 3:1 against white. */
export const chartColors = [palette.primary, palette.info, palette.success, palette.warning, palette.danger, slate[500]] as const;

/* ---------------- Spacing / radius / sizing ---------------- */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
/** Three radii only: 12 for surfaces, 8 for controls, 6 for small tags. Sheets use 16 on their top corners. */
export const radius = { card: 12, button: 8, input: 8, field: 8, chip: 6, logo: 10, sheet: 16, bar: 4 } as const;
export const MIN_TOUCH = 48;
export const CONTROL_HEIGHT = 48; // buttons, text fields, selects, search bars
export const SCREEN_PADDING = 16;

/* ---------------- Typography ---------------- */
export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subhead'
  | 'body'
  | 'caption'
  | 'overline'
  | 'button'
  /** legacy aliases: section = subhead, meta = caption */
  | 'section'
  | 'meta';

type Weight = '400' | '500' | '600' | '700';
export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: Weight;
  letterSpacing?: number;
  uppercase?: boolean;
}

/** Restrained scale: headings are 600, body 400, labels/buttons 500-600. 700 is reserved for initials tiles. */
export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: '600', letterSpacing: -0.4 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: -0.1 },
  subhead: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.6, uppercase: true },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  section: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
};

/* Inter loading state.  The root layout calls setInterLoaded(true) after the fonts load; until then (or if loading fails)
 * we render with the system font so the app never blocks on typography. */
let interLoaded = false;
export function setInterLoaded(v: boolean) {
  interLoaded = v;
}
export const INTER_FONTS = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
} as const;
/** Returns fontFamily for a weight (undefined = system font fallback). Android needs a family per weight. */
export function fontFamilyFor(weight: TextStyle['fontWeight'] | undefined): string | undefined {
  if (!interLoaded) return undefined;
  const w = String(weight ?? '400');
  if (w === 'bold' || w === '800' || w === '900') return INTER_FONTS['700'];
  if (w === '600') return INTER_FONTS['600'];
  if (w === '500') return INTER_FONTS['500'];
  if (w === '700') return INTER_FONTS['700'];
  return INTER_FONTS['400'];
}

/* ---------------- Elevation ---------------- */
/** Borders do the work. `card` is a barely-there lift (no Android elevation); `overlay` is for toasts and floating menus. */
export const shadow = {
  card: {
    shadowColor: palette.text,
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 0,
  },
  overlay: {
    shadowColor: palette.text,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

/* ---------------- Status tones ---------------- */
export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
/** fg = text/icon colour, bg = tinted background, border = soft outline, solid = official fill colour. fg-on-bg >= 4.8:1. */
export const toneColors: Record<Tone, { fg: string; bg: string; border: string; solid: string }> = {
  success: { fg: colors.success, bg: colors.successBg, border: colors.successBorder, solid: colors.successSolid },
  warning: { fg: colors.warning, bg: colors.warningBg, border: colors.warningBorder, solid: colors.warningSolid },
  error: { fg: colors.error, bg: colors.errorBg, border: colors.errorBorder, solid: colors.errorSolid },
  info: { fg: colors.info, bg: colors.infoBg, border: colors.infoBorder, solid: colors.infoSolid },
  neutral: { fg: colors.textSecondary, bg: colors.neutralBg, border: colors.neutralBorder, solid: colors.subtle },
};

/** Default icon for each tone (status is never conveyed by colour alone). Material outline set. */
export const toneIcons = {
  success: 'check-circle-outline',
  warning: 'warning-amber',
  error: 'error-outline',
  info: 'info-outline',
  neutral: 'label-outline',
} as const;

/** Urgency accent (deadline < 24h, low time in a test). Always pair with words, never colour alone. */
export const urgentColors = { fg: coral.text, bg: coral[50], border: colors.errorBorder, fill: coral[500], fillStrong: coral[600] } as const;

/** Monospace family for CodeBlock (system monospace; no font download). */
export const monoFamily = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

/** Muted tint pairs for company/person initials tiles (fg on bg >= 6:1). */
export const logoTints: { bg: string; fg: string }[] = [
  { bg: '#EEF2FF', fg: '#3730A3' },
  { bg: '#F1F5F9', fg: '#334155' },
  { bg: '#EFF6FF', fg: '#1E40AF' },
  { bg: '#F0FDF4', fg: '#166534' },
  { bg: '#FFFBEB', fg: '#92400E' },
  { bg: '#FDF2F8', fg: '#9D174D' },
];

export const theme = { colors, palette, spacing, radius, typography, shadow, chartColors, MIN_TOUCH, indigo, teal, slate };
