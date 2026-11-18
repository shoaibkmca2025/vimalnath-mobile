import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { useAppContent } from '@/lib/content-sync';
import { colors, fonts, radius, type } from '@/theme';

type Contact = { icon: ComponentProps<typeof Ionicons>['name']; label: string; hint: string; url: string };

const FEATURES = [
  'Shop Taiton hardware, partitions and sliding systems with catalogue prices',
  'Place orders and share them as PDF',
  'Glass cutting sizes and material lists for telescopic, synchronized and folding systems, in mm or inches',
  'Bar optimizer to cut pieces from standard bars with the least waste',
];

export default function AboutScreen() {
  // The shop's details from the admin (Module 9), synced to the phone (Module 11). Rows show only once filled in.
  const { settings } = useAppContent();
  const contacts = [
    settings.phone && { icon: 'call-outline', label: settings.phone, hint: 'Calls the shop', url: `tel:${settings.phone.replace(/[^\d+]/g, '')}` },
    settings.email && { icon: 'mail-outline', label: settings.email, hint: 'Writes an email', url: `mailto:${settings.email}` },
    settings.website && { icon: 'globe-outline', label: settings.website.replace(/^https:\/\//, ''), hint: 'Opens the website', url: settings.website },
    settings.address && { icon: 'location-outline', label: settings.address, hint: 'Opens the address in maps', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}` },
  ].filter(Boolean) as Contact[];

  return (
    <Screen title="About" back={{ fallback: '/', label: 'Back' }} grouped>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Image cachePolicy="memory-disk" source={settings.logo} style={styles.logoImage} contentFit="cover" />
        </View>
        <Text style={styles.name}>Vimalnath</Text>
        <Text style={styles.tagline}>SALES CORPORATION</Text>
      </View>

      <InsetGroup header="What you can do">
        {FEATURES.map((feature) => (
          <View key={feature} style={styles.feature}>
            <View style={styles.dot} />
            <Text style={styles.featureText}>{feature}</Text>
          </View>
        ))}
      </InsetGroup>

      {contacts.length > 0 && (
        <InsetGroup header="Contact" separatorInset={50}>
          {contacts.map((contact) => (
            <Pressable
              key={contact.icon}
              onPress={() => Linking.openURL(contact.url).catch(() => {})}
              accessibilityRole="link"
              accessibilityHint={contact.hint}
              style={({ pressed }) => [styles.contact, pressed && styles.contactPressed]}
            >
              <Ionicons name={contact.icon} size={20} color={colors.tint} />
              <Text style={styles.contactText}>{contact.label}</Text>
            </Pressable>
          ))}
        </InsetGroup>
      )}

      <InsetGroup>
        <ValueRow label="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        <ValueRow label="Developed by" value={settings.developer} />
      </InsetGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 84, height: 84, overflow: 'hidden', backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
  logoImage: { width: '100%', height: '100%' },
  name: { marginTop: 12, color: colors.label, fontFamily: fonts.brand, fontSize: 26, lineHeight: 30 },
  tagline: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel, fontWeight: '600', letterSpacing: 1 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  dot: { width: 6, height: 6, marginTop: 7, backgroundColor: colors.tint, borderRadius: 3 },
  featureText: { ...type.subheadline, flex: 1 },
  contact: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 },
  contactPressed: { backgroundColor: colors.fill },
  contactText: { ...type.body, flex: 1, color: colors.tint },
});
