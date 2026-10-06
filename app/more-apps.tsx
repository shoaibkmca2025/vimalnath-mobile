import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export default function MoreAppsScreen() {
  return (
    <Screen title="More Apps" back={{ fallback: '/', label: 'Back' }} grouped>
      <EmptyState icon="apps-outline" title="More Apps Coming Soon" message="4AM Global Media is working on more apps. They’ll appear here when they’re ready." />
    </Screen>
  );
}
