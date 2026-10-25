import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { BarResultPanel } from '@/components/BarResultPanel';
import { Button } from '@/components/Button';
import { ExportSiteNameSheet } from '@/components/ExportSiteNameSheet';
import { FractionButton, FractionSheet } from '@/components/FractionPicker';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SectionPickerSheet } from '@/components/SectionPickerSheet';
import { SegmentedControl } from '@/components/SegmentedControl';
import { sections, type Section } from '@/data/sections';
import { planBars, type BarPlan } from '@/lib/bar-optimizer';
import { buildBarPlanHtml } from '@/lib/bar-plan-pdf';
import { confirmDestructive } from '@/lib/confirm';
import { withTimeout } from '@/lib/pdf-html';
import { inchesToMm, mmToInchParts, pad2 } from '@/lib/format';
import { formatLength, formatLengthValue, SIZE_UNIT_KEY, UNIT_OPTIONS, type LengthUnit } from '@/lib/length-units';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, tabularNums, type } from '@/theme';

/** `value` is millimetres, or whole inches with `frac` sixteenths on top in inch mode. */
type PieceRow = { id: number; value: string; frac: number; qty: string };
type StoredRow = { value: string; frac?: number; qty: string };
/** Cutting loss: decimal millimetres in `mm`, sixteenths of an inch in `frac`. */
type Kerf = { mm: string; frac: number };
type StoredResult = { sectionCode: string; unit?: LengthUnit; barLengths: StoredRow[]; kerf: string; kerfFrac?: number; pieces: StoredRow[]; plan: BarPlan };
type FractionTarget = { list: 'bar' | 'piece'; id: number } | { list: 'kerf' };

