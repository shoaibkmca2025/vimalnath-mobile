import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { formatInchSize } from '@/lib/format';
import { computeGlassPlan, parsePanelCount, type GlassPlanResult } from '@/lib/glass-calculator';
import { buildGlassPlanHtml } from '@/lib/glass-plan-pdf';
import { pdfFileName, savePdf, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, radius, type } from '@/theme';

const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');

export default function GlassCalculatorScreen() {
  const { showToast } = useAppUI();
  const { name, backLabel, fallbackRoute } = useLocalSearchParams<{ name?: string; backLabel?: string; fallbackRoute?: string }>();
  const systemName = name ?? 'Sliding System';
  const panelCount = parsePanelCount(systemName);

  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [result, setResult] = useState<GlassPlanResult | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  const ready = Number(width) > 0 && Number(height) > 0;

  const calculate = () => {
    const outcome = computeGlassPlan(systemName, Number(width), Number(height), panelCount);
    if ('error' in outcome) {
      setSizeError(outcome.error);
      setResult(null);
      return;
    }
    setSizeError(null);
    setResult(outcome.result);
  };

  const exportPdf = async (mode: 'share' | 'save') => {
    if (!result) return;
    setBusy(mode);
    try {
      const html = buildGlassPlanHtml({ systemName, result });
      const fileName = pdfFileName(`${systemName} ${result.openingWidth}x${result.openingHeight}`);
      if (mode === 'share') {
        await sharePdf(html, fileName, 'Share glass cutting plan');
      } else {
        const outcome = await savePdf(html, fileName);
        if (outcome.saved) showToast(`Saved ${fileName} to ${outcome.location}.`);
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t create the PDF: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      title={systemName}
      subtitle="Glass cutting and material calculator"
      back={{ fallback: (fallbackRoute ?? '/cutlist') as Href, label: backLabel ?? 'Cutlist' }}
      grouped
    >
      <InsetGroup header="Opening size" style={sizeError ? styles.groupWithError : undefined}>
        <DimensionRow
          label="Width"
          value={width}
          onChangeText={(text) => {
            setWidth(digitsOnly(text));
            setSizeError(null);
          }}
          accessibilityLabel="Opening width in millimetres"
        />
        <DimensionRow
          label="Height"
          value={height}
          onChangeText={(text) => {
            setHeight(digitsOnly(text));
            setSizeError(null);
          }}
          accessibilityLabel="Opening height in millimetres"
        />
      </InsetGroup>

      {sizeError && (
        <View style={styles.error} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Text style={styles.errorText}>{sizeError}</Text>
        </View>
      )}

      <Button label="Calculate" onPress={calculate} disabled={!ready} accessibilityHint={ready ? undefined : 'Enter the width and height first'} />

      {result && (
        <View style={styles.results}>
          <SizeCard
            title="Cutting size"
            value={`${result.cuttingWidth} × ${result.cuttingHeight} mm`}
            inches={formatInchSize(result.cuttingWidth, result.cuttingHeight)}
            detail="Per panel"
            background={colors.redFill}
          />
          <SizeCard
            title="Glass size"
            value={`${result.glassWidth} × ${result.glassHeight} mm`}
            inches={formatInchSize(result.glassWidth, result.glassHeight)}
            detail={`Qty: ${result.glassQuantity}`}
            background={colors.tintFill}
          />

          <InsetGroup header="Material list" style={styles.materials}>
            {result.materials.map((item) => (
              <ValueRow key={item.label} label={item.label} value={item.value} detail={item.note} />
            ))}
          </InsetGroup>

          <View style={styles.exportRow}>
            <Button
              label="Share PDF"
              icon="share-outline"
              accessibilityHint="Send the cutting plan by WhatsApp, email and more"
              loading={busy === 'share'}
              disabled={busy !== null && busy !== 'share'}
              onPress={() => exportPdf('share')}
              style={styles.exportButton}
            />
            <Button
              label="Save PDF"
              icon="download-outline"
              variant="gray"
              accessibilityHint="Save the cutting plan to this phone"
              loading={busy === 'save'}
              disabled={busy !== null && busy !== 'save'}
              onPress={() => exportPdf('save')}
              style={styles.exportButton}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

/** Headline result on a tinted background; the title, not the color, says what the size is. */
function SizeCard({ title, value, inches, detail, background }: { title: string; value: string; inches: string; detail: string; background: string }) {
  return (
    <View style={[styles.sizeCard, { backgroundColor: background }]} accessible accessibilityLabel={`${title}, ${value}, ${inches.replace(/″/g, ' inches')}, ${detail}`}>
      <Text style={styles.sizeTitle}>{title}</Text>
      <Text style={styles.sizeValue}>{value}</Text>
      <Text style={styles.sizeInches}>{inches}</Text>
      <Text style={type.subheadline}>{detail}</Text>
    </View>
  );
}

type DimensionRowProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
};

/** Form row with the label on the leading edge and the value entered on the trailing edge. */
function DimensionRow({ label, value, onChangeText, accessibilityLabel }: DimensionRowProps) {
  return (
    <View style={styles.fieldRow}>
      <Text style={type.body}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="e.g. 1200"
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.tint}
        keyboardType="number-pad"
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
        style={styles.fieldInput}
      />
      <Text style={styles.unit}>mm</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  groupWithError: { marginBottom: 8 },
  fieldRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  fieldInput: { ...type.body, flex: 1, minHeight: 46, padding: 0, textAlign: 'right' },
  unit: { ...type.body, color: colors.secondaryLabel },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginHorizontal: 16, marginBottom: 22 },
  errorText: { ...type.footnote, flex: 1, color: colors.red },
  results: { marginTop: 32 },
  sizeCard: { marginBottom: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.md },
  sizeTitle: { ...type.subheadline, fontWeight: '600' },
  sizeValue: { ...type.title2, marginTop: 2, fontVariant: ['tabular-nums'] },
  sizeInches: { ...type.headline, marginBottom: 2, color: colors.secondaryLabel, fontVariant: ['tabular-nums'] },
  materials: { marginTop: 16 },
  exportRow: { flexDirection: 'row', gap: 12 },
  exportButton: { flex: 1 },
});
