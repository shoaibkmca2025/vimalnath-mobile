import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts } from '@/theme';

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.blueDark, transform: [{ scale: 0.99 }] }]}
    >
      <Text style={styles.label}>{label}</Text>
      <Feather name="arrow-right" size={19} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.blue,
    borderRadius: 15,
    boxShadow: '0 8px 18px rgba(36, 88, 232, 0.24)',
  },
  label: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
