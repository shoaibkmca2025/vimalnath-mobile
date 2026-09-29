import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { telescopicConfigurations } from '@/data/cutlist';

export default function TelescopicScreen() {
  return (
    <ConfigurationGridScreen
      title="Telescopic Sliding"
      intro="Choose a sliding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/telescopic"
      configurations={telescopicConfigurations}
    />
  );
}
