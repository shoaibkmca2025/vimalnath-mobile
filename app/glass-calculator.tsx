import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { computeGlassPlan, parsePanelCount, type GlassPlanResult } from '@/lib/glass-calculator';
import { buildGlassPlanHtml } from '@/lib/glass-plan-pdf';
import { pdfFileName, savePdf, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, fonts, type } from '@/theme';

const digitsOnly = (text: string) => text.replace(/[^0-9]/g, '');

export default function GlassCalculatorScreen() {
  const { showToast } = useAppUI();
  const { name, eyebrow, fallbackRoute } = useLocalSearchParams<{ name?: string; eyebrow?: string; fallbackRoute?: string }>();
  const systemName = name ?? 'Sliding System';
  const panelCount = parsePanelCount(systemName);

  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [result, setResult] = useState<GlassPlanResult | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallbackRoute ?? '/cutlist');
  };

  const calculate = () => {
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0) || !(h > 0)) {
      showToast('Enter the width and height first.');
      return;
    }
    const outcome = computeGlassPlan(systemName, w, h, panelCount);
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
      showToast(`Could not create the PDF: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to configurations"
          style={({ pressed }) => [styles.back, pressed && { backgroundColor: colors.blueTint }]}
        >
          <Feather name="arrow-left" size={21} color={colors.ink} />
        </Pressable>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.eyebrow}>{eyebrow ?? 'CUTLIST SYSTEM'}</Text>
          <Text style={[type.title, { fontSize: 24, lineHeight: 28 }]} numberOfLines={1} accessibilityRole="header">
            {systemName}
          </Text>
        </View>
      </View>

      {sizeError && (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Feather name="alert-triangle" size={18} color={colors.red} />
          <Text style={styles.errorBannerText}>{sizeError}</Text>
        </View>
      )}

      <LinearGradient colors={['#2458e8', '#173e9e']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{systemName}</Text>
          <Text style={styles.heroSubtitle}>Glass Cutting & Material Calculator</Text>
        </View>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="door-sliding" size={30} color={colors.white} />
        </View>
      </LinearGradient>

      <View style={styles.card}>
        <DimensionField
          icon="arrow-expand-horizontal"
          label="Width (mm)"
          value={width}
          onChangeText={(text) => {
            setWidth(digitsOnly(text));
            setSizeError(null);
          }}
          accessibilityLabel="Opening width in millimetres"
        />
        <DimensionField
          icon="arrow-expand-vertical"
          label="Height (mm)"
          value={height}
          onChangeText={(text) => {
            setHeight(digitsOnly(text));
            setSizeError(null);
          }}
          accessibilityLabel="Opening height in millimetres"
        />
        <PrimaryButton label="Calculate" onPress={calculate} />
      </View>

      {result && (
        <View style={styles.results}>
          <ResultCard
            tone="blue"
            icon="window-closed-variant"
            title="Glass Size"
            value={`${result.glassWidth} × ${result.glassHeight} mm`}
            note={`Qty ${result.glassQuantity}`}
          />
          <ResultCard
            tone="green"
            icon="content-cut"
            title="Cutting Size"
            value={`${result.cuttingWidth} × ${result.cuttingHeight} mm`}
            note="(Per Panel)"
          />

          <View style={[styles.resultCard, styles.materialCard]}>
            <View style={[styles.resultIcon, { backgroundColor: colors.purpleTint }]}>
              <Feather name="list" size={19} color={colors.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>Material List</Text>
              <View style={styles.materialRows}>
                {result.materials.map((item) => (
                  <MaterialRow key={item.label} label={item.label} value={item.value} note={item.note} />
                ))}
              </View>
            </View>
          </View>

          <View style={styles.exportRow}>
            <ExportButton
              label="Share PDF"
              icon="share-2"
              hint="WhatsApp, email and more"
              tone="dark"
              loading={busy === 'share'}
              disabled={busy !== null}
              onPress={() => exportPdf('share')}
            />
            <ExportButton
              label="Save PDF"
              icon="download"
              hint="Save to phone storage"
              tone="blue"
              loading={busy === 'save'}
              disabled={busy !== null}
              onPress={() => exportPdf('save')}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

type DimensionFieldProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
};

function DimensionField({ icon, label, value, onChangeText, accessibilityLabel }: DimensionFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <View style={styles.fieldIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.blue} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={[styles.input, focused && styles.inputFocused]}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder="e.g. 1200"
            placeholderTextColor={colors.subtle}
            keyboardType="number-pad"
            returnKeyType="done"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={accessibilityLabel}
            style={styles.inputText}
          />
          <Text style={styles.inputUnit}>mm</Text>
        </View>
      </View>
    </View>
  );
}

type ResultCardProps = {
  tone: 'blue' | 'green';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  value: string;
  note: string;
};

function ResultCard({ tone, icon, title, value, note }: ResultCardProps) {
  const tint = tone === 'blue' ? colors.blueTint : colors.greenTint;
  const accent = tone === 'blue' ? colors.blue : colors.green;
  return (
    <View style={styles.resultCard}>
      <View style={[styles.resultIcon, { backgroundColor: tint }]}>
        <MaterialCommunityIcons name={icon} size={19} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.resultTitle}>{title}</Text>
        <Text style={[styles.resultValue, { color: accent }]}>{value}</Text>
        <Text style={styles.resultNote}>{note}</Text>
      </View>
    </View>
  );
}

type ExportButtonProps = {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  hint: string;
  tone: 'dark' | 'blue';
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
};

function ExportButton({ label, icon, hint, tone, loading, disabled, onPress }: ExportButtonProps) {
  const base = tone === 'dark' ? colors.ink : colors.blue;
  const pressedColor = tone === 'dark' ? '#000000' : colors.blueDark;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.exportButton,
        { backgroundColor: pressed && !disabled ? pressedColor : base },
        disabled && !loading && styles.exportButtonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Feather name={icon} size={17} color={colors.white} />
          <Text style={styles.exportButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function MaterialRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.materialRow}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.materialLabel}>{label}</Text>
        {note && <Text style={styles.materialNote}>{note}</Text>}
      </View>
      <Text style={styles.materialValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    marginBottom: 18,
    backgroundColor: colors.redTint,
    borderWidth: 1,
    borderColor: '#f6c6c3',
    borderRadius: 14,
  },
  errorBannerText: { flex: 1, color: colors.red, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    marginBottom: 18,
    borderRadius: 20,
    boxShadow: '0 10px 24px rgba(36, 88, 232, 0.28)',
  },
  heroTitle: { color: colors.white, fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  heroSubtitle: { marginTop: 4, color: 'rgba(255,255,255,0.85)', fontFamily: fonts.medium, fontSize: 13 },
  heroIcon: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
  },
  card: {
    padding: 18,
    marginBottom: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    boxShadow: '0 5px 15px rgba(20, 30, 50, 0.05)',
    gap: 16,
  },
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  fieldIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blueTint, borderRadius: 12 },
  fieldLabel: { marginBottom: 8, color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  input: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
  },
  inputFocused: { borderColor: '#a9bdf8', backgroundColor: colors.blueWash },
  inputText: { flex: 1, height: '100%', minWidth: 0, padding: 0, color: colors.ink, fontFamily: fonts.bold, fontSize: 16 },
  inputUnit: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  results: { gap: 12 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: colors.blueTint,
    borderRadius: 16,
  },
  materialCard: { backgroundColor: colors.purpleTint },
  resultIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  resultTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  resultValue: { marginTop: 4, fontFamily: fonts.display, fontSize: 19, letterSpacing: -0.3 },
  resultNote: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  materialRows: { marginTop: 10, gap: 8 },
  materialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16,24,39,0.1)',
  },
  materialLabel: { flexShrink: 1, color: colors.ink, fontFamily: fonts.medium, fontSize: 13 },
  materialNote: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 11 },
  materialValue: { color: colors.muted, fontFamily: fonts.semibold, fontSize: 13 },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  exportButton: {
    flex: 1,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 15,
  },
  exportButtonDisabled: { opacity: 0.6 },
  exportButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
});
