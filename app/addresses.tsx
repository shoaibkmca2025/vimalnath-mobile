import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AddressSummary } from '@/components/AddressFields';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { deleteAddress, fetchAccount, makeDefaultAddress, type SavedAddress } from '@/lib/admin-sync';
import { confirmDestructive } from '@/lib/confirm';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

/** My Saved Addresses: the shop, home and sites, one of them the default for delivery. */
export default function AddressesScreen() {
  const { showToast } = useAppUI();
  const [addresses, setAddresses] = useState<SavedAddress[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setAddresses((await fetchAccount()).addresses);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t load your addresses.');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (id: number, run: () => Promise<SavedAddress[]>, done: string) => {
    setBusy(id);
    try {
      setAddresses(await run());
      showToast(done);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Saved Addresses" back={{ fallback: '/user', label: 'Back' }} grouped>
      {error && !addresses ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t Load Addresses" message={error} action={{ label: 'Try Again', onPress: () => void load() }} />
      ) : !addresses ? (
        <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />
      ) : addresses.length === 0 ? (
        <EmptyState icon="location-outline" title="No Saved Addresses" message="Save your shop, home and sites here, and pick one at checkout." action={{ label: 'Add Address', onPress: () => router.push({ pathname: '/address/[id]', params: { id: 'new' } }) }} />
      ) : (
        <>
          {addresses.map((address) => (
            <InsetGroup key={address.id} separatorInset={16}>
              <AddressSummary address={address} onPress={() => router.push({ pathname: '/address/[id]', params: { id: String(address.id) } })} />
              <View style={styles.actions}>
                {!address.isDefault && (
                  <Pressable disabled={busy !== null} onPress={() => void act(address.id, () => makeDefaultAddress(address.id), 'Default address changed.')} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                    <Text style={styles.actionText}>Set as Default</Text>
                  </Pressable>
                )}
                <Pressable
                  disabled={busy !== null}
                  onPress={() =>
                    confirmDestructive('Delete this address?', 'Orders already placed keep their address.', 'Delete', () => void act(address.id, () => deleteAddress(address.id), 'Address deleted.'))
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                >
                  <Text style={[styles.actionText, styles.delete]}>Delete</Text>
                </Pressable>
              </View>
            </InsetGroup>
          ))}
          <Button label="Add Address" icon="add" onPress={() => router.push({ pathname: '/address/[id]', params: { id: 'new' } })} style={styles.add} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 32 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  action: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8 },
  actionText: { ...type.subheadline, color: colors.tint, fontWeight: '500' },
  delete: { color: colors.red },
  pressed: { backgroundColor: colors.fill },
  add: { marginBottom: 24 },
});
