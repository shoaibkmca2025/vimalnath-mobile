import Ionicons from '@expo/vector-icons/Ionicons';
import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { savePdfFile, sharePdfFile } from '@/lib/pdf-export';
import { buildPdfViewerHtml } from '@/lib/pdf-viewer-html';
import { ensurePdfFile, getSavedPdf, type SavedPdf } from '@/lib/saved-pdfs';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors } from '@/theme';

/** Opens a saved PDF inside the app, with Share and Save in the bar. */
export default function PdfViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { showToast } = useAppUI();
  const [pdf, setPdf] = useState<SavedPdf | null | undefined>(undefined);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await getSavedPdf(id ?? '');
      if (cancelled) return;
      setPdf(found ?? null);
      if (!found) return;
      try {
        const uri = await ensurePdfFile(found);
        const base64 = await new File(uri).base64();
        const page = await buildPdfViewerHtml(base64);
        if (cancelled) return;
        setFileUri(uri);
        setHtml(page);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const run = async (action: 'share' | 'save') => {
    if (!pdf || !fileUri) return;
    setBusy(action);
    try {
      if (action === 'share') await sharePdfFile(fileUri, pdf.fileName, 'Share PDF');
      else {
        const outcome = await savePdfFile(fileUri, pdf.fileName);
        if (outcome.saved) showToast(`Saved ${pdf.fileName} to ${outcome.location}.`);
      }
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t ${action} the PDF: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  const actions = (
    <>
      <BarIcon icon="share-outline" label="Share PDF" busy={busy === 'share'} disabled={!fileUri || busy !== null} onPress={() => run('share')} />
      <BarIcon icon="download-outline" label="Save PDF to this phone" busy={busy === 'save'} disabled={!fileUri || busy !== null} onPress={() => run('save')} />
    </>
  );

  return (
    <Screen title={pdf?.title ?? 'PDF'} titleDisplay="inline" back={{ fallback: '/saved-pdfs', label: 'Back' }} trailing={actions} fill>
      {pdf === null ? (
        <EmptyState icon="document-text-outline" title="PDF Not Found" message="This PDF was deleted from Saved PDFs." />
      ) : failed ? (
        <EmptyState icon="alert-circle-outline" title="Couldn’t Open PDF" message="The PDF file couldn’t be read. Try sharing it to another app instead." />
      ) : html ? (
        <WebView
          source={{ html, baseUrl: 'https://localhost/' }}
          originWhitelist={['*']}
          style={styles.web}
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data) as { error?: string };
              if (message.error) setFailed(true);
            } catch {
              // Not one of ours.
            }
          }}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.tint} />
        </View>
      )}
    </Screen>
  );
}

function BarIcon({ icon, label, busy, disabled, onPress }: { icon: 'share-outline' | 'download-outline'; label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.barIcon, pressed && { opacity: 0.5 }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.tint} /> : <Ionicons name={icon} size={24} color={disabled ? colors.tertiaryLabel : colors.tint} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#e9edf5' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  barIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
