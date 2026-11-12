/**
 * Placement OS design tokens.  See app/DESIGN.md for usage.
 * All text/background pairs below were checked against WCAG 2.1 AA (>= 4.5:1 for text, >= 3:1 for UI borders/icons).
 * Legacy keys (primary, muted, error, ...) are kept so existing screens keep compiling; they now point at the new palette.
 */
import { Platform, type TextStyle } from 'react-native';

/* ---------------- Palette ---------------- */
export const teal = {
  900: '#0A3F3A',
  800: '#0D4F4A',
  700: '#126B63', // brand
  600: '#1A8279',
  100: '#D5EBE8',
  50: '#EDF6F5',
} as const;

export const slate = {
  50: '#F8FAFB',
  100: '#F1F4F6',
  200: '#E4E9EC', // hairline
  300: '#CBD3DA',
  400: '#8795A3', // input border (3.06:1 on white) and disabled icons
  500: '#5B6B7B', // secondary icons
  600: '#4F5E6E', // muted text (6.1:1 on canvas)
  700: '#334155',
  800: '#1E2B3A',
  900: '#0F1F2D',
} as const;

/** Coral is for fills, dots, bars and urgency accents. NEVER use #F26B4F as text on white (3.0:1) or white text on it (3.0:1).
 *  Use `coralText` for coral-looking text on white/tint (5.7:1) and `ink` text on a coral fill (5.6:1). */
export const coral = {
  500: '#F26B4F',
  600: '#D9532F', // pressed fill
  50: '#FDEBE6', // tint background
  text: '#B83A1E', // text/icon on white (5.73:1) and on coral-50 (4.97:1)
} as const;

export const amber = {
  500: '#F5B544',
  50: '#FFF3D6',
  text: '#7A4A00', // 6.78:1 on amber-50, 7.48:1 on white
} as const;

export const colors = {
  /* brand */
  primary: teal[700],
  primaryDark: teal[800],
  primaryDeep: teal[900],
  primarySoft: teal[600],
  primaryTint: teal[50],
  primaryTint2: teal[100],
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
  disabled: slate[400],
  canvas: '#F4F6F7',
  surface: '#FFFFFF',
  surfaceAlt: slate[50],
  pressed: slate[100],
  border: slate[200], // hairline for cards / dividers
  borderStrong: slate[400], // form control outline
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#B7D9D5', // secondary text on teal-800/900 (6.2:1 / 7.8:1)
  /* status: strong (text+icon) colours, each with a tinted background below */
  success: '#0B6B45',
  warning: '#8A5300',
  error: '#B42318',
  info: '#17508C',
  successBg: '#E6F4EC',
  warningBg: '#FFF3D6',
  errorBg: '#FDECEA',
  infoBg: '#E6F0FA',
  neutralBg: '#EDF0F2',
  /* status: soft borders to pair with tinted backgrounds */
  successBorder: '#BFE3CF',
  warningBorder: '#F2D899',
  errorBorder: '#F5C2BD',
  infoBorder: '#BCD5EE',
  neutralBorder: '#D5DBE0',
  overlay: 'rgba(15,31,45,0.5)',
} as const;

/* ---------------- Spacing / radius / touch ---------------- */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { card: 14, button: 12, input: 12, field: 12, chip: 8, logo: 12, sheet: 20, bar: 4 } as const;
export const MIN_TOUCH = 48;
export const CONTROL_HEIGHT = 52; // buttons and text fields
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

export const typography: Record<TextVariant, TypeStyle> = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  subhead: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8, uppercase: true },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  section: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
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
/** One shadow level, for cards only. Everything else is flat with a 1px hairline. */
export const shadow = {
  card: {
    shadowColor: '#0F1F2D',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
} as const;

/* ---------------- Status tones ---------------- */
export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
/** fg = strong text/icon colour, bg = tinted background, border = soft outline. fg-on-bg contrast: 5.1 - 7.5 (all >= 4.5). */
export const toneColors: Record<Tone, { fg: string; bg: string; border: string }> = {
  success: { fg: colors.success, bg: colors.successBg, border: colors.successBorder },
  warning: { fg: colors.warning, bg: colors.warningBg, border: colors.warningBorder },
  error: { fg: colors.error, bg: colors.errorBg, border: colors.errorBorder },
  info: { fg: colors.info, bg: colors.infoBg, border: colors.infoBorder },
  neutral: { fg: colors.muted, bg: colors.neutralBg, border: colors.neutralBorder },
};

/** Default icon for each tone (status is never conveyed by colour alone). Ionic-free: Material outline set. */
export const toneIcons = {
  success: 'check-circle-outline',
  warning: 'warning-amber',
  error: 'error-outline',
  info: 'info-outline',
  neutral: 'label-outline',
} as const;

/** Urgency accent (deadline < 24h, low time in a test). Coral tint bg + coralText fg = 4.97:1. Always pair with words, never colour alone. */
export const urgentColors = { fg: coral.text, bg: coral[50], border: '#F6C7BB', fill: coral[500], fillStrong: coral[600] } as const;

/** Monospace family for CodeBlock (system monospace; no font download). */
export const monoFamily = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

/** Muted tint pairs for company/person initials tiles (fg on bg >= 6:1). */
export const logoTints: { bg: string; fg: string }[] = [
  { bg: '#E3F1EF', fg: '#0D4F4A' },
  { bg: '#FDE9E4', fg: '#9A3A27' },
  { bg: '#FCF1D9', fg: '#7A5410' },
  { bg: '#E4EEF8', fg: '#1D4E80' },
  { bg: '#EAE6F5', fg: '#4A3C86' },
  { bg: '#E2EEF3', fg: '#27566B' },
];

export const theme = { colors, spacing, radius, typography, shadow, MIN_TOUCH, teal, slate };
