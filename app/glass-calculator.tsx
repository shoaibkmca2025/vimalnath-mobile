import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { FractionButton, FractionSheet } from '@/components/FractionPicker';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { formatInches, formatInchSize, formatMm, inchesToMm, mmToInchParts } from '@/lib/format';
import { computeGlassPlan, getSystemRange, parsePanelCount, type GlassPlanResult } from '@/lib/glass-calculator';
import { buildGlassPlanHtml } from '@/lib/glass-plan-pdf';
import { SIZE_UNIT_KEY, UNIT_OPTIONS, type LengthUnit } from '@/lib/length-units';
import { pdfFileName, savePdf, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, radius, tabularNums, type } from '@/theme';

const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');

type Unit = LengthUnit;
/** An inch size as read off a tape: whole inches plus sixteenths. */
type InchSize = { whole: string; sixteenths: number };
type Dimension = 'width' | 'height';

const EMPTY_INCHES: InchSize = { whole: '', sixteenths: 0 };

const toMm = (unit: Unit, mm: string, inches: InchSize) =>
  unit === 'mm' ? Number(mm) : inches.whole || inches.sixteenths ? inchesToMm(Number(inches.whole) || 0, inches.sixteenths) : 0;

const toInches = (mm: string): InchSize => {
  if (!(Number(mm) > 0)) return EMPTY_INCHES;
  const { whole, sixteenths } = mmToInchParts(Number(mm));
  return { whole: String(whole), sixteenths };
};

