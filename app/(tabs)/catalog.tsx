import Feather from '@expo/vector-icons/Feather';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, Text, View } from 'react-native';

import { CatalogueCard } from '@/components/CatalogueCard';
import { Screen } from '@/components/Screen';
import { Pill, ScreenTitle } from '@/components/ScreenTitle';
import { catalogues, type Catalogue } from '@/data/catalogues';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts } from '@/theme';

export default function CatalogScreen() {
  const { showToast } = useAppUI();

  const open = async (catalogue: Catalogue) => {
    if (!catalogue.url) {
      showToast(`${catalogue.title} catalogue is coming soon.`);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(catalogue.url, { controlsColor: colors.blue, toolbarColor: colors.white });
    } catch {
      showToast('Couldn’t open the catalogue. Check your connection and try again.');
    }
  };

  return (
    <Screen>
      <ScreenTitle eyebrow="COMPANY LIBRARY" title="Catalog" accessory={<Pill>{`${catalogues.length} catalogues`}</Pill>} />

      <View style={styles.note}>
        <View style={styles.noteIcon}>
          <Feather name="book-open" size={18} color={colors.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.noteTitle}>Taiton product catalogues</Text>
          <Text style={styles.noteBody}>Tap a catalogue to browse the full PDF.</Text>
        </View>
      </View>

      <View style={styles.list}>
        {catalogues.map((catalogue) => (
          <CatalogueCard key={catalogue.number} catalogue={catalogue} onPress={() => open(catalogue)} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
    padding: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cfd7e5',
    borderRadius: 16,
  },
  noteIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7edff', borderRadius: 11 },
  noteTitle: { marginBottom: 2, color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  noteBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  list: { gap: 12 },
});
