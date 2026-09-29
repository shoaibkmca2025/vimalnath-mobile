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
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SectionPickerSheet } from '@/components/SectionPickerSheet';
import { sections, type Section } from '@/data/sections';
import { planBars, type BarPlan } from '@/lib/bar-optimizer';
import { buildBarPlanHtml } from '@/lib/bar-plan-pdf';
import { withTimeout } from '@/lib/pdf-html';
import { formatMm, pad2 } from '@/lib/format';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

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
  // until the next "Calculate" tap, even after the app is closed and reopened.
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
        {barLengths.length > 0 && <ColumnHeader />}
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
        <AddRow label="Add Bar Length" onPress={addBarLength} />
      </InsetGroup>

      <InsetGroup header="Cutting loss" footer="Material lost to the saw blade on each cut.">
        <View style={styles.kerfRow}>
          <Text style={type.body}>Per cut</Text>
          <TextInput
            value={kerf}
            onChangeText={(text) => setKerf(decimalOnly(text))}
            keyboardType="decimal-pad"
            returnKeyType="done"
            selectTextOnFocus
            selectionColor={colors.tint}
            accessibilityLabel="Cutting loss per cut in millimetres"
            style={styles.kerfInput}
          />
          <Text style={styles.unit}>mm</Text>
        </View>
      </InsetGroup>

      <InsetGroup header="Required pieces">
        {pieces.length > 0 && <ColumnHeader />}
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
        <AddRow label="Add Piece" onPress={addPiece} />
      </InsetGroup>

      <Button label="Calculate" onPress={calculate} />

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

function ColumnHeader() {
  return (
    <View style={styles.columnHeader} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.columnLabel, styles.columnLength]}>LENGTH (MM)</Text>
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
  rowPressed: { backgroundColor: colors.fill },
  select: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  profileMini: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  profileMiniFrame: { width: 17, height: 23, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', transform: [{ skewX: '-12deg' }] },
  selectName: { ...type.subheadline, marginTop: 1, color: colors.secondaryLabel },
  kerfRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  kerfInput: { ...type.body, flex: 1, minHeight: 46, padding: 0, textAlign: 'right' },
  unit: { ...type.body, color: colors.secondaryLabel },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 48, paddingRight: 4, paddingTop: 10, paddingBottom: 2 },
  columnLabel: { ...type.caption1, color: colors.secondaryLabel },
  columnLength: { flex: 1 },
  columnQty: { width: 60, textAlign: 'center' },
  columnRemove: { width: 44 },
  pieceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 16, paddingRight: 4 },
  pieceIndex: { ...type.footnote, width: 24, color: colors.secondaryLabel, fontVariant: ['tabular-nums'] },
  fieldInput: { ...type.body, height: 40, paddingVertical: 0, backgroundColor: colors.tertiaryFill, borderRadius: 8 },
  pieceInput: { flex: 1, minWidth: 0, paddingHorizontal: 12 },
  qtyInput: { width: 60, paddingHorizontal: 6, textAlign: 'center' },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  addRowText: { ...type.body, color: colors.tint },
});
