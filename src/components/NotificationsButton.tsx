import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnreadNotifications } from '@/lib/admin-sync';
import { colors } from '@/theme';

/** Navigation bar bell that opens Notifications, with the unread count as a red badge, as iOS marks unread. */
export function NotificationsButton() {
  const unread = useUnreadNotifications();
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} new` : 'Notifications'}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={25} color={colors.tint} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  badge: {
    position: 'absolute',
    top: 3,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
    borderRadius: 9,
  },
  badgeText: { color: colors.white, fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
