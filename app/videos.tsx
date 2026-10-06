import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { installationVideoSections, type InstallationVideo } from '@/data/videos';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

const YOUTUBE_RED = '#ff0000';

export default function InstallationVideosScreen() {
  const { showToast } = useAppUI();

  // Linking hands YouTube links to the YouTube app when it's installed, otherwise to the browser.
  const open = async (video: InstallationVideo) => {
    try {
      await Linking.openURL(video.url);
    } catch {
      showToast('Couldn’t open YouTube. Check your connection and try again.');
    }
  };

  return (
    <Screen title="Installation Videos" subtitle="Step-by-step videos on YouTube" back={{ fallback: '/', label: 'Back' }} grouped>
      {installationVideoSections.map((section) => (
        <InsetGroup key={section.title} header={section.title} separatorInset={66}>
          {section.videos.map((video) => (
            <Pressable
              key={video.title}
              onPress={() => open(video)}
              accessibilityRole="link"
              accessibilityLabel={`${video.title}. ${video.detail}`}
              accessibilityHint="Opens in YouTube"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.play}>
                <Ionicons name="logo-youtube" size={24} color={YOUTUBE_RED} />
              </View>
              <View style={styles.copy}>
                <Text style={type.body}>{video.title}</Text>
                <Text style={styles.detail}>{video.detail}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ))}
        </InsetGroup>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingLeft: 16, paddingRight: 14 },
  rowPressed: { backgroundColor: colors.fill },
  play: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 0, 0, 0.08)', borderRadius: 10 },
  copy: { flex: 1 },
  detail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
});
