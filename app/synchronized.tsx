import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function SynchronizedScreen() {
  const { configurations } = useAppContent();
  return (
    <ConfigurationGridScreen
      title="Synchronized System"
      intro="Choose a synchro configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/synchronized"
      configurations={configurations.synchronized}
    />
  );
}
