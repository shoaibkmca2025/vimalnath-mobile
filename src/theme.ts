import { StyleSheet } from 'react-native';

export const colors = {
  ink: '#101827',
  muted: '#6c7482',
  subtle: '#9aa1ac',
  line: '#e8ebef',
  soft: '#f5f7f9',
  white: '#ffffff',
  blue: '#2458e8',
  blueDark: '#163ca8',
  blueTint: '#edf2ff',
  blueWash: '#f5f8ff',
  orange: '#ee8349',
  green: '#23a779',
  greenTint: '#e9f8f2',
  navy: '#111c31',
  navyRaised: '#263554',
  backdrop: 'rgba(12, 19, 32, 0.42)',
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
