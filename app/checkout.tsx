import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ADDRESS_TYPE, AddressFields, addressErrors, addressLine, AddressSummary, type AddressDraft } from '@/components/AddressFields';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { findShopProduct, formatINR, productTitle } from '@/data/shop';
import { fetchAccount, saveProfile, savedProfile, type Profile, type SavedAddress } from '@/lib/admin-sync';
import { needsUpdate, stockOf, useAppContent } from '@/lib/content-sync';
import { formatPhone, isFullPhone } from '@/lib/format';
import { gstinProblem, HOME_STATE } from '@/lib/india';
import { useAppUI } from '@/providers/AppUIProvider';
import { unitPrice, useCart } from '@/providers/CartProvider';
import { useOrders, type Delivery } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

/** Which address the order goes to: a saved one (as saved, or changed for this order only), or one typed now. */
type Choice = { kind: 'saved'; id: number; edited: boolean } | { kind: 'new' };
type Recipient = { receiverName: string; contact: string; alternateContact: string; siteName: string };
const blankAddress: AddressDraft = { addressLine: '', area: '', landmark: '', city: '', state: HOME_STATE, pincode: '' };

/** The shop's details checkout needs (name, shop, mobile, shop address); what's missing is asked for here, once. */
const missingOf = (profile: Profile | null) => {
  if (!profile) return ['name', 'business', 'shop address'];
  const missing: string[] = [];
  if (!profile.name?.trim()) missing.push('name');
  if (!profile.business?.trim()) missing.push('shop name');
  if (!profile.addressLine?.trim() || !profile.city?.trim() || !profile.state || !/^\d{6}$/.test(profile.pincode ?? '')) missing.push('shop address');
  return missing;
};

/**
 * Checkout: the customer and their shop from the profile (nothing typed twice), where it goes (the shop, a saved
 * address, or a site for this order only), the items with their prices and the GST inside them, and one Place Order.
 * The order keeps a copy of the address, so later profile changes never move it. One tap places one order, however
 * often it's pressed or the network retries.
 */
