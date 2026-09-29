import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { synchronizedConfigurations } from '@/data/cutlist';

export default function SynchronizedScreen() {
  return (
    <ConfigurationGridScreen
      title="Synchronized System"
      intro="Choose a synchro configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/synchronized"
      configurations={synchronizedConfigurations}
    />
  );
}
