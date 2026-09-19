import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { BarResultPanel } from '@/components/BarResultPanel';
import { ExportSiteNameSheet } from '@/components/ExportSiteNameSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Pill, ScreenTitle } from '@/components/ScreenTitle';
import { SectionPickerSheet } from '@/components/SectionPickerSheet';
import { sections, type Section } from '@/data/sections';
import { planBars, type BarPlan } from '@/lib/bar-optimizer';
import { buildBarPlanHtml } from '@/lib/bar-plan-pdf';
import { formatMm, pad2 } from '@/lib/format';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts, type } from '@/theme';

type PieceRow = { id: number; value: string; qty: string };
type StoredRow = { value: string; qty: string };
type StoredResult = { sectionCode: string; barLengths: StoredRow[]; kerf: string; pieces: StoredRow[]; plan: BarPlan };

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

export default function BarOptimizerScreen() {
  const { showToast } = useAppUI();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(0);
  const makeRow = (value = '', qty = ''): PieceRow => ({ id: nextId.current++, value, qty });

  const [section, setSection] = useState<Section>(sections[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barLengths, setBarLengths] = useState<PieceRow[]>(() => [makeRow(String(sections[0].bar))]);
  const [barFocusRowId, setBarFocusRowId] = useState<number | null>(null);
  const [kerf, setKerf] = useState('0');
  const [pieces, setPieces] = useState<PieceRow[]>(() => DEFAULT_PIECES.map((piece) => makeRow(piece.length === '' ? '' : String(piece.length), String(piece.qty))));
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
  // until the next "Calculate bars" tap, even after the app is closed and reopened.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_RESULT_KEY);
        if (!raw) return;
        const saved: StoredResult = JSON.parse(raw);
        const savedSection = sections.find((item) => item.code === saved.sectionCode);
        if (savedSection) setSection(savedSection);
        if (saved.barLengths?.length) setBarLengths(saved.barLengths.map((row) => makeRow(row.value, row.qty)));
        if (saved.kerf !== undefined) setKerf(saved.kerf);
        if (saved.pieces?.length) setPieces(saved.pieces.map((row) => makeRow(row.value, row.qty)));
        if (saved.plan) setPlan(saved.plan);
      } catch {
        // Corrupt or missing cache — keep the defaults.
      }
    })();
  }, []);

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

  const calculate = () => {
    Keyboard.dismiss();
    const result = planBars({
      pieces: pieces.map((row) => ({ length: Number(row.value), qty: row.qty ? Number(row.qty) : 2 })),
      stock: barLengths.map((row) => ({ length: Number(row.value), qty: row.qty ? Number(row.qty) : undefined })),
      kerf: Number(kerf) || 0,
    });
    if ('error' in result) {
      showToast(result.error);
      return;
    }
    pendingScroll.current = true;
    setPlan(result.plan);

    const snapshot: StoredResult = {
      sectionCode: section.code,
      barLengths: barLengths.map((row) => ({ value: row.value, qty: row.qty })),
      kerf,
      pieces: pieces.map((row) => ({ value: row.value, qty: row.qty })),
      plan: result.plan,
    };
    AsyncStorage.setItem(LAST_RESULT_KEY, JSON.stringify(snapshot)).catch(() => {});
  };

  const sharePlan = async () => {
    if (!plan) return;
    const stockLengths = Array.from(new Set(plan.bars.map((bar) => bar.length))).sort((a, b) => b - a);
    const message = [
      `Vimalnath bar plan · ${section.code} ${section.name}`,
      `Standard bar${stockLengths.length > 1 ? 's' : ''} ${stockLengths.map(formatMm).join(', ')} · ${plan.kerf} mm cutting loss`,
      `${plan.bars.length} bars required · ${formatMm(plan.waste)} waste · ${plan.utilization.toFixed(1)}% utilization`,
      '',
      ...plan.bars.map((bar, index) => `Bar ${pad2(index + 1)}: ${bar.pieces.join(' + ')} (${formatMm(bar.used)} used of ${formatMm(bar.length)})`),
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
      const { uri } = await Print.printToFileAsync({ html });
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save or share bar plan', UTI: 'com.adobe.pdf' });
      }
      setExportOpen(false);
    } catch {
      showToast('Could not create the PDF on this device.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen scrollRef={scrollRef}>
      <ScreenTitle
        eyebrow="MATERIAL PLANNING"
        title="Bar optimizer"
        accessory={
          <Pill tone="green" dot>
            Offline ready
          </Pill>
        }
      />

      <View style={styles.field}>
        <Text style={[type.label, styles.fieldLabel]}>Section / profile</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Section ${section.code}, ${section.name}. Change section`}
          style={({ pressed }) => [styles.select, pressed && { backgroundColor: colors.soft }]}
        >
          <LinearGradient colors={['#2e62ed', '#8baaff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.profileMini}>
            <View style={styles.profileMiniFrame} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectCode}>{section.code}</Text>
            <Text style={styles.selectName} numberOfLines={1}>
              {section.name} · {section.dimensions}
            </Text>
          </View>
          <Feather name="chevron-down" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.field}>
        <View style={styles.piecesHeader}>
          <Text style={type.label}>Standard bar lengths</Text>
          <Pressable onPress={addBarLength} accessibilityRole="button" hitSlop={10} style={styles.addButton}>
            <Feather name="plus" size={16} color={colors.blue} />
            <Text style={styles.addButtonText}>Add bar</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Leave quantity blank for unlimited stock.</Text>

        {barLengths.length > 0 && (
          <View style={styles.columnHeader}>
            <View style={styles.columnHeaderIndexSpacer} />
            <Text style={styles.columnHeaderLength}>LENGTH</Text>
            <View style={styles.columnHeaderUnitSpacer} />
            <Text style={styles.columnHeaderQty}>QTY</Text>
            <View style={styles.columnHeaderRemoveSpacer} />
          </View>
        )}
        <View style={styles.pieces}>
          {barLengths.map((row, index) => (
            <RowInput
              key={row.id}
              index={index}
              value={row.value}
              qty={row.qty}
              autoFocus={row.id === barFocusRowId}
              placeholder="Bar length"
              qtyPlaceholder="Any"
              accessibilityLabel={`Standard bar ${index + 1} length in millimetres`}
              qtyAccessibilityLabel={`Standard bar ${index + 1} quantity in stock, blank for unlimited`}
              removeAccessibilityLabel={`Remove standard bar ${index + 1}`}
              onChangeText={(text) => setBarLengths((rows) => rows.map((item) => (item.id === row.id ? { ...item, value: digitsOnly(text) } : item)))}
              onChangeQty={(text) => setBarLengths((rows) => rows.map((item) => (item.id === row.id ? { ...item, qty: digitsOnly(text) } : item)))}
              onRemove={() => setBarLengths((rows) => rows.filter((item) => item.id !== row.id))}
            />
          ))}
          {!barLengths.length && <Text style={styles.emptyPieces}>Add at least one standard bar length.</Text>}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={[type.label, styles.fieldLabel]}>Cutting loss</Text>
        <UnitInput value={kerf} onChangeText={(text) => setKerf(decimalOnly(text))} keyboardType="decimal-pad" label="Cutting loss per cut in millimetres" />
      </View>

      <View style={styles.field}>
        <View style={styles.piecesHeader}>
          <Text style={type.label}>Required pieces</Text>
          <Pressable onPress={addPiece} accessibilityRole="button" hitSlop={10} style={styles.addButton}>
            <Feather name="plus" size={16} color={colors.blue} />
            <Text style={styles.addButtonText}>Add piece</Text>
          </Pressable>
        </View>

        {pieces.length > 0 && (
          <View style={styles.columnHeader}>
            <View style={styles.columnHeaderIndexSpacer} />
            <Text style={styles.columnHeaderLength}>LENGTH</Text>
            <View style={styles.columnHeaderUnitSpacer} />
            <Text style={styles.columnHeaderQty}>QTY</Text>
            <View style={styles.columnHeaderRemoveSpacer} />
          </View>
        )}
        <View style={styles.pieces}>
          {pieces.map((row, index) => (
            <RowInput
              key={row.id}
              index={index}
              value={row.value}
              qty={row.qty}
              autoFocus={row.id === focusRowId}
              placeholder="Piece length"
              qtyPlaceholder="2"
              accessibilityLabel={`Piece ${index + 1} length in millimetres`}
              qtyAccessibilityLabel={`Piece ${index + 1} quantity needed`}
              removeAccessibilityLabel={`Remove piece ${index + 1}`}
              onChangeText={(text) => setPieces((rows) => rows.map((item) => (item.id === row.id ? { ...item, value: digitsOnly(text) } : item)))}
              onChangeQty={(text) => setPieces((rows) => rows.map((item) => (item.id === row.id ? { ...item, qty: digitsOnly(text) } : item)))}
              onValueSubmit={index === pieces.length - 1 ? addPiece : undefined}
              onQtySubmit={index === pieces.length - 1 ? addPiece : undefined}
              onRemove={() => setPieces((rows) => rows.filter((item) => item.id !== row.id))}
            />
          ))}
          {!pieces.length && <Text style={styles.emptyPieces}>No pieces yet — add the lengths you need to cut.</Text>}
        </View>
      </View>

      <PrimaryButton label="Calculate bars" onPress={calculate} />

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
          setBarLengths([makeRow(String(next.bar))]);
          setPickerOpen(false);
        }}
      />

      <ExportSiteNameSheet visible={exportOpen} busy={exporting} onClose={() => setExportOpen(false)} onSubmit={exportPdf} />
    </Screen>
  );
}

function UnitInput({ value, onChangeText, keyboardType, label }: { value: string; onChangeText: (text: string) => void; keyboardType: KeyboardTypeOptions; label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.unitInput, focused && styles.inputFocused]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        returnKeyType="done"
        selectTextOnFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        style={styles.unitInputText}
      />
      <Text style={styles.unit}>mm</Text>
    </View>
  );
}

type RowInputProps = {
  index: number;
  value: string;
  qty: string;
  autoFocus: boolean;
  placeholder: string;
  qtyPlaceholder: string;
  accessibilityLabel: string;
  qtyAccessibilityLabel: string;
  removeAccessibilityLabel: string;
  onChangeText: (text: string) => void;
  onChangeQty: (text: string) => void;
  /** When set, submitting the length field (e.g. the last row) adds another row. */
  onValueSubmit?: () => void;
  /** When set, submitting the quantity field (e.g. the last row) adds another row. */
  onQtySubmit?: () => void;
  onRemove: () => void;
};

function RowInput({
  index,
  value,
  qty,
  autoFocus,
  placeholder,
  qtyPlaceholder,
  accessibilityLabel,
  qtyAccessibilityLabel,
  removeAccessibilityLabel,
  onChangeText,
  onChangeQty,
  onValueSubmit,
  onQtySubmit,
  onRemove,
}: RowInputProps) {
  const [focused, setFocused] = useState(false);
  const [qtyFocused, setQtyFocused] = useState(false);
  return (
    <View style={styles.pieceRow}>
      <Text style={styles.pieceIndex}>{pad2(index + 1)}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        keyboardType="number-pad"
        returnKeyType={onValueSubmit ? 'next' : 'done'}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onValueSubmit}
        accessibilityLabel={accessibilityLabel}
        style={[styles.pieceInput, focused && styles.inputFocused]}
      />
      <Text style={styles.unit}>mm</Text>
      <TextInput
        value={qty}
        onChangeText={onChangeQty}
        placeholder={qtyPlaceholder}
        placeholderTextColor={colors.subtle}
        keyboardType="number-pad"
        returnKeyType={onQtySubmit ? 'next' : 'done'}
        selectTextOnFocus
        onFocus={() => setQtyFocused(true)}
        onBlur={() => setQtyFocused(false)}
        onSubmitEditing={onQtySubmit}
        accessibilityLabel={qtyAccessibilityLabel}
        style={[styles.qtyInput, qtyFocused && styles.inputFocused]}
      />
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={removeAccessibilityLabel} style={styles.removeButton}>
        <Feather name="x" size={19} color="#a9b1bd" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 18 },
  fieldLabel: { marginBottom: 8 },
  select: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
  },
  profileMini: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  profileMiniFrame: { width: 18, height: 24, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', transform: [{ skewX: '-12deg' }] },
  selectCode: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  selectName: { marginTop: 1, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  unitInput: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
  },
  unitInputText: { flex: 1, height: '100%', minWidth: 0, padding: 0, color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  inputFocused: { borderColor: '#a9bdf8', backgroundColor: '#fbfcff' },
  unit: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  piecesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  addButtonText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 13 },
  hint: { marginTop: -4, marginBottom: 10, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 4, marginBottom: 6 },
  columnHeaderIndexSpacer: { width: 22 },
  columnHeaderLength: { flex: 1, color: colors.muted, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8 },
  columnHeaderUnitSpacer: { width: 24 },
  columnHeaderQty: { width: 56, color: colors.muted, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8, textAlign: 'center' },
  columnHeaderRemoveSpacer: { width: 40 },
  pieces: { gap: 8 },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 4,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 15,
  },
  pieceIndex: { width: 22, color: colors.muted, fontFamily: fonts.bold, fontSize: 12 },
  pieceInput: {
    flex: 1,
    height: 44,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 0,
    color: colors.ink,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  qtyInput: {
    width: 56,
    height: 44,
    paddingHorizontal: 6,
    color: colors.ink,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    fontFamily: fonts.semibold,
    fontSize: 15,
    textAlign: 'center',
  },
  removeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  emptyPieces: { paddingVertical: 14, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
});
