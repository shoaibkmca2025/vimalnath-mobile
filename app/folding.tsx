import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function FoldingScreen() {
  const { configurations } = useAppContent();
  return (
    <ConfigurationGridScreen
      title="Sliding Folding System"
      intro="Choose a sliding folding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/folding"
      configurations={configurations.folding}
    />
  );
}
