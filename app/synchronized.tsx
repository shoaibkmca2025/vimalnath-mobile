import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { synchronizedConfigurations } from '@/data/cutlist';

export default function SynchronizedScreen() {
  return (
    <ConfigurationGridScreen
      eyebrow="CUTLIST SYSTEM"
      title="Synchronized System"
      intro="Choose a synchro configuration to view its cutting setup."
      backLabel="Back to cutlist"
      backRoute="/cutlist"
      ownRoute="/synchronized"
      configurations={synchronizedConfigurations}
    />
  );
}
