import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { telescopicConfigurations } from '@/data/cutlist';

export default function TelescopicScreen() {
  return (
    <ConfigurationGridScreen
      eyebrow="CUTLIST SYSTEM"
      title="Telescopic Sliding"
      intro="Choose a sliding configuration to view its cutting setup."
      backLabel="Back to cutlist"
      backRoute="/cutlist"
      ownRoute="/telescopic"
      configurations={telescopicConfigurations}
    />
  );
}
