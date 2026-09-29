import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { foldingConfigurations } from '@/data/cutlist';

export default function FoldingScreen() {
  return (
    <ConfigurationGridScreen
      eyebrow="CUTLIST SYSTEM"
      title="Sliding Folding System"
      intro="Choose a sliding folding configuration to view its cutting setup."
      backLabel="Back to cutlist"
      backRoute="/cutlist"
      ownRoute="/folding"
      configurations={foldingConfigurations}
    />
  );
}
