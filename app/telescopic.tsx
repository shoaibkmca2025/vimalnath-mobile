import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function TelescopicScreen() {
  const { configurations, cutlistSystems } = useAppContent();
  return (
    <ConfigurationGridScreen
      // The name staff give the system in the admin, e.g. 16 × 35 Telescopic Sliding System.
      title={cutlistSystems.find((system) => system.id === 'telescopic')?.name ?? 'Telescopic Sliding'}
      intro="Choose a sliding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/telescopic"
      configurations={configurations.telescopic}
    />
  );
}
