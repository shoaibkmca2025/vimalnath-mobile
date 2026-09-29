import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOverlayTransition } from '@/hooks/useOverlayTransition';
import { colors, fonts, type } from '@/theme';

type Props = {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (siteName: string) => void;
  /** Wording for reuse outside the bar optimizer (defaults are the bar cutting plan's). */
  eyebrow?: string;
  body?: string;
  placeholder?: string;
  fieldLabel?: string;
};

export function ExportSiteNameSheet({
  visible,
  busy,
  onClose,
  onSubmit,
  eyebrow = 'EXPORT REPORT',
  body = 'Enter the site name to print on the bar cutting plan.',
  placeholder = 'e.g. Sundaram Residence, Block A',
  fieldLabel = 'Site name for the PDF report',
}: Props) {
  const { mounted, progress } = useOverlayTransition(visible);
  const insets = useSafeAreaInsets();
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    if (visible) setSiteName('');
  }, [visible]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop, opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel="Close export sheet" />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
          },
        ]}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            <Text style={type.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>Create PDF</Text>
          </View>
          <Pressable onPress={busy ? undefined : onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Feather name="x" size={20} color={colors.ink} />
          </Pressable>
        </View>

        <Text style={styles.body}>{body}</Text>

        <View style={styles.field}>
          <TextInput
            value={siteName}
            onChangeText={setSiteName}
            placeholder={placeholder}
            placeholderTextColor={colors.subtle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => !busy && onSubmit(siteName.trim())}
            accessibilityLabel={fieldLabel}
            style={styles.input}
          />
        </View>

        <Pressable
          onPress={() => onSubmit(siteName.trim())}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Generate PDF"
          style={({ pressed }) => [styles.submit, pressed && !busy && styles.submitPressed, busy && styles.submitDisabled]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Feather name="file-text" size={17} color={colors.white} />
              <Text style={styles.submitText}>Generate PDF</Text>
            </>
          )}
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, marginTop: -8, marginBottom: 10, borderRadius: 3, backgroundColor: '#d3def7' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft, borderRadius: 19 },
  body: { marginBottom: 14, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  field: { marginBottom: 18 },
  input: {
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
  submit: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.blue,
    borderRadius: 15,
  },
  submitPressed: { backgroundColor: colors.blueDark },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
