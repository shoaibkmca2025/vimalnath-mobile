import { StyleSheet } from 'react-native';

/**
 * Semantic colors modeled on the iOS light palette (labels, fills, grouped backgrounds), with the
 * Vimalnath brand blue as the app's one tint color. Tint is reserved for things people can tap or have
 * selected; non-interactive text uses the label colors. Red is kept for errors and destructive actions.
 */
export const colors = {
  tint: '#2458e8',
  tintPressed: '#1b45bf',
  /** Background of tinted buttons and selected rows. */
  tintFill: 'rgba(36, 88, 232, 0.12)',

  // Text. secondaryLabel keeps at least 4.5:1 contrast on both white and the grouped background.
  label: '#000000',
  secondaryLabel: '#6c6c70',
  /** Placeholders and decorative glyphs only — too light for text people need to read. */
  tertiaryLabel: '#8e8e93',

  background: '#ffffff',
  groupedBackground: '#f2f2f7',
  /** Rows and cards that sit on the grouped background. */
  card: '#ffffff',

  separator: 'rgba(60, 60, 67, 0.29)',
  fill: 'rgba(120, 120, 128, 0.2)',
  secondaryFill: 'rgba(120, 120, 128, 0.16)',
  tertiaryFill: 'rgba(118, 118, 128, 0.12)',
  quaternaryFill: 'rgba(116, 116, 128, 0.08)',

  red: '#d70015',
  redFill: 'rgba(215, 0, 21, 0.1)',
  green: '#248a3d',
  white: '#ffffff',
  backdrop: 'rgba(0, 0, 0, 0.4)',
  hud: 'rgba(28, 28, 30, 0.94)',
};

/** The brand wordmark keeps its typeface; all interface text uses the system font (SF Pro on iOS). */
export const fonts = {
  brand: 'SpaceGrotesk_700Bold',
};

/**
 * iOS Dynamic Type text styles at the default (Large) size. Headings use the emphasized weights.
 * The system font applies its own tracking, so no letterSpacing is set here.
 */
export const type = StyleSheet.create({
  largeTitle: { color: colors.label, fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title1: { color: colors.label, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { color: colors.label, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title3: { color: colors.label, fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { color: colors.label, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { color: colors.label, fontSize: 17, lineHeight: 22 },
  callout: { color: colors.label, fontSize: 16, lineHeight: 21 },
  subheadline: { color: colors.label, fontSize: 15, lineHeight: 20 },
  footnote: { color: colors.label, fontSize: 13, lineHeight: 18 },
  caption1: { color: colors.label, fontSize: 12, lineHeight: 16 },
  caption2: { color: colors.label, fontSize: 11, lineHeight: 13 },
});

export const space = {
  /** iPhone layout margin. */
  gutter: 16,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  sheet: 24,
};
