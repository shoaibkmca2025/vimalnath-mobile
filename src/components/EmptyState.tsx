import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button, type IconName } from '@/components/Button';
import { colors, type } from '@/theme';

type Props = {
  icon: IconName;
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
};

/** Explains why a screen is empty and offers the next step, like iOS's content-unavailable view. */
export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <View style={styles.root}>
      <Ionicons name={icon} size={52} color={colors.tertiaryLabel} />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {action && <Button label={action.label} onPress={action.onPress} variant="tinted" size="medium" style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  title: { ...type.title3, marginTop: 14, textAlign: 'center' },
  message: { ...type.subheadline, marginTop: 6, color: colors.secondaryLabel, textAlign: 'center' },
  action: { marginTop: 20 },
});