export default function CheckoutScreen() {
  const { showToast } = useAppUI();
  const { lines, count, clear } = useCart();
  const { placeOrder } = useOrders();
  const { settings, stock, gstRates } = useAppContent();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [completing, setCompleting] = useState<Profile | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [recipient, setRecipient] = useState<Recipient>({ receiverName: '', contact: '', alternateContact: '', siteName: '' });
  const [address, setAddress] = useState<AddressDraft>(blankAddress);
  const [instructions, setInstructions] = useState('');
  const [save, setSave] = useState(false);
  const [saveAs, setSaveAs] = useState<'site' | 'home' | 'other'>('site');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const [placing, setPlacing] = useState(false);
  const placed = useRef(false);

  // The profile as this phone has it at once, then the shop's copy with the address book.
  useEffect(() => {
    let active = true;
    void savedProfile().then((saved) => active && saved && setProfile((current) => current ?? saved));
    fetchAccount().then(
      (account) => {
        if (!active) return;
        setProfile(account.profile);
        setAddresses(account.addresses);
      },
      () => {
        if (!active) return;
        setOffline(true);
        setAddresses([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // The default address is chosen to start with; with none saved, the shop's own address (or a new one).
  useEffect(() => {
    if (choice || !addresses || !profile) return;
    const first = addresses.find((one) => one.isDefault) ?? addresses[0];
    if (first) pick({ kind: 'saved', id: first.id, edited: false }, first);
    else {
      setChoice({ kind: 'new' });
      setRecipient({ receiverName: profile.name ?? '', contact: formatPhone(profile.phone ?? ''), alternateContact: '', siteName: '' });
      setAddress(profile.addressLine ? { addressLine: profile.addressLine ?? '', area: profile.area ?? '', landmark: profile.landmark ?? '', city: profile.city ?? '', state: profile.state || HOME_STATE, pincode: profile.pincode ?? '' } : { ...blankAddress, city: profile.city ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, profile]);

  const pick = (next: Choice, saved?: SavedAddress) => {
    setChoice(next);
    if (next.kind === 'saved' && saved) {
      setRecipient({ receiverName: saved.receiverName, contact: formatPhone(saved.contactNumber), alternateContact: formatPhone(saved.alternateContact), siteName: saved.siteName });
      setAddress({ addressLine: saved.addressLine, area: saved.area, landmark: saved.landmark, city: saved.city, state: saved.state, pincode: saved.pincode });
    }
    if (next.kind === 'new') {
      setRecipient({ receiverName: profile?.name ?? '', contact: formatPhone(profile?.phone ?? ''), alternateContact: '', siteName: '' });
      setAddress({ ...blankAddress, city: profile?.city ?? '' });
      setSave(false);
    }
  };

  // ---------- Prices: MRP, GST inside them, at the rates the shop keeps ----------
  const rows = useMemo(
    () =>
      lines.map((line) => {
        const product = findShopProduct(line.productId);
        const option = line.optionIndex === undefined ? undefined : product?.options?.[line.optionIndex];
        const price = unitPrice(line);
        const rate = gstRates[line.productId]?.[option?.label ?? ''];
        const total = price === undefined ? undefined : price * line.qty;
        return { line, title: product ? productTitle(product) : line.productId, option: option?.label, price, total, rate, gst: total !== undefined && rate !== undefined ? total - total / (1 + rate / 100) : undefined };
      }),
    [lines, gstRates],
  );
  const subtotal = rows.reduce((sum, row) => sum + (row.total ?? 0), 0);
  const gst = rows.reduce((sum, row) => sum + (row.gst ?? 0), 0);
  const unpriced = rows.filter((row) => row.total === undefined).length;
  const withoutRate = rows.filter((row) => row.total !== undefined && row.rate === undefined).length;
  const outdated = needsUpdate(settings.minAppVersion);
  const outOfStock = lines.filter((line) => {
    const option = line.optionIndex === undefined ? undefined : findShopProduct(line.productId)?.options?.[line.optionIndex];
    return stockOf(stock, line.productId, option?.label) === 'out';
  }).length;

  // ---------- Checks ----------
  const missing = missingOf(profile);
  const editing = choice?.kind === 'new' || (choice?.kind === 'saved' && choice.edited);
  const errors = {
    ...(editing ? addressErrors(address) : {}),
    receiverName: editing && !recipient.receiverName.trim() ? 'Enter who receives the goods.' : undefined,
    contact: editing && !isFullPhone(recipient.contact) ? 'Enter the 10-digit contact number.' : undefined,
    alternateContact: editing && recipient.alternateContact && !isFullPhone(recipient.alternateContact) ? 'Enter all 10 digits, or leave it empty.' : undefined,
  };
  const problems = Object.values(errors).filter(Boolean).length;
  const ready = Boolean(profile) && missing.length === 0 && Boolean(choice) && problems === 0 && !outdated && outOfStock === 0 && lines.length > 0;

  const place = () => {
    setTouched(true);
    if (placed.current || placing) return;
    if (missing.length) {
      setCompleting({ ...(profile ?? { name: '', business: '', phone: '', email: '', city: '' }), state: profile?.state || HOME_STATE });
      showToast('Complete your shop details first.');
      return;
    }
    if (!ready || !profile || !choice) {
      showToast(problems ? 'Check the delivery address.' : 'This order can’t be placed yet.');
      return;
    }
    placed.current = true;
    setPlacing(true);
    const saved = choice.kind === 'saved' ? addresses?.find((one) => one.id === choice.id) : undefined;
    const delivery: Delivery = {
      type: choice.kind === 'saved' && !choice.edited ? 'saved' : recipient.siteName.trim() ? 'site' : 'temporary',
      addressId: choice.kind === 'saved' && !choice.edited ? choice.id : undefined,
      receiverName: recipient.receiverName.trim(),
      contact: recipient.contact.replace(/\D/g, ''),
      alternateContact: recipient.alternateContact.replace(/\D/g, ''),
      siteName: recipient.siteName.trim(),
      addressLine: address.addressLine.trim(),
      area: address.area.trim(),
      landmark: address.landmark.trim(),
      city: address.city.trim(),
      state: address.state,
      pincode: address.pincode.trim(),
      instructions: instructions.trim(),
      ...(choice.kind === 'new' && save ? { save: true, saveAs, label: label.trim() || recipient.siteName.trim() } : {}),
    };
    const line = addressLine(delivery);
    // The order's own copy; the notes also carry the address for a shop server from before checkout.
    const order = placeOrder(lines, {
      customer: profile.business?.trim() || profile.name.trim(),
      phone: formatPhone(profile.phone ?? ''),
      notes: [`Deliver to: ${delivery.receiverName}, ${formatPhone(delivery.contact)}${delivery.siteName ? `, ${delivery.siteName}` : ''}, ${line}`, delivery.instructions].filter(Boolean).join(' · '),
      delivery,
    });
    clear();
    router.replace({ pathname: '/order-placed/[id]', params: { id: order.id, saved: saved ? '1' : '' } });
  };

  if (!lines.length && !placing)
    return (
      <Screen title="Checkout" back={{ fallback: '/cart' }} grouped>
        <EmptyState icon="cart-outline" title="Your Cart Is Empty" message="Add products to place an order." action={{ label: 'Browse Products', onPress: () => router.navigate('/') }} />
      </Screen>
    );

  return (
    <Screen title="Checkout" back={{ fallback: '/cart', label: 'Cart' }} grouped>
      {/* Who's ordering: from the profile, not typed again. */}
      <InsetGroup header="Ordering as" footer={missing.length ? undefined : 'From your profile. Change it under User.'}>
        {!profile ? (
          <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />
        ) : (
          <>
            <ValueRow label="Name" value={profile.name || '—'} />
            <ValueRow label="Shop" value={profile.business || '—'} />
            <ValueRow label="Mobile" value={formatPhone(profile.phone ?? '') || '—'} />
            {profile.gstin ? <ValueRow label="GSTIN" value={profile.gstin} /> : null}
            {profile.addressLine ? <ValueRow label="Shop address" value={addressLine({ addressLine: profile.addressLine, area: profile.area, landmark: profile.landmark, city: profile.city ?? '', state: profile.state ?? '', pincode: profile.pincode ?? '' })} /> : null}
          </>
        )}
      </InsetGroup>
      {profile && missing.length > 0 && (
        <View style={styles.alert} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={20} color={colors.orange} />
          <View style={styles.flex}>
            <Text style={styles.alertText}>Your {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} missing. Add {missing.length === 1 ? 'it' : 'them'} once to order.</Text>
            {!completing && <Button label="Complete Shop Details" size="medium" variant="tinted" onPress={() => setCompleting({ ...profile, state: profile.state || HOME_STATE })} style={styles.alertButton} />}
          </View>
        </View>
      )}
      {completing && (
        <CompleteProfile
          value={completing}
          onChange={setCompleting}
          onDone={(next) => {
            setProfile(next);
            setCompleting(null);
            void saveProfile(next);
            showToast('Your shop details are saved.');
          }}
        />
      )}

      {/* Where it goes. */}
      <InsetGroup header="Deliver to" separatorInset={62} footer={offline ? 'Saved addresses need a connection; you can still type the address.' : undefined}>
        {!addresses ? (
          <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} />
        ) : (
          <>
            {addresses.map((saved) => (
              <AddressSummary key={saved.id} address={saved} selected={choice?.kind === 'saved' && choice.id === saved.id} onPress={() => pick({ kind: 'saved', id: saved.id, edited: false }, saved)} />
            ))}
            <Pressable onPress={() => pick({ kind: 'new' })} accessibilityRole="radio" accessibilityState={{ selected: choice?.kind === 'new' }} style={({ pressed }) => [styles.newRow, pressed && styles.pressed]}>
              <View style={[styles.newIcon, choice?.kind === 'new' && styles.newIconSelected]}>
                <Ionicons name="add" size={20} color={choice?.kind === 'new' ? colors.white : colors.tint} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.newTitle}>Another address or site</Text>
                <Text style={styles.newDetail}>For this order only, unless you save it.</Text>
              </View>
              <Ionicons name={choice?.kind === 'new' ? 'radio-button-on' : 'radio-button-off'} size={22} color={choice?.kind === 'new' ? colors.tint : colors.tertiaryLabel} />
            </Pressable>
          </>
        )}
      </InsetGroup>

      {choice?.kind === 'saved' && !choice.edited && (
        <Button label="Change for This Order" variant="plain" size="medium" icon="create-outline" onPress={() => setChoice({ ...choice, edited: true })} style={styles.inlineButton} accessibilityHint="Edits the delivery details for this order only; your saved address stays as it is" />
      )}

      {editing && (
        <View style={styles.form}>
          <View style={styles.tempNote}>
            <Ionicons name="time-outline" size={16} color={colors.orange} />
            <Text style={styles.tempText}>{choice?.kind === 'saved' ? 'Changed for this order only: your saved address stays as it is.' : 'For this order only: your shop’s address in your profile isn’t changed.'}</Text>
          </View>
          <TextField label="Receiver’s name" value={recipient.receiverName} onChangeText={(text) => setRecipient({ ...recipient, receiverName: text })} error={touched ? errors.receiverName : undefined} autoCapitalize="words" textContentType="name" />
          <View style={styles.rowFields}>
            <View style={styles.flex}>
              <TextField label="Contact number" value={recipient.contact} onChangeText={(text) => setRecipient({ ...recipient, contact: formatPhone(text) })} error={touched ? errors.contact : undefined} keyboardType="number-pad" placeholder="98220 12345" />
            </View>
            <View style={styles.flex}>
              <TextField label="Alternate (optional)" value={recipient.alternateContact} onChangeText={(text) => setRecipient({ ...recipient, alternateContact: formatPhone(text) })} error={touched ? errors.alternateContact : undefined} keyboardType="number-pad" />
            </View>
          </View>
          <TextField label="Site or project name (optional)" value={recipient.siteName} onChangeText={(text) => setRecipient({ ...recipient, siteName: text })} placeholder="e.g. Kulkarni Bungalow" autoCapitalize="words" />
          <AddressFields value={address} onChange={setAddress} errors={touched ? errors : {}} lineLabel="Delivery address" />
          {choice?.kind === 'new' && (
            <View style={styles.saveBox}>
              <View style={styles.saveRow}>
                <Text style={styles.saveLabel}>Save this address to my saved addresses</Text>
                <Switch value={save} onValueChange={setSave} accessibilityLabel="Save this address to my saved addresses" trackColor={{ true: colors.green, false: colors.fill }} thumbColor={colors.white} />
              </View>
              {save && (
                <>
                  <SegmentedControl
                    options={(['site', 'home', 'other'] as const).map((value) => ({ value, label: ADDRESS_TYPE[value].label }))}
                    value={saveAs}
                    onChange={setSaveAs}
                    accessibilityLabel="Save as"
                  />
                  <TextField label="Name it (optional)" value={label} onChangeText={setLabel} placeholder="e.g. Gangapur Road site" />
                </>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.form}>
        <TextField label="Delivery instructions (optional)" value={instructions} onChangeText={setInstructions} placeholder="e.g. Deliver after 11 am, call before coming" multiline maxLength={500} />
      </View>

      {/* What's in it. */}
      <InsetGroup header={`Items · ${count}`}>
        {rows.map((row, index) => (
          <View key={index} style={styles.item}>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{row.title}</Text>
              {row.option ? <Text style={styles.itemDetail}>{row.option}</Text> : null}
              <Text style={styles.itemDetail}>
                {row.line.qty} × {row.price === undefined ? 'priced from catalogue' : formatINR(row.price)}
                {row.rate !== undefined ? ` · GST ${row.rate}%` : ''}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{row.total === undefined ? '—' : formatINR(row.total)}</Text>
          </View>
        ))}
      </InsetGroup>

      <InsetGroup
        header="Summary"
        footer={[
          'Prices are MRP, GST included. Any discount and the delivery charge are set by the shop on your tax invoice.',
          unpriced ? `${unpriced} line${unpriced === 1 ? ' is' : 's are'} priced from the catalogue and not in the total.` : '',
          withoutRate ? `GST shown for items with a known rate.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <ValueRow label="Subtotal (MRP)" value={formatINR(subtotal)} />
        {gst > 0 && <ValueRow label="GST included" value={formatINR(Math.round(gst * 100) / 100)} />}
        <ValueRow label="Discount" value="On your invoice" />
        <ValueRow label="Delivery charges" value="Confirmed by the shop" />
        <ValueRow label="Grand total (MRP)" value={formatINR(subtotal)} emphasized />
      </InsetGroup>

      {(outdated || outOfStock > 0) && (
        <View style={styles.alert} accessibilityRole="alert">
          <Ionicons name="close-circle" size={20} color={colors.red} />
          <Text style={[styles.alertText, styles.flex]}>{outdated ? 'Update the app to place orders.' : `${outOfStock === 1 ? 'One item is' : `${outOfStock} items are`} out of stock. Remove ${outOfStock === 1 ? 'it' : 'them'} from the cart.`}</Text>
        </View>
      )}

      <Button label="Place Order" onPress={place} loading={placing} loadingLabel="Placing order…" disabled={placing || outdated || outOfStock > 0} accessibilityHint="Sends the order to Vimalnath" />
      <Text style={styles.finePrint}>{choice ? `Delivers to ${choice.kind === 'saved' && !choice.edited ? 'your saved address' : 'the address above'}${recipient.receiverName ? `, for ${recipient.receiverName}` : ''}.` : ''}</Text>
    </Screen>
  );
}

/** The shop's details an older account lacks: asked for once at checkout, then kept in the profile. */
function CompleteProfile({ value, onChange, onDone }: { value: Profile; onChange: (profile: Profile) => void; onDone: (profile: Profile) => void }) {
  const [tried, setTried] = useState(false);
  const draft: AddressDraft = { addressLine: value.addressLine ?? '', area: value.area ?? '', landmark: value.landmark ?? '', city: value.city ?? '', state: value.state ?? HOME_STATE, pincode: value.pincode ?? '' };
  const errors = {
    ...addressErrors(draft),
    name: value.name?.trim() ? undefined : 'Enter your name.',
    business: value.business?.trim() ? undefined : 'Enter your shop’s name.',
    gstin: gstinProblem(value.gstin ?? ''),
  };
  const done = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    onDone({ ...value, gstin: (value.gstin ?? '').trim().toUpperCase() });
  };
  return (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Your shop details</Text>
      <TextField label="Your name" value={value.name} onChangeText={(name) => onChange({ ...value, name })} error={tried ? errors.name : undefined} autoCapitalize="words" />
      <TextField label="Shop name" value={value.business} onChangeText={(business) => onChange({ ...value, business })} error={tried ? errors.business : undefined} autoCapitalize="words" />
      <TextField label="GSTIN (optional)" value={value.gstin ?? ''} onChangeText={(gstin) => onChange({ ...value, gstin: gstin.toUpperCase() })} error={tried ? errors.gstin : undefined} autoCapitalize="characters" maxLength={15} />
      <AddressFields value={draft} onChange={(next) => onChange({ ...value, ...next })} errors={tried ? errors : {}} lineLabel="Shop address" />
      <Button label="Save Shop Details" onPress={done} />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: 16 },
  flex: { flex: 1, minWidth: 0 },
  alert: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16, marginHorizontal: 16, padding: 14, borderRadius: 12, backgroundColor: colors.orangeFill },
  alertText: { ...type.subheadline, color: colors.label },
  alertButton: { alignSelf: 'flex-start', marginTop: 10 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  newIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.tintFill },
  newIconSelected: { backgroundColor: colors.tint },
  newTitle: { ...type.body, fontWeight: '600' },
  newDetail: { ...type.subheadline, color: colors.secondaryLabel },
  pressed: { backgroundColor: colors.fill },
  inlineButton: { alignSelf: 'flex-start', marginTop: -8, marginBottom: 12, marginLeft: 8 },
  form: { gap: 12, marginBottom: 20, paddingHorizontal: 16 },
  formTitle: { ...type.headline },
  tempNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.orangeFill },
  tempText: { ...type.footnote, flex: 1, color: colors.orange, fontWeight: '600' },
  rowFields: { flexDirection: 'row', gap: 12 },
  saveBox: { gap: 12, padding: 12, borderRadius: 12, backgroundColor: colors.card },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  saveLabel: { ...type.body, flex: 1 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, paddingHorizontal: 16 },
  itemTitle: { ...type.body, fontWeight: '500' },
  itemDetail: { ...type.footnote, color: colors.secondaryLabel },
  itemTotal: { ...type.body, fontWeight: '600' },
  finePrint: { ...type.footnote, marginTop: 8, marginBottom: 24, textAlign: 'center', color: colors.secondaryLabel },
});
