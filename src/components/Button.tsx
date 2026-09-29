import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  label: string;
  onPress: () => void;
  /** filled = the one most likely action in a view; tinted/gray = secondary; plain = text only. */
  variant?: 'filled' | 'tinted' | 'gray' | 'plain';
  destructive?: boolean;
  size?: 'large' | 'medium' | 'small';
  icon?: IconName;
  loading?: boolean;
  /** Shown next to the spinner while loading, e.g. “Creating PDF…”. */
  loadingLabel?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const sizes = {
  large: { height: 50, fontSize: 17, icon: 20, paddingHorizontal: 20 },
  medium: { height: 44, fontSize: 15, icon: 18, paddingHorizontal: 18 },
  small: { height: 32, fontSize: 13, icon: 15, paddingHorizontal: 12 },
};

/** Capsule button with iOS-style prominence levels. Every size keeps at least a 44 pt hit region. */
export function Button({
  label,
  onPress,
  variant = 'filled',
  destructive = false,
  size = 'large',
  icon,
  loading = false,
  loadingLabel,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: Props) {
  const metrics = sizes[size];
  const inactive = disabled || loading;
  const accent = destructive ? colors.red : colors.tint;

  let background = 'transparent';
  let foreground = accent;
  if (variant === 'filled') {
    background = disabled ? colors.fill : accent;
    foreground = disabled ? colors.tertiaryLabel : colors.white;
  } else if (variant === 'tinted') {
    background = destructive ? colors.redFill : colors.tintFill;
  } else if (variant === 'gray') {
    background = colors.tertiaryFill;
  }
  if (disabled && variant !== 'filled') foreground = colors.tertiaryLabel;

  const hitSlop = metrics.height < 44 ? { top: (44 - metrics.height) / 2, bottom: (44 - metrics.height) / 2 } : undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { height: metrics.height, borderRadius: metrics.height / 2, paddingHorizontal: metrics.paddingHorizontal, backgroundColor: background },
        pressed && (variant === 'filled' && !destructive ? { backgroundColor: colors.tintPressed } : styles.pressed),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        icon && <Ionicons name={icon} size={metrics.icon} color={foreground} />
      )}
      <Text style={[styles.label, { color: foreground, fontSize: metrics.fontSize }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
        {loading && loadingLabel ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  pressed: { opacity: 0.6 },
  label: { fontWeight: '600' },
});
