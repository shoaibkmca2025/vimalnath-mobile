import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { confirmDestructive } from '@/lib/confirm';
import { SIZE_UNIT_KEY, UNIT_OPTIONS, type LengthUnit } from '@/lib/length-units';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { useOrders } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

export default function SettingsScreen() {
  const { showToast } = useAppUI();
  const { count, clear } = useCart();
  const { orders, clearOrders } = useOrders();
  const [unit, setUnit] = useState<LengthUnit>('mm');

  useEffect(() => {
    AsyncStorage.getItem(SIZE_UNIT_KEY)
      .then((saved) => (saved === 'in' || saved === 'mm') && setUnit(saved))
      .catch(() => {});
  }, []);

  const changeUnit = (next: LengthUnit) => {
    setUnit(next);
    AsyncStorage.setItem(SIZE_UNIT_KEY, next).catch(() => {});
  };

  return (
    <Screen title="Settings" back={{ fallback: '/', label: 'Back' }} grouped>
      <InsetGroup header="Size unit" footer="The unit the glass calculator and bar optimizer start in. You can still switch on each screen.">
        <View style={styles.unitRow}>
          <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={changeUnit} accessibilityLabel="Default size unit" />
        </View>
      </InsetGroup>

      <InsetGroup header="Data on this phone">
        <DestructiveRow
          label="Clear Cart"
          detail={count ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
          disabled={!count}
          onPress={() =>
            confirmDestructive('Clear the cart?', 'All items in your cart will be removed.', 'Clear Cart', () => {
              clear();
              showToast('Your cart is now empty.');
            })
          }
        />
        <DestructiveRow
          label="Clear Order History"
          detail={orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'}` : 'None'}
          disabled={!orders.length}
          onPress={() =>
            confirmDestructive('Clear order history?', 'Every saved order will be deleted from this phone. This can’t be undone.', 'Delete Orders', () => {
              clearOrders();
              showToast('Order history cleared.');
            })
          }
        />
      </InsetGroup>

      <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </Screen>
  );
}

function DestructiveRow({ label, detail, disabled, onPress }: { label: string; detail: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${label}, ${detail}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={[styles.rowLabel, disabled && { color: colors.tertiaryLabel }]}>{label}</Text>
      <Text style={styles.rowDetail}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  unitRow: { padding: 12 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  rowPressed: { backgroundColor: colors.fill },
  rowLabel: { ...type.body, flex: 1, color: colors.red },
  rowDetail: { ...type.body, color: colors.secondaryLabel },
  version: { ...type.footnote, color: colors.secondaryLabel, textAlign: 'center' },
});
