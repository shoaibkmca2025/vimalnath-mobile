import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { View } from 'react-native';

export type NavKey = 'home' | 'catalog' | 'bar' | 'cutlist';

/** One icon per primary destination, shared by the tab bar and the drawer. */
export function NavIcon({ name, size, color }: { name: NavKey; size: number; color: string }) {
  // Fixed box so the slightly larger MaterialCommunityIcons glyph doesn't shift neighbouring labels.
  return (
    <View style={{ width: size + 2, height: size + 2, alignItems: 'center', justifyContent: 'center' }}>
      {name === 'bar' ? (
        <MaterialCommunityIcons name="ruler" size={size + 2} color={color} />
      ) : (
        <Feather name={featherNames[name]} size={size} color={color} />
      )}
    </View>
  );
}

const featherNames = { home: 'home', catalog: 'book-open', cutlist: 'scissors' } as const;

export const primaryNav: { key: NavKey; route: string; href: '/' | '/catalog' | '/bar-optimizer' | '/cutlist'; label: string; drawerLabel: string }[] = [
  { key: 'home', route: 'index', href: '/', label: 'Home', drawerLabel: 'Home' },
  { key: 'catalog', route: 'catalog', href: '/catalog', label: 'Catalog', drawerLabel: 'Product catalog' },
  { key: 'bar', route: 'bar-optimizer', href: '/bar-optimizer', label: 'Bar optimizer', drawerLabel: 'Bar optimizer' },
  { key: 'cutlist', route: 'cutlist', href: '/cutlist', label: 'Cutlist', drawerLabel: 'Cutlist projects' },
];
