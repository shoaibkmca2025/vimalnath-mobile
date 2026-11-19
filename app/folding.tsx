import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function FoldingScreen() {
  const { configurations, cutlistSystems } = useAppContent();
  return (
    <ConfigurationGridScreen
      // The name staff give the system in the admin, e.g. 16 × 35 Telescopic Sliding System.
      title={cutlistSystems.find((system) => system.id === 'folding')?.name ?? 'Sliding Folding System'}
      intro="Choose a sliding folding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/folding"
      configurations={configurations.folding}
    />
  );
}
