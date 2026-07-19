import { StyleSheet, type TextStyle } from 'react-native';

/**
 * Design tokens — "ink & paper".
 * Warm neutrals, a single sienna accent, Geist for everything — weight and
 * size carry the hierarchy. Both palettes share the same shape.
 */

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  ink2: string;
  ink3: string;
  hairline: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  danger: string;
  pending: string;
}

export const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    bg: '#FBFAF7',
    surface: '#FFFFFF',
    surfaceAlt: '#F3F0EA',
    ink: '#1A1815',
    ink2: '#6E675F',
    ink3: '#ABA49A',
    hairline: 'rgba(26, 24, 21, 0.08)',
    accent: '#9C5227',
    accentSoft: '#F4E8DD',
    onAccent: '#FDFBF8',
    success: '#4C7A5C',
    danger: '#B3574D',
    pending: '#B08948',
  },
  dark: {
    bg: '#141210',
    surface: '#1D1B18',
    surfaceAlt: '#26221E',
    ink: '#F1EDE6',
    ink2: '#9E978C',
    ink3: '#6B655C',
    hairline: 'rgba(241, 237, 230, 0.08)',
    accent: '#E29A63',
    accentSoft: '#2B2119',
    onAccent: '#1A120B',
    success: '#7FB08F',
    danger: '#D98A80',
    pending: '#C9A265',
  },
};

export const fonts = {
  sans: 'Geist_400Regular',
  sansItalic: 'Geist_400Regular_Italic',
  sansMedium: 'Geist_500Medium',
  sansSemibold: 'Geist_600SemiBold',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 28,
  pill: 999,
} as const;

export const hairlineWidth = StyleSheet.hairlineWidth;

export const typeScale: Record<string, TextStyle> = {
  display: {
    fontFamily: fonts.sansSemibold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: -0.3,
  },
  /** Larger reading size for the user's own words (memories, questions). */
  serifBody: { fontFamily: fonts.sans, fontSize: 18, lineHeight: 27 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 25 },
  sub: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  captionMedium: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  micro: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
};

export type TypeVariant =
  | 'display'
  | 'title'
  | 'serifBody'
  | 'body'
  | 'sub'
  | 'caption'
  | 'captionMedium'
  | 'micro';
