import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type ImageSourcePropType } from 'react-native';

import { Button } from '@/components/Button';
import { FractionButton, FractionSheet } from '@/components/FractionPicker';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { formatInches, formatInchSize, formatInchSizeLH, formatMm, formatSizeLH, inchesToMm, mmToInchParts } from '@/lib/format';
import { ExportSiteNameSheet } from '@/components/ExportSiteNameSheet';
import { computeGlassPlan, getSystemRange, parsePanelCount, type GlassPlanResult } from '@/lib/glass-calculator';
import { buildGlassPlanHtml } from '@/lib/glass-plan-pdf';
import { SIZE_UNIT_KEY, UNIT_OPTIONS, type LengthUnit } from '@/lib/length-units';
import { useAppContent } from '@/lib/content-sync';
import { pdfNamed, savePdf, sharePdf } from '@/lib/pdf-export';
import { rememberPdf } from '@/lib/saved-pdfs';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, radius, tabularNums, type } from '@/theme';

const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');

type Unit = LengthUnit;
/** An inch size as read off a tape: whole inches plus sixteenths. */
type InchSize = { whole: string; sixteenths: number };
type Dimension = 'width' | 'height';

const EMPTY_INCHES: InchSize = { whole: '', sixteenths: 0 };

const COLOUR_KEY = 'vimalnath:material-colour';
/** Profile finishes, as named in the Taiton price list for telescopic kits. */
const MATERIAL_COLOURS = [
  { name: 'Black Matte', swatch: '#1f1f1f' },
  { name: 'Brushed Gold', swatch: '#c9a96b' },
  { name: 'Rose Gold', swatch: '#d4a39a' },
  { name: 'Grey', swatch: '#8a8f98' },
  { name: 'Champagne', swatch: '#e2cfae' },
];

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
  // Vimalnath calls the opening's width its length, in every system.
  const widthLabel = 'Length';

  const [unit, setUnit] = useState<Unit>('mm');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [widthIn, setWidthIn] = useState<InchSize>(EMPTY_INCHES);
  const [heightIn, setHeightIn] = useState<InchSize>(EMPTY_INCHES);
  const [fractionFor, setFractionFor] = useState<Dimension | null>(null);
  const [result, setResult] = useState<GlassPlanResult | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  // Systems with a confirmed formula let the user pick the profile colour for the material list (remembered).
  const hasColour = getSystemRange(systemName) !== null;
  const [colour, setColour] = useState(MATERIAL_COLOURS[0].name);
  useEffect(() => {
    AsyncStorage.getItem(COLOUR_KEY)
      .then((saved) => saved && MATERIAL_COLOURS.some((item) => item.name === saved) && setColour(saved))
      .catch(() => {});
  }, []);
  const chooseColour = (name: string) => {
    setColour(name);
    AsyncStorage.setItem(COLOUR_KEY, name).catch(() => {});
  };

  // The last unit chosen is remembered for the next calculation; before any choice, the shop's default.
  const { settings, products } = useAppContent();
  useEffect(() => {
    AsyncStorage.getItem(SIZE_UNIT_KEY)
      .then((saved) => (saved ?? settings.defaultUnit) === 'in' && setUnit('in'))
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

  // A result on screen must always match the size above it.
  const clearOutcome = () => {
    setSizeError(null);
    setResult(null);
  };

  const setInches = (dimension: Dimension, change: Partial<InchSize>) => {
    const update = (current: InchSize) => ({ ...current, ...change });
    if (dimension === 'width') setWidthIn(update);
    else setHeightIn(update);
    clearOutcome();
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

  // Sharing or saving asks first who the plan is for; the PDF is named after them and shows it at the top.
  const [askName, setAskName] = useState<'share' | 'save' | null>(null);
  const [lastName, setLastName] = useState('');
  const exportPdf = async (mode: 'share' | 'save', customer: string) => {
    if (!result) return;
    setLastName(customer);
    setBusy(mode);
    try {
      const html = buildGlassPlanHtml({ systemName, customer, result, materialColour: hasColour ? colour : undefined });
      const fileName = pdfNamed(customer);
      // Kept for Saved PDFs (top bar), whichever way it's sent.
      void rememberPdf({ source: 'cutlist', title: `${customer} · ${systemName}`, detail: `Opening ${formatSizeLH(result.openingWidth, result.openingHeight)}`, fileName, html });
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
      setAskName(null);
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
        footer={ready ? (unit === 'mm' ? `= ${formatInchSizeLH(widthMm, heightMm)}` : `= L ${formatMm(widthMm)} × H ${formatMm(heightMm)}`) : undefined}
        style={sizeError ? styles.groupWithError : undefined}
      >
        {unit === 'mm' ? (
          <DimensionRow
            label={widthLabel}
            value={width}
            onChangeText={(text) => {
              setWidth(digitsOnly(text));
              clearOutcome();
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
              clearOutcome();
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
          {result.notice && (
            <View style={styles.notice}>
              <Ionicons name="information-circle" size={18} color={colors.tint} />
              <Text style={styles.noticeText}>{result.notice}</Text>
            </View>
          )}
          {result.warning && (
            <View style={styles.warning} accessibilityRole="alert">
              <Ionicons name="alert-circle" size={16} color={colors.red} />
              <Text style={styles.errorText}>{result.warning}</Text>
            </View>
          )}
          <SizeCard
            title="Cutting size"
            value={formatSizeLH(result.cuttingWidth, result.cuttingHeight)}
            inches={formatInchSizeLH(result.cuttingWidth, result.cuttingHeight)}
            detail="Per panel"
            background={colors.redFill}
          />
          <SizeCard
            title="Glass size"
            value={formatSizeLH(result.glassWidth, result.glassHeight)}
            inches={formatInchSizeLH(result.glassWidth, result.glassHeight)}
            detail={`Qty: ${result.glassQuantity}`}
            background={colors.tintFill}
          />

          {hasColour && (
            <InsetGroup header="Material colour" style={styles.materials}>
              <View style={styles.colours} accessibilityRole="radiogroup" accessibilityLabel="Material colour">
                {MATERIAL_COLOURS.map((item) => {
                  const selected = item.name === colour;
                  return (
                    <Pressable
                      key={item.name}
                      onPress={() => chooseColour(item.name)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={item.name}
                      style={({ pressed }) => [styles.colourChip, selected && styles.colourChipSelected, pressed && { opacity: 0.6 }]}
                    >
                      <View style={[styles.swatch, { backgroundColor: item.swatch }]} />
                      <Text style={[styles.colourText, selected && styles.colourTextSelected]}>{item.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </InsetGroup>
          )}

          <InsetGroup header={hasColour ? `Material list · ${colour}` : 'Material list'} style={hasColour ? undefined : styles.materials}>
            {result.materials.map((item) => {
              // The Shop's photo of the part, from the latest catalogue sync.
              const image = item.productId ? products.find((product) => product.id === item.productId)?.image : undefined;
              return image ? (
                <MaterialRow key={item.label} item={item} image={image} />
              ) : (
                <ValueRow key={item.label} label={item.label} value={item.value} detail={item.note} />
              );
            })}
          </InsetGroup>

          <View style={styles.exportRow}>
            <Button
              label="Share PDF"
              icon="share-outline"
              accessibilityHint="Send the cutting plan by WhatsApp, email and more"
              loading={busy === 'share'}
              disabled={busy !== null && busy !== 'share'}
              onPress={() => setAskName('share')}
              style={styles.exportButton}
            />
            <Button
              label="Save PDF"
              icon="download-outline"
              variant="gray"
              accessibilityHint="Save the cutting plan to this phone"
              loading={busy === 'save'}
              disabled={busy !== null && busy !== 'save'}
              onPress={() => setAskName('save')}
              style={styles.exportButton}
            />
          </View>
        </View>
      )}

      <ExportSiteNameSheet
        visible={askName !== null}
        busy={busy !== null}
        onClose={() => setAskName(null)}
        onSubmit={(name) => askName && void exportPdf(askName, name)}
        required
        initial={lastName}
        fieldLabel="Customer or site name"
        placeholder="e.g. Sundaram Residence, Block A"
        actionLabel={askName === 'save' ? 'Save PDF' : 'Share PDF'}
        body="Printed at the top of the cutting plan, and the PDF is named after it."
      />

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

/** A material with its product photo: the photo, the name and note, then the quantity on the right. */
function MaterialRow({ item, image }: { item: GlassPlanResult['materials'][number]; image: ImageSourcePropType }) {
  return (
    <View style={styles.materialRow} accessible accessibilityLabel={`${item.label}, ${item.value}${item.note ? `, ${item.note}` : ''}`}>
      <View style={styles.materialPhoto}>
        {/* Memory only: a photo replaced under the same name must not come back from the disk cache. */}
        <Image source={image} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory" transition={120} accessibilityIgnoresInvertColors />
      </View>
      <View style={styles.materialText}>
        <Text style={type.body}>{item.label}</Text>
        {item.note ? <Text style={styles.materialNote}>{item.note}</Text> : null}
      </View>
      <Text style={styles.materialValue}>{item.value}</Text>
    </View>
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
  warning: { flexDirection: 'row', gap: 6, marginBottom: 12, marginHorizontal: 4 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12, padding: 12, backgroundColor: colors.tintFill, borderRadius: radius.md },
  noticeText: { ...type.subheadline, flex: 1, fontWeight: '600', color: colors.tint },
  sizeCard: { marginBottom: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.md },
  sizeTitle: { ...type.subheadline, fontWeight: '600' },
  sizeValue: { ...type.title2, marginTop: 2, ...tabularNums },
  sizeInches: { ...type.headline, marginBottom: 2, color: colors.secondaryLabel, ...tabularNums },
  materials: { marginTop: 16 },
  materialRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  materialPhoto: { width: 52, height: 52, overflow: 'hidden', borderRadius: 8, backgroundColor: colors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
  // Both text columns take a share of the row, so Android's Bold text can't cut the ends off.
  materialText: { flex: 1.4 },
  materialNote: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  materialValue: { ...type.body, flex: 1, textAlign: 'right', color: colors.secondaryLabel },
  colours: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  colourChip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 14, borderWidth: 1.5, borderColor: colors.separator, borderRadius: 20 },
  colourChipSelected: { borderColor: colors.tint, backgroundColor: colors.tintFill },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0, 0, 0, 0.25)' },
  colourText: { ...type.subheadline, minWidth: 60 },
  colourTextSelected: { color: colors.tint, fontWeight: '600' },
  exportRow: { flexDirection: 'row', gap: 12 },
  exportButton: { flex: 1 },
});
