import { AppStoreLogoIcon, ArrowDownIcon, ArrowUpIcon, GooglePlayLogoIcon, GridFourIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { EmptyState } from '@/components/EmptyState';
import { TextAreaField, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import type { MoreApp } from '@/data/types';
import { useData } from '@/data/useData';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

const EMPTY: MoreApp = { name: '', description: '', icon: null, playStore: '', appStore: '' };

function linkError(url: string) {
  if (!url.trim()) return null;
  try {
    return new URL(url.trim()).protocol === 'https:' ? null : 'Use a secure link that starts with https://.';
  } catch {
    return 'Paste the full link, starting with https://.';
  }
}

/** Module 9.4: other 4AM Global Media apps, listed under Menu › More Apps in the app. */
export default function MoreAppsPage() {
  const { db, update } = useData();
  const toast = useToast();
  /** The app's position in the list, or null for a new one. */
  const drawer = useDrawerItem<number | null>();
  const [draft, setDraft] = useState<MoreApp>(EMPTY);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);

  const apps = db.moreApps;
  const editing = drawer.item;
  const original = editing === null ? EMPTY : (apps[editing] ?? EMPTY);

  const open = (index: number | null) => {
    setDraft(index === null ? EMPTY : apps[index]!);
    setTouched(new Set());
    drawer.show(index);
  };

  const errors: Record<string, string | null> = {
    name: draft.name.trim() ? null : 'Enter the app’s name.',
    playStore: linkError(draft.playStore) ?? (draft.playStore.trim() || draft.appStore.trim() ? null : 'Add a Play Store or App Store link.'),
    appStore: linkError(draft.appStore),
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));

  const save = async () => {
    setTouched(new Set(Object.keys(errors)));
    if (Object.values(errors).some(Boolean)) return;
    const saved: MoreApp = { ...draft, name: draft.name.trim(), description: draft.description.trim(), playStore: draft.playStore.trim(), appStore: draft.appStore.trim() };
    const ok = await update('moreApps', (current) => (editing === null ? [...current, saved] : current.map((app, index) => (index === editing ? saved : app))), {
      area: 'content',
      summary: editing === null ? `Added ${saved.name} to More Apps` : `Edited ${saved.name} in More Apps`,
      to: '/more-apps',
    });
    if (!ok) return;
    drawer.close();
    toast({ message: editing === null ? `${saved.name} added to More Apps.` : `${saved.name} saved.` });
  };

  const move = (index: number, direction: -1 | 1) =>
    update(
      'moreApps',
      (current) => {
        const next = [...current];
        [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
        return next;
      },
      { area: 'content', summary: `Moved ${apps[index]!.name} ${direction < 0 ? 'up' : 'down'} in More Apps`, to: '/more-apps' },
    );

  const remove = async (index: number) => {
    const previous = apps;
    const app = apps[index]!;
    if (!(await update('moreApps', (current) => current.filter((_, i) => i !== index), { area: 'content', summary: `Removed ${app.name} from More Apps`, to: '/more-apps' }))) return;
    toast({ message: `${app.name} removed.`, action: { label: 'Undo', onAction: () => update('moreApps', () => previous, { area: 'content', summary: `Restored ${app.name} to More Apps`, to: '/more-apps' }) } });
  };

  return (
    <>
      <PageHeader
        title="More Apps"
        description={`Other 4AM Global Media apps, under Menu › More Apps in the app. ${plural(apps.length, 'app')}, in this order.`}
        actions={
          <Button variant="primary" icon={PlusIcon} onClick={() => open(null)}>
            New App
          </Button>
        }
      />

      <Card>
        {apps.length === 0 ? (
          <EmptyState icon={GridFourIcon} title="No apps yet" action={<Button variant="primary" onClick={() => open(null)}>New App</Button>}>
            Until you add one, the app shows “More Apps Coming Soon”.
          </EmptyState>
        ) : (
          <ul className="list">
            {apps.map((app, index) => (
              <li key={`${app.name}-${index}`} className="list-row">
                <Thumb src={app.icon} fit="cover" />
                <div className="list-row__main">
                  <p className="list-row__title">{app.name}</p>
                  {app.description && <p className="list-row__meta">{app.description}</p>}
                </div>
                {app.playStore && (
                  <Badge tone="neutral" icon={GooglePlayLogoIcon}>
                    Play Store
                  </Badge>
                )}
                {app.appStore && (
                  <Badge tone="neutral" icon={AppStoreLogoIcon}>
                    App Store
                  </Badge>
                )}
                <span className="row" style={{ gap: 0 }}>
                  <IconButton icon={ArrowUpIcon} label={`Move ${app.name} up`} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton icon={ArrowDownIcon} label={`Move ${app.name} down`} disabled={index === apps.length - 1} onClick={() => move(index, 1)} />
                  <IconButton icon={PencilSimpleIcon} label={`Edit ${app.name}`} onClick={() => open(index)} />
                  <IconButton icon={TrashIcon} tone="danger" label={`Remove ${app.name}`} onClick={() => setDeleting(index)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={JSON.stringify(draft) !== JSON.stringify(original)}
        title={editing === null ? 'New app' : 'Edit app'}
        description={editing === null ? 'Add another 4AM Global Media app.' : original.name}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              {editing === null ? 'Add App' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="stack-lg">
          <TextField label="Name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={touch('name')} error={shown('name')} maxLength={60} data-autofocus />
          <TextAreaField label="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={200} rows={2} hint="One line on what the app does." />
          <ImagePicker label="Icon" value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} hint="The app’s square store icon." />
          <TextField
            label="Play Store link"
            type="url"
            inputMode="url"
            placeholder="https://play.google.com/store/apps/details?id=…"
            value={draft.playStore}
            onChange={(event) => setDraft({ ...draft, playStore: event.target.value })}
            onBlur={touch('playStore')}
            error={shown('playStore')}
          />
          <TextField
            label="App Store link"
            type="url"
            inputMode="url"
            placeholder="https://apps.apple.com/app/…"
            value={draft.appStore}
            onChange={(event) => setDraft({ ...draft, appStore: event.target.value })}
            onBlur={touch('appStore')}
            error={shown('appStore')}
            hint="Leave a link empty if the app isn’t in that store yet."
          />
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove ${deleting === null ? 'this app' : apps[deleting]?.name}?`}
        body="It will no longer appear under More Apps in the app."
        confirmLabel="Remove"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) remove(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}
