import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CartButton } from '@/components/CartButton';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { confirmDestructive } from '@/lib/confirm';
import { sharePdf, sharePdfFile } from '@/lib/pdf-export';
import { deleteSavedPdf, ensurePdfFile, listSavedPdfs, type SavedPdf, type SavedPdfSource } from '@/lib/saved-pdfs';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

type Filter = 'all' | SavedPdfSource;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cutlist', label: 'Cutlist' },
  { value: 'optimizer', label: 'Optimizer' },
];

const SOURCE_ICON = { cutlist: 'cut', optimizer: 'calculator' } as const;
const SOURCE_NAME = { cutlist: 'Cutlist', optimizer: 'Optimizer' };

/** "18 Nov 2026, 3:42 pm" */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Every PDF made in the Cutlist calculator and the Bar Optimizer, newest first, to share, save or delete. */
export default function SavedPdfsScreen() {
  const { showToast } = useAppUI();
  const [pdfs, setPdfs] = useState<SavedPdf[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reloaded whenever the screen is shown, so a PDF made a moment ago is already listed.
  useFocusEffect(
    useCallback(() => {
      listSavedPdfs().then(setPdfs);
    }, []),
  );

  const shown = (pdfs ?? []).filter((pdf) => filter === 'all' || pdf.source === filter);

  // On the phone a PDF opens in the app's viewer; the web has no stored files, so it prints instead.
  const open = (pdf: SavedPdf) => {
    if (Platform.OS === 'web') share(pdf);
    else router.push({ pathname: '/pdf/[id]', params: { id: pdf.id } });
  };

  const share = async (pdf: SavedPdf) => {
    setBusyId(pdf.id);
    try {
      if (Platform.OS === 'web') await sharePdf(pdf.html, pdf.fileName, 'Share PDF');
      else await sharePdfFile(await ensurePdfFile(pdf), pdf.fileName, 'Share PDF');
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t share the PDF: ${reason}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (pdf: SavedPdf) =>
    confirmDestructive('Delete this PDF?', `${pdf.title} will be removed from Saved PDFs.`, 'Delete', async () => {
      setPdfs(await deleteSavedPdf(pdf.id));
      showToast('PDF deleted.');
    });

  return (
    <Screen title="Saved PDFs" subtitle="From the Cutlist and the Optimizer" back={{ fallback: '/', label: 'Back' }} trailing={<CartButton />} grouped>
      <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} accessibilityLabel="Show PDFs from" style={styles.filter} />

      {pdfs === null ? (
        <ActivityIndicator color={colors.tint} style={styles.loading} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No PDFs Yet"
          message={
            filter === 'optimizer'
              ? 'PDFs you export from the Bar Optimizer will appear here.'
              : filter === 'cutlist'
                ? 'PDFs you share or save from the Cutlist calculator will appear here.'
                : 'PDFs you share or save from the Cutlist calculator and the Bar Optimizer will appear here.'
          }
        />
      ) : (
        <InsetGroup header={`${shown.length} PDF${shown.length === 1 ? '' : 's'}`} footer="Tap a PDF to open it." separatorInset={64}>
          {shown.map((pdf) => (
            <View key={pdf.id} style={styles.row}>
              <Pressable
                onPress={() => open(pdf)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`${pdf.title}, ${pdf.detail}, ${SOURCE_NAME[pdf.source]}, ${formatWhen(pdf.createdAt)}`}
                accessibilityHint="Opens the PDF"
                style={({ pressed }) => [styles.main, pressed && styles.pressed]}
              >
                <View style={styles.icon}>
                  {busyId === pdf.id ? <ActivityIndicator size="small" color={colors.tint} /> : <Ionicons name={SOURCE_ICON[pdf.source]} size={20} color={colors.tint} />}
                </View>
                <View style={styles.copy}>
                  <Text style={type.body}>{pdf.title}</Text>
                  <Text style={styles.detail}>{pdf.detail}</Text>
                  <Text style={styles.detail}>
                    {SOURCE_NAME[pdf.source]} · {formatWhen(pdf.createdAt)}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => share(pdf)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Share ${pdf.title}`}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Ionicons name="share-outline" size={22} color={colors.tint} />
              </Pressable>
              <Pressable
                onPress={() => remove(pdf)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${pdf.title}`}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Ionicons name="trash-outline" size={21} color={colors.red} />
              </Pressable>
            </View>
          ))}
        </InsetGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filter: { marginBottom: 20 },
  loading: { marginTop: 40 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 16 },
  pressed: { opacity: 0.5 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tintFill, borderRadius: 10 },
  copy: { flex: 1 },
  detail: { ...type.footnote, marginTop: 1, color: colors.secondaryLabel },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
