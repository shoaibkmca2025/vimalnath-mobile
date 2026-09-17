import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { BarResultPanel } from '@/components/BarResultPanel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Pill, ScreenTitle } from '@/components/ScreenTitle';
import { SectionPickerSheet } from '@/components/SectionPickerSheet';
import { sections, type Section } from '@/data/sections';
import { planBars, type BarPlan } from '@/lib/bar-optimizer';
import { formatMm, pad2 } from '@/lib/format';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts, type } from '@/theme';

type PieceRow = { id: number; value: string };

const DEFAULT_PIECES = [2450, 2450, 1800, 1800];
const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');
const decimalOnly = (text: string) => text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

export default function BarOptimizerScreen() {
  const { showToast } = useAppUI();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(0);
  const makeRow = (value = ''): PieceRow => ({ id: nextId.current++, value });

  const [section, setSection] = useState<Section>(sections[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barLengths, setBarLengths] = useState<PieceRow[]>(() => [makeRow(String(sections[0].bar))]);
  const [barFocusRowId, setBarFocusRowId] = useState<number | null>(null);
  const [kerf, setKerf] = useState('3');
  const [pieces, setPieces] = useState<PieceRow[]>(() => DEFAULT_PIECES.map((length) => makeRow(String(length))));
  const [focusRowId, setFocusRowId] = useState<number | null>(null);
  const [plan, setPlan] = useState<BarPlan | null>(null);

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

  const addPiece = () => {
    const row = makeRow();
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
      lengths: pieces.map((row) => Number(row.value)),
      barLengths: barLengths.map((row) => Number(row.value)),
      kerf: Number(kerf) || 0,
    });
    if ('error' in result) {
      showToast(result.error);
      return;
    }
    pendingScroll.current = true;
    setPlan(result.plan);
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

      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <MaterialCommunityIcons name="ruler" size={21} color={colors.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.introTitle}>Find the right number of bars</Text>
          <Text style={styles.introBody}>Enter the pieces you need and we’ll arrange them against a standard bar.</Text>
        </View>
      </View>

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

        <View style={styles.pieces}>
          {barLengths.map((row, index) => (
            <RowInput
              key={row.id}
              index={index}
              value={row.value}
              autoFocus={row.id === barFocusRowId}
              placeholder="Bar length"
              accessibilityLabel={`Standard bar ${index + 1} length in millimetres`}
              removeAccessibilityLabel={`Remove standard bar ${index + 1}`}
              onChangeText={(text) => setBarLengths((rows) => rows.map((item) => (item.id === row.id ? { ...item, value: digitsOnly(text) } : item)))}
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

        <View style={styles.pieces}>
          {pieces.map((row, index) => (
            <RowInput
              key={row.id}
              index={index}
              value={row.value}
              autoFocus={row.id === focusRowId}
              placeholder="Piece length"
              accessibilityLabel={`Piece ${index + 1} length in millimetres`}
              removeAccessibilityLabel={`Remove piece ${index + 1}`}
              onChangeText={(text) => setPieces((rows) => rows.map((item) => (item.id === row.id ? { ...item, value: digitsOnly(text) } : item)))}
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
          <BarResultPanel plan={plan} onShare={sharePlan} onExport={() => showToast('Report export is ready to connect.')} />
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
  autoFocus: boolean;
  placeholder: string;
  accessibilityLabel: string;
  removeAccessibilityLabel: string;
  onChangeText: (text: string) => void;
  onRemove: () => void;
};

function RowInput({ index, value, autoFocus, placeholder, accessibilityLabel, removeAccessibilityLabel, onChangeText, onRemove }: RowInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.pieceRow}>
      <Text style={styles.pieceIndex}>{pad2(index + 1)}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        keyboardType="number-pad"
        returnKeyType="done"
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel}
        style={[styles.pieceInput, focused && styles.inputFocused]}
      />
      <Text style={styles.unit}>mm</Text>
      <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={removeAccessibilityLabel} style={styles.removeButton}>
        <Feather name="x" size={19} color="#a9b1bd" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 24,
    padding: 16,
    backgroundColor: colors.blueWash,
    borderWidth: 1,
    borderColor: '#e0e8ff',
    borderRadius: 16,
  },
  introIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dfe8ff', borderRadius: 12 },
  introTitle: { marginTop: 1, marginBottom: 3, color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  introBody: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
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
  removeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  emptyPieces: { paddingVertical: 14, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
});
