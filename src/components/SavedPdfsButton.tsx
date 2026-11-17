import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from '@/theme';

/** Navigation bar button, left of the cart, that opens the PDFs made in the Cutlist and the Optimizer. */
export function SavedPdfsButton() {
  return (
    <Pressable
      onPress={() => router.push('/saved-pdfs')}
      accessibilityRole="button"
      accessibilityLabel="Saved PDFs"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="document-text-outline" size={25} color={colors.tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
});
