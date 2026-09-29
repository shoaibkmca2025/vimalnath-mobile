import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { foldingConfigurations } from '@/data/cutlist';

export default function FoldingScreen() {
  return (
    <ConfigurationGridScreen
      title="Sliding Folding System"
      intro="Choose a sliding folding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/folding"
      configurations={foldingConfigurations}
    />
  );
}