const DEFAULT_PIECES: { length: number | ''; qty: number }[] = [
  { length: 2450, qty: 2 },
  { length: 1800, qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
  { length: '', qty: 2 },
];
const LAST_RESULT_KEY = 'vimalnath:bar-optimizer:last-result';
const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');
const decimalOnly = (text: string) => text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

/** A row's length in the plan's unit: millimetres, or sixteenths of an inch. */
const rowLength = (row: PieceRow, unit: LengthUnit) => (unit === 'in' ? (Number(row.value) || 0) * 16 + row.frac : Number(row.value));
const kerfLength = (kerf: Kerf, unit: LengthUnit) => (unit === 'in' ? kerf.frac : Number(kerf.mm) || 0);

/** Re-expresses what was typed in the other unit, so switching never loses an entry. */
function convertRow<T extends PieceRow>(row: T, to: LengthUnit): T {
  if (to === 'in') {
    if (!(Number(row.value) > 0)) return { ...row, value: '', frac: 0 };
    const { whole, sixteenths } = mmToInchParts(Number(row.value));
    return { ...row, value: whole ? String(whole) : '', frac: sixteenths };
  }
  const mm = inchesToMm(Number(row.value) || 0, row.frac);
  return { ...row, value: mm > 0 ? String(mm) : '', frac: 0 };
}

function convertKerf(kerf: Kerf, to: LengthUnit): Kerf {
  if (to === 'in') return { mm: kerf.mm, frac: Math.min(15, Math.round(((Number(kerf.mm) || 0) / 25.4) * 16)) };
  return { mm: String(Math.round((kerf.frac / 16) * 25.4 * 10) / 10), frac: 0 };
}

export default function BarOptimizerScreen() {
  const { showToast } = useAppUI();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(0);
  const makeRow = (value = '', qty = '', frac = 0): PieceRow => ({ id: nextId.current++, value, frac, qty });

  const [unit, setUnit] = useState<LengthUnit>('mm');
  const [section, setSection] = useState<Section>(sections[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barLengths, setBarLengths] = useState<PieceRow[]>(() => [makeRow(String(sections[0].bar))]);
  const [barFocusRowId, setBarFocusRowId] = useState<number | null>(null);
  const [kerf, setKerf] = useState<Kerf>({ mm: '0', frac: 0 });
  const [fractionFor, setFractionFor] = useState<FractionTarget | null>(null);
  const defaultPieces = () => DEFAULT_PIECES.map((piece) => makeRow(piece.length === '' ? '' : String(piece.length), String(piece.qty)));
  const [pieces, setPieces] = useState<PieceRow[]>(defaultPieces);
  const [focusRowId, setFocusRowId] = useState<number | null>(null);
  const [plan, setPlan] = useState<BarPlan | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // The result's position is only known after it lays out, so a scroll request may have to wait for onLayout.
  const resultY = useRef<number | null>(null);
  const pendingScroll = useRef(false);
  const scrollToResult = () => {
    if (resultY.current === null) return;
    pendingScroll.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, resultY.current - 16), animated: true });
  };
  useEffect(() => {
    if (plan && pendingScroll.current) scrollToResult();
  }, [plan]);

  // Restore the last calculated result (and the inputs that produced it) so it stays on screen
  // until the next "Calculate" tap, even after the app is closed and reopened.
  // The inputs come back in the unit they were typed in, then switch to the unit last chosen anywhere
  // in the app (the result keeps its own unit).
  useEffect(() => {
    (async () => {
      let inputsUnit: LengthUnit = 'mm';
      try {
        const raw = await AsyncStorage.getItem(LAST_RESULT_KEY);
        if (raw) {
          const saved: StoredResult = JSON.parse(raw);
          inputsUnit = saved.unit ?? 'mm';
          const savedSection = sections.find((item) => item.code === saved.sectionCode);
          if (savedSection) setSection(savedSection);
          if (saved.barLengths?.length) setBarLengths(saved.barLengths.map((row) => makeRow(row.value, row.qty, row.frac)));
          if (saved.kerf !== undefined) setKerf({ mm: saved.kerf, frac: saved.kerfFrac ?? 0 });
          if (saved.pieces?.length) setPieces(saved.pieces.map((row) => makeRow(row.value, row.qty, row.frac)));
          if (saved.plan) setPlan(saved.plan);
        }
      } catch {
        // Corrupt or missing cache — keep the defaults.
      }
      const preferred = await AsyncStorage.getItem(SIZE_UNIT_KEY).catch(() => null);
      const target: LengthUnit = preferred === 'in' || preferred === 'mm' ? preferred : inputsUnit;
      setUnit(target);
      if (target !== inputsUnit) convertInputs(target);
    })();
  }, []);

  const convertInputs = (to: LengthUnit) => {
    setBarLengths((rows) => rows.map((row) => convertRow(row, to)));
    setPieces((rows) => rows.map((row) => convertRow(row, to)));
    setKerf((current) => convertKerf(current, to));
  };

  const changeUnit = (next: LengthUnit) => {
    if (next === unit) return;
    convertInputs(next);
    setUnit(next);
    AsyncStorage.setItem(SIZE_UNIT_KEY, next).catch(() => {});
  };

  const updateRow = (list: 'bar' | 'piece', id: number, change: Partial<PieceRow>) => {
    const update = (rows: PieceRow[]) => rows.map((item) => (item.id === id ? { ...item, ...change } : item));
    if (list === 'bar') setBarLengths(update);
    else setPieces(update);
  };

  const pickedFraction = (() => {
    if (!fractionFor) return 0;
    if (fractionFor.list === 'kerf') return kerf.frac;
    const rows = fractionFor.list === 'bar' ? barLengths : pieces;
    return rows.find((row) => row.id === fractionFor.id)?.frac ?? 0;
  })();

  const pickFraction = (sixteenths: number) => {
    if (fractionFor?.list === 'kerf') setKerf((current) => ({ ...current, frac: sixteenths }));
    else if (fractionFor) updateRow(fractionFor.list, fractionFor.id, { frac: sixteenths });
    setFractionFor(null);
  };

  const addPiece = () => {
    const row = makeRow('', '2');
    setPieces((rows) => [...rows, row]);
    setFocusRowId(row.id);
  };

  const addBarLength = () => {
    const row = makeRow();
    setBarLengths((rows) => [...rows, row]);
    setBarFocusRowId(row.id);
  };

  // Back to a fresh start in the current unit: the first section, its bar length, no cutting loss, the
  // default pieces, and no result (the saved one is cleared too, so it doesn't come back on reopen).
  const reset = () =>
    confirmDestructive('Reset the optimizer?', 'All bar lengths, pieces and the bar plan will be cleared.', 'Reset', () => {
      Keyboard.dismiss();
      setSection(sections[0]);
      // Defaults are millimetres; in inch mode they're converted like a unit switch would.
      const inUnit = (row: PieceRow) => (unit === 'in' ? convertRow(row, 'in') : row);
      setBarLengths([inUnit(makeRow(String(sections[0].bar)))]);
      setKerf({ mm: '0', frac: 0 });
      setPieces(defaultPieces().map(inUnit));
      setBarFocusRowId(null);
      setFocusRowId(null);
      setPlan(null);
      AsyncStorage.removeItem(LAST_RESULT_KEY).catch(() => {});
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      showToast('Optimizer reset.');
    });

  const calculate = () => {
    Keyboard.dismiss();
    const result = planBars({
      pieces: pieces.map((row) => ({ length: rowLength(row, unit), qty: row.qty ? Number(row.qty) : 2 })),
      stock: barLengths.map((row) => ({ length: rowLength(row, unit), qty: row.qty ? Number(row.qty) : undefined })),
      kerf: kerfLength(kerf, unit),
      unit,
    });
    if ('error' in result) {
      showToast(result.error);
      return;
    }
    pendingScroll.current = true;
    setPlan(result.plan);

    const snapshot: StoredResult = {
      sectionCode: section.code,
      unit,
      barLengths: barLengths.map((row) => ({ value: row.value, frac: row.frac, qty: row.qty })),
      kerf: kerf.mm,
      kerfFrac: kerf.frac,
      pieces: pieces.map((row) => ({ value: row.value, frac: row.frac, qty: row.qty })),
      plan: result.plan,
    };
    AsyncStorage.setItem(LAST_RESULT_KEY, JSON.stringify(snapshot)).catch(() => {});
  };

  const sharePlan = async () => {
    if (!plan) return;
    const stockLengths = Array.from(new Set(plan.bars.map((bar) => bar.length))).sort((a, b) => b - a);
    const length = (value: number) => formatLength(value, plan.unit);
    const message = [
      `Vimalnath bar plan · ${section.code} ${section.name}`,
      `Standard bar${stockLengths.length > 1 ? 's' : ''} ${stockLengths.map(length).join(', ')} · ${length(plan.kerf)} cutting loss`,
      `${plan.bars.length} bars required · ${length(plan.waste)} waste · ${plan.utilization.toFixed(1)}% utilization`,
      '',
      ...plan.bars.map(
        (bar, index) =>
          `Bar ${pad2(index + 1)}: ${bar.pieces.map((piece) => formatLengthValue(piece, plan.unit)).join(' + ')} (${length(bar.used)} used of ${length(bar.length)})`,
      ),
    ].join('\n');
    try {
      await Share.share({ title: 'Bar plan', message });
    } catch {
      showToast('Sharing isn’t available on this device.');
    }
  };

  const exportPdf = async (siteName: string) => {
    if (!plan) return;
    setExporting(true);
    try {
      const html = buildBarPlanHtml({ siteName, section, plan });
      // Guarded with a timeout so a stuck native call can't leave the button spinning forever
      // (the share sheet itself waits on the user, so it isn't timed).
      if (Platform.OS === 'web') {
        // On web this just opens the browser's print dialog — it doesn't return a usable file uri to share.
        await withTimeout(Print.printToFileAsync({ html }), 20000, 'Generating PDF');
      } else {
        const { uri } = await withTimeout(Print.printToFileAsync({ html }), 20000, 'Generating PDF');
        if (await withTimeout(Sharing.isAvailableAsync(), 5000, 'Checking sharing availability')) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share bar plan', UTI: 'com.adobe.pdf' });
        }
      }
      setExportOpen(false);
    } catch (err) {
      console.error('PDF export failed:', err);
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t create the PDF: ${reason}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen title="Bar Optimizer" subtitle="Plan cuts from standard bars · works offline" grouped scrollRef={scrollRef}>
      <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={changeUnit} accessibilityLabel="Length unit" style={styles.units} />

      <InsetGroup header="Section">
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Section ${section.code}, ${section.name}`}
          accessibilityHint="Choose a different profile"
          style={({ pressed }) => [styles.select, pressed && styles.rowPressed]}
        >
          <LinearGradient colors={['#2e62ed', '#8baaff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.profileMini}>
            <View style={styles.profileMiniFrame} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={type.headline}>{section.code}</Text>
            <Text style={styles.selectName} numberOfLines={1}>
              {section.name} · {section.dimensions}
            </Text>
          </View>
          <Ionicons name="chevron-expand" size={18} color={colors.tertiaryLabel} />
        </Pressable>
      </InsetGroup>

      <InsetGroup header="Standard bar lengths" footer="Leave quantity blank for unlimited stock.">
        {barLengths.length > 0 && <ColumnHeader unit={unit} />}
        {barLengths.map((row, index) => (
          <RowInput
            key={row.id}
            index={index}
            unit={unit}
            value={row.value}
            frac={row.frac}
            qty={row.qty}
            autoFocus={row.id === barFocusRowId}
            placeholder={unit === 'in' ? 'Inches' : 'Bar length'}
            qtyPlaceholder="Any"
            accessibilityLabel={`Standard bar ${index + 1} length in ${unit === 'in' ? 'whole inches' : 'millimetres'}`}
            qtyAccessibilityLabel={`Standard bar ${index + 1} quantity in stock, blank for unlimited`}
            removeAccessibilityLabel={`Remove standard bar ${index + 1}`}
            onChangeText={(text) => updateRow('bar', row.id, { value: digitsOnly(text) })}
            onPickFraction={() => setFractionFor({ list: 'bar', id: row.id })}
            onChangeQty={(text) => updateRow('bar', row.id, { qty: digitsOnly(text) })}
            onRemove={() => setBarLengths((rows) => rows.filter((item) => item.id !== row.id))}
          />
        ))}
        <AddRow label="Add Bar Length" onPress={addBarLength} />
      </InsetGroup>

      <InsetGroup header="Cutting loss" footer="Material lost to the saw blade on each cut.">
        <View style={styles.kerfRow}>
          <Text style={styles.kerfLabel}>Per cut</Text>
          {unit === 'mm' ? (
            <TextInput
              value={kerf.mm}
              onChangeText={(text) => setKerf((current) => ({ ...current, mm: decimalOnly(text) }))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              selectionColor={colors.tint}
              accessibilityLabel="Cutting loss per cut in millimetres"
              style={styles.kerfInput}
            />
          ) : (
            <View style={styles.kerfFraction}>
              <FractionButton sixteenths={kerf.frac} onPress={() => setFractionFor({ list: 'kerf' })} accessibilityLabel="Cutting loss per cut" />
            </View>
          )}
          <Text style={styles.unit}>{unit === 'in' ? 'in' : 'mm'}</Text>
        </View>
      </InsetGroup>

      <InsetGroup header="Required pieces">
        {pieces.length > 0 && <ColumnHeader unit={unit} />}
        {pieces.map((row, index) => (
          <RowInput
            key={row.id}
            index={index}
            unit={unit}
            value={row.value}
            frac={row.frac}
            qty={row.qty}
            autoFocus={row.id === focusRowId}
            placeholder={unit === 'in' ? 'Inches' : 'Piece length'}
            qtyPlaceholder="2"
            accessibilityLabel={`Piece ${index + 1} length in ${unit === 'in' ? 'whole inches' : 'millimetres'}`}
            qtyAccessibilityLabel={`Piece ${index + 1} quantity needed`}
            removeAccessibilityLabel={`Remove piece ${index + 1}`}
            onChangeText={(text) => updateRow('piece', row.id, { value: digitsOnly(text) })}
            onPickFraction={() => setFractionFor({ list: 'piece', id: row.id })}
            onChangeQty={(text) => updateRow('piece', row.id, { qty: digitsOnly(text) })}
            onValueSubmit={index === pieces.length - 1 ? addPiece : undefined}
            onQtySubmit={index === pieces.length - 1 ? addPiece : undefined}
            onRemove={() => setPieces((rows) => rows.filter((item) => item.id !== row.id))}
          />
        ))}
        <AddRow label="Add Piece" onPress={addPiece} />
      </InsetGroup>

      <View style={styles.actions}>
        <Button label="Reset" icon="refresh" variant="gray" onPress={reset} accessibilityHint="Clears all bar lengths, pieces and the bar plan" style={styles.resetButton} />
        <Button label="Calculate" onPress={calculate} style={styles.calculateButton} />
      </View>

      {plan && (
        <View
          onLayout={(event) => {
            resultY.current = event.nativeEvent.layout.y;
            if (pendingScroll.current) scrollToResult();
          }}
        >
          <BarResultPanel plan={plan} onShare={sharePlan} onExport={() => setExportOpen(true)} />
        </View>
      )}

      <SectionPickerSheet
        visible={pickerOpen}
        selectedCode={section.code}
        onClose={() => setPickerOpen(false)}
        onSelect={(next) => {
          setSection(next);
          const row = makeRow(String(next.bar));
          setBarLengths([unit === 'in' ? convertRow(row, 'in') : row]);
          setPickerOpen(false);
        }}
      />

      <FractionSheet
        visible={fractionFor !== null}
        title={fractionFor?.list === 'kerf' ? 'Cutting loss' : fractionFor?.list === 'bar' ? 'Bar length fraction' : 'Piece length fraction'}
        sixteenths={pickedFraction}
        onPick={pickFraction}
        onClose={() => setFractionFor(null)}
      />

      <ExportSiteNameSheet visible={exportOpen} busy={exporting} onClose={() => setExportOpen(false)} onSubmit={exportPdf} />
    </Screen>
  );
}

function ColumnHeader({ unit }: { unit: LengthUnit }) {
  return (
    <View style={styles.columnHeader} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.columnLabel, styles.columnLength]}>{unit === 'in' ? 'LENGTH (INCHES)' : 'LENGTH (MM)'}</Text>
      <Text style={[styles.columnLabel, styles.columnQty]}>QTY</Text>
      <View style={styles.columnRemove} />
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.addRow, pressed && styles.rowPressed]}>
      <Ionicons name="add-circle" size={22} color={colors.tint} />
      <Text style={styles.addRowText}>{label}</Text>
    </Pressable>
  );
}

type RowInputProps = {
  index: number;
  unit: LengthUnit;
  value: string;
  /** Sixteenths of an inch, shown as a fraction button in inch mode. */
  frac: number;
  qty: string;
  autoFocus: boolean;
  placeholder: string;
  qtyPlaceholder: string;
  accessibilityLabel: string;
  qtyAccessibilityLabel: string;
  removeAccessibilityLabel: string;
  onChangeText: (text: string) => void;
  onPickFraction: () => void;
  onChangeQty: (text: string) => void;
  /** When set, submitting the length field (e.g. the last row) adds another row. */
  onValueSubmit?: () => void;
  /** When set, submitting the quantity field (e.g. the last row) adds another row. */
  onQtySubmit?: () => void;
  onRemove: () => void;
};

function RowInput({
  index,
  unit,
  value,
  frac,
  qty,
  autoFocus,
  placeholder,
  qtyPlaceholder,
  accessibilityLabel,
  qtyAccessibilityLabel,
  removeAccessibilityLabel,
  onChangeText,
  onPickFraction,
  onChangeQty,
  onValueSubmit,
  onQtySubmit,
  onRemove,
}: RowInputProps) {
  return (
    <View style={styles.pieceRow}>
      <Text style={styles.pieceIndex}>{pad2(index + 1)}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.tint}
        keyboardType="number-pad"
        returnKeyType={onValueSubmit ? 'next' : 'done'}
        autoFocus={autoFocus}
        onSubmitEditing={onValueSubmit}
        accessibilityLabel={accessibilityLabel}
        style={[styles.fieldInput, styles.pieceInput]}
      />
      {unit === 'in' && <FractionButton sixteenths={frac} onPress={onPickFraction} accessibilityLabel={`${accessibilityLabel.replace(/ in whole inches$/, '')} fraction`} />}
      <TextInput
        value={qty}
        onChangeText={onChangeQty}
        placeholder={qtyPlaceholder}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.tint}
        keyboardType="number-pad"
        returnKeyType={onQtySubmit ? 'next' : 'done'}
        selectTextOnFocus
        onSubmitEditing={onQtySubmit}
        accessibilityLabel={qtyAccessibilityLabel}
        style={[styles.fieldInput, styles.qtyInput]}
      />
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={removeAccessibilityLabel} style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.5 }]}>
        <Ionicons name="remove-circle" size={22} color={colors.red} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  units: { marginBottom: 20 },
  actions: { flexDirection: 'row', gap: 12 },
  resetButton: { flex: 1 },
  calculateButton: { flex: 2 },
  rowPressed: { backgroundColor: colors.fill },
  select: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  profileMini: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  profileMiniFrame: { width: 17, height: 23, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', transform: [{ skewX: '-12deg' }] },
  selectName: { ...type.subheadline, marginTop: 1, color: colors.secondaryLabel },
  kerfRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  kerfInput: { ...type.body, flex: 1, minHeight: 46, padding: 0, textAlign: 'right' },
  kerfFraction: { flex: 1, minHeight: 46, alignItems: 'flex-end', justifyContent: 'center' },
  // Extra room beyond the measured width, so Bold text (and Expo Go) can't clip the last letter.
  kerfLabel: { ...type.body, minWidth: 80 },
  unit: { ...type.body, minWidth: 36, color: colors.secondaryLabel },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 48, paddingRight: 4, paddingTop: 10, paddingBottom: 2 },
  columnLabel: { ...type.caption1, color: colors.secondaryLabel },
  columnLength: { flex: 1 },
  columnQty: { width: 60, textAlign: 'center' },
  columnRemove: { width: 44 },
  pieceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 16, paddingRight: 4 },
  pieceIndex: { ...type.footnote, width: 24, color: colors.secondaryLabel, ...tabularNums },
  fieldInput: { ...type.body, height: 40, paddingVertical: 0, backgroundColor: colors.tertiaryFill, borderRadius: 8 },
  pieceInput: { flex: 1, minWidth: 0, paddingHorizontal: 12 },
  qtyInput: { width: 60, paddingHorizontal: 6, textAlign: 'center' },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  addRowText: { ...type.body, color: colors.tint },
});
