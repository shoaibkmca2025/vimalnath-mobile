import { StyleSheet } from 'react-native';

// Blue & white brand theme: every accent is a shade of blue. Red is kept only for error messages.
export const colors = {
  ink: '#0b1f4d',
  muted: '#5a6b8c',
  subtle: '#93a1bd',
  line: '#e1e8f7',
  soft: '#f3f6fd',
  white: '#ffffff',
  blue: '#2458e8',
  blueDark: '#163ca8',
  blueTint: '#edf2ff',
  blueWash: '#f5f8ff',
  // Highlight accent (notification dot, badges) — a light blue that shows on both white and dark blue.
  orange: '#7fa6ff',
  // Secondary accents, kept as separate tokens so each can still be tuned on its own.
  green: '#0f3fb8',
  greenTint: '#e6eeff',
  purple: '#3867f0',
  purpleTint: '#eef3ff',
  red: '#d9382f',
  redTint: '#fdecec',
  navy: '#0f2f86',
  navyRaised: '#2046b3',
  backdrop: 'rgba(11, 31, 77, 0.42)',
};

// Keys must match the names registered with useFonts in app/_layout.tsx.
export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  display: 'SpaceGrotesk_700Bold',
};

export const type = StyleSheet.create({
  eyebrow: {
    marginBottom: 6,
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1.6,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.8,
  },
  label: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  body: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
});

export const space = {
  gutter: 20,
};
