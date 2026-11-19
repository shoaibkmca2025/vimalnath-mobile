import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function SynchronizedScreen() {
  const { configurations, cutlistSystems } = useAppContent();
  return (
    <ConfigurationGridScreen
      // The name staff give the system in the admin, e.g. 16 × 35 Telescopic Sliding System.
      title={cutlistSystems.find((system) => system.id === 'synchronized')?.name ?? 'Synchronized System'}
      intro="Choose a synchro configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/synchronized"
      configurations={configurations.synchronized}
    />
  );
}
