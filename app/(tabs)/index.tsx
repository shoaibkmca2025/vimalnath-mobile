import { StyleSheet, Text, View } from 'react-native';

import { HeroCard } from '@/components/HeroCard';
import { Screen } from '@/components/Screen';
import { colors, fonts, type } from '@/theme';

export default function HomeScreen() {
  return (
    <Screen>
      <View style={styles.welcome}>
        <View style={{ flexShrink: 1 }}>
          <Text style={type.eyebrow}>ARCHITECTURAL SYSTEMS</Text>
          <Text style={type.title} accessibilityRole="header">
            Build better.{'\n'}
            <Text style={{ color: colors.blue }}>Cut smarter.</Text>
          </Text>
        </View>
        <View style={styles.avatar} accessibilityLabel="Signed in as guest">
          <Text style={styles.avatarText}>VN</Text>
        </View>
      </View>

      <HeroCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 24 },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf0ff',
    borderWidth: 1,
    borderColor: '#dbe5ff',
    borderRadius: 22,
  },
  avatarText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 13 },
});
