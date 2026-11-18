import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { useAppContent, type MoreApp } from '@/lib/content-sync';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, radius, type } from '@/theme';

/** Other 4AM Global Media apps, as listed in the admin (Module 9.4). Each opens in this phone's own store when it's there. */
export default function MoreAppsScreen() {
  const { moreApps } = useAppContent();
  const { showToast } = useAppUI();

  const open = async (app: MoreApp) => {
    const link = (Platform.OS === 'ios' ? app.appStore || app.playStore : app.playStore || app.appStore) || '';
    try {
      await Linking.openURL(link);
    } catch {
      showToast('Couldn’t open the store. Check your connection and try again.');
    }
  };

  return (
    <Screen title="More Apps" back={{ fallback: '/', label: 'Back' }} grouped>
      {moreApps.length === 0 ? (
        <EmptyState icon="apps-outline" title="More Apps Coming Soon" message="4AM Global Media is working on more apps. They’ll appear here when they’re ready." />
      ) : (
        <InsetGroup separatorInset={76}>
          {moreApps.map((app) => (
            <Pressable
              key={app.name}
              onPress={() => open(app)}
              accessibilityRole="link"
              accessibilityLabel={[app.name, app.description].filter(Boolean).join('. ')}
              accessibilityHint="Opens in the app store"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.icon}>
                {app.icon ? <Image cachePolicy="memory-disk" source={app.icon} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="apps-outline" size={24} color={colors.secondaryLabel} />}
              </View>
              <View style={styles.copy}>
                <Text style={type.body}>{app.name}</Text>
                {app.description ? <Text style={styles.detail}>{app.description}</Text> : null}
              </View>
              <Ionicons name="open-outline" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ))}
        </InsetGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingLeft: 16, paddingRight: 14 },
  rowPressed: { backgroundColor: colors.fill },
  icon: { width: 46, height: 46, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedBackground, borderRadius: radius.md },
  copy: { flex: 1 },
  detail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
});