export default function GlassCalculatorScreen() {
  const { showToast } = useAppUI();
  const { name, backLabel, fallbackRoute } = useLocalSearchParams<{ name?: string; backLabel?: string; fallbackRoute?: string }>();
  const systemName = name ?? 'Sliding System';
  const panelCount = parsePanelCount(systemName);
  // Telescopic sliding systems ("2+1 Sliding System") call the opening's width its length.
  const widthLabel = /synchro|folding/i.test(systemName) ? 'Width' : 'Length';

  const [unit, setUnit] = useState<Unit>('mm');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [widthIn, setWidthIn] = useState<InchSize>(EMPTY_INCHES);
  const [heightIn, setHeightIn] = useState<InchSize>(EMPTY_INCHES);
  const [fractionFor, setFractionFor] = useState<Dimension | null>(null);
  const [result, setResult] = useState<GlassPlanResult | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  // The last unit chosen is remembered for the next calculation.
  useEffect(() => {
    AsyncStorage.getItem(SIZE_UNIT_KEY)
      .then((saved) => saved === 'in' && setUnit('in'))
      .catch(() => {});
  }, []);

  const widthMm = toMm(unit, width, widthIn);
  const heightMm = toMm(unit, height, heightIn);
  const ready = widthMm > 0 && heightMm > 0;

  const changeUnit = (next: Unit) => {
    if (next === unit) return;
    // Carry over what was already typed, converted.
    if (next === 'in') {
      setWidthIn(toInches(width));
      setHeightIn(toInches(height));
    } else {
      setWidth(widthMm > 0 ? String(widthMm) : '');
      setHeight(heightMm > 0 ? String(heightMm) : '');
    }
    setUnit(next);
    setSizeError(null);
    AsyncStorage.setItem(SIZE_UNIT_KEY, next).catch(() => {});
  };

  const setInches = (dimension: Dimension, change: Partial<InchSize>) => {
    const update = (current: InchSize) => ({ ...current, ...change });
    if (dimension === 'width') setWidthIn(update);
    else setHeightIn(update);
    setSizeError(null);
  };

  const calculate = () => {
    const outcome = computeGlassPlan(systemName, widthMm, heightMm, panelCount);
    if ('error' in outcome) {
      const range = getSystemRange(systemName);
      setSizeError(
        unit === 'in' && range
          ? `${widthLabel} must be ${formatInches(range.minWidth)} – ${formatInches(range.maxWidth)} and height ${formatInches(range.minHeight)} – ${formatInches(range.maxHeight)} for this system (${range.minWidth}–${range.maxWidth} × ${range.minHeight}–${range.maxHeight} mm).`
          : outcome.error.replace(/^Width/, widthLabel),
      );
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
      <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={changeUnit} accessibilityLabel="Size unit" style={styles.units} />

      <InsetGroup
        header={unit === 'mm' ? 'Opening size in mm' : 'Opening size in inches'}
        footer={ready ? (unit === 'mm' ? `= ${formatInchSize(widthMm, heightMm)}` : `= ${formatMm(widthMm)} × ${formatMm(heightMm)}`) : undefined}
        style={sizeError ? styles.groupWithError : undefined}
      >
        {unit === 'mm' ? (
          <DimensionRow
            label={widthLabel}
            value={width}
            onChangeText={(text) => {
              setWidth(digitsOnly(text));
              setSizeError(null);
            }}
            accessibilityLabel={`Opening ${widthLabel.toLowerCase()} in millimetres`}
          />
        ) : (
          <InchRow label={widthLabel} value={widthIn} onChangeWhole={(whole) => setInches('width', { whole })} onPickFraction={() => setFractionFor('width')} />
        )}
        {unit === 'mm' ? (
          <DimensionRow
            label="Height"
            value={height}
            onChangeText={(text) => {
              setHeight(digitsOnly(text));
              setSizeError(null);
            }}
            accessibilityLabel="Opening height in millimetres"
          />
        ) : (
          <InchRow label="Height" value={heightIn} onChangeWhole={(whole) => setInches('height', { whole })} onPickFraction={() => setFractionFor('height')} />
        )}
      </InsetGroup>

      {sizeError && (
        <View style={styles.error} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Text style={styles.errorText}>{sizeError}</Text>
        </View>
      )}

      <Button label="Calculate" onPress={calculate} disabled={!ready} accessibilityHint={ready ? undefined : `Enter the ${widthLabel.toLowerCase()} and height first`} />

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

      <FractionSheet
        visible={fractionFor !== null}
        title={fractionFor === 'height' ? 'Height fraction' : `${widthLabel} fraction`}
        sixteenths={fractionFor === 'height' ? heightIn.sixteenths : widthIn.sixteenths}
        onPick={(sixteenths) => {
          if (fractionFor) setInches(fractionFor, { sixteenths });
          setFractionFor(null);
        }}
        onClose={() => setFractionFor(null)}
      />
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

/** Inch entry as read off a tape: whole inches typed, the fraction picked in sixteenths. */
function InchRow({ label, value, onChangeWhole, onPickFraction }: { label: string; value: InchSize; onChangeWhole: (whole: string) => void; onPickFraction: () => void }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value.whole}
        onChangeText={(text) => onChangeWhole(digitsOnly(text))}
        placeholder={label === 'Height' ? 'e.g. 96' : 'e.g. 47'}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.tint}
        keyboardType="number-pad"
        returnKeyType="done"
        accessibilityLabel={`Opening ${label.toLowerCase()}, whole inches`}
        style={styles.fieldInput}
      />
      <FractionButton sixteenths={value.sixteenths} onPress={onPickFraction} accessibilityLabel={`${label} fraction`} />
      <Text style={styles.unit}>in</Text>
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
      <Text style={styles.fieldLabel}>{label}</Text>
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
  units: { marginBottom: 20 },
  groupWithError: { marginBottom: 8 },
  fieldRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  // Labels and units get more room than their measured width: with Android's Bold text on (and in Expo Go,
  // where the app's native fix can't load) text draws wider than it measures and lost its last letter.
  fieldLabel: { ...type.body, flex: 1 },
  fieldInput: { ...type.body, flex: 1.4, minWidth: 0, minHeight: 46, padding: 0, textAlign: 'right' },
  unit: { ...type.body, minWidth: 36, color: colors.secondaryLabel },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginHorizontal: 16, marginBottom: 22 },
  errorText: { ...type.footnote, flex: 1, color: colors.red },
  results: { marginTop: 32 },
  sizeCard: { marginBottom: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.md },
  sizeTitle: { ...type.subheadline, fontWeight: '600' },
  sizeValue: { ...type.title2, marginTop: 2, ...tabularNums },
  sizeInches: { ...type.headline, marginBottom: 2, color: colors.secondaryLabel, ...tabularNums },
  materials: { marginTop: 16 },
  exportRow: { flexDirection: 'row', gap: 12 },
  exportButton: { flex: 1 },
});
