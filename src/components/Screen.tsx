import type { ReactNode, Ref } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { colors, space } from '@/theme';

type ScreenProps = {
  children: ReactNode;
  scrollRef?: Ref<ScrollView>;
};

export function Screen({ children, scrollRef }: ScreenProps) {
  return (
    <View style={styles.root}>
      <AppHeader />
      {/* Android is edge-to-edge, so the window no longer resizes for the keyboard; iOS uses scroll insets instead. */}
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  content: { paddingHorizontal: space.gutter, paddingTop: 24, paddingBottom: 36 },
});
