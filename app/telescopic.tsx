import { ConfigurationGridScreen } from '@/components/ConfigurationGridScreen';
import { useAppContent } from '@/lib/content-sync';

export default function TelescopicScreen() {
  const { configurations } = useAppContent();
  return (
    <ConfigurationGridScreen
      title="Telescopic Sliding"
      intro="Choose a sliding configuration to see its glass cutting sizes."
      backLabel="Cutlist"
      backRoute="/cutlist"
      ownRoute="/telescopic"
      configurations={configurations.telescopic}
    />
  );
}
