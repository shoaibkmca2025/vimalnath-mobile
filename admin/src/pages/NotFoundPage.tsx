import { CompassIcon } from '@phosphor-icons/react';

import { ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon={CompassIcon}
          title="There’s nothing at this address"
          action={
            <ButtonLink to="/" variant="primary">
              Go to Dashboard
            </ButtonLink>
          }
        >
          Check the link, or use the menu to find what you need.
        </EmptyState>
      </Card>
    </>
  );
}
