import { ArrowLeftIcon, ArrowRightIcon, EyeIcon, EyeSlashIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { Drawer } from '@/components/Drawer';
import { Switch, TextAreaField, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Banner } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

const EMPTY: Banner = { id: '', image: '', kicker: '', headline: '', body: '', active: true };

/** How the slide looks in the app: photo, darkening gradient, text bottom-left. */
function BannerPreview({ banner }: { banner: Banner }) {
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '16 / 10',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
        background: banner.image ? `center / cover no-repeat url("${banner.image}")` : 'var(--surface-sunken)',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0.62) 100%)' }} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 18, color: '#fff' }}>
        {banner.kicker && <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', opacity: 0.88 }}>{banner.kicker}</p>}
        <p style={{ fontSize: 22, lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.01em', textWrap: 'balance' }}>{banner.headline || 'Headline'}</p>
        {banner.body && <p style={{ fontSize: 14, marginTop: 4, opacity: 0.9 }}>{banner.body}</p>}
      </div>
    </div>
  );
}

export default function BannersPage() {
  const { db, update } = useData();
  const toast = useToast();
  const drawer = useDrawerItem<string | null>();
  const [draft, setDraft] = useState<Banner>(EMPTY);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Banner | null>(null);

  const banners = db.banners;
  const active = banners.filter((banner) => banner.active).length;

  const open = (banner: Banner | null) => {
    setDraft(banner ?? EMPTY);
    setTouched(new Set());
    drawer.show(banner?.id ?? null);
  };

  const editing = drawer.item;
  const original = banners.find((banner) => banner.id === editing) ?? EMPTY;
  const errors: Record<string, string | null> = {
    image: draft.image ? null : 'Add a photo for the banner.',
    headline: draft.headline.trim() ? null : 'Enter a headline.',
  };
  const shown = (key: string) => (touched.has(key) ? errors[key] : null);

  const save = () => {
    setTouched(new Set(Object.keys(errors)));
    if (Object.values(errors).some(Boolean)) return;
    const saved = { ...draft, id: editing ?? `banner-${Date.now()}`, headline: draft.headline.trim(), kicker: draft.kicker.trim(), body: draft.body.trim() };
    update('banners', (current) => (editing ? current.map((banner) => (banner.id === editing ? saved : banner)) : [...current, saved]), {
      area: 'content',
      summary: editing ? `Edited the home banner “${saved.headline}”` : `Added the home banner “${saved.headline}”`,
      to: '/banners',
    });
    drawer.close();
    toast({ message: editing ? 'Banner saved.' : 'Banner added to the slideshow.' });
  };

  const move = (index: number, direction: -1 | 1) =>
    update('banners', (current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
      return next;
    }, { area: 'content', summary: `Moved the home banner “${banners[index]!.headline}” ${direction < 0 ? 'earlier' : 'later'}`, to: '/banners' });

  const setActive = (banner: Banner, value: boolean) => {
    update('banners', (current) => current.map((item) => (item.id === banner.id ? { ...item, active: value } : item)), {
      area: 'content',
      summary: `${value ? 'Showed' : 'Hid'} the home banner “${banner.headline}”`,
      to: '/banners',
    });
    toast({ message: value ? 'Banner shown in the slideshow.' : 'Banner hidden from the slideshow.', tone: 'info' });
  };

  return (
    <>
      <PageHeader
        title="Home Banners"
        description={`The slideshow at the top of the app’s Shop screen. ${plural(active, 'banner')} showing, in this order.`}
        actions={
          <Button variant="primary" icon={PlusIcon} onClick={() => open(null)}>
            New Banner
          </Button>
        }
      />

      <ol className="media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', listStyle: 'none', margin: 0, padding: 0 }}>
        {banners.map((banner, index) => (
          <li key={banner.id} className="card" style={{ overflow: 'hidden' }}>
            <button type="button" onClick={() => open(banner)} style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none' }} aria-label={`Edit banner ${index + 1}: ${banner.headline}`}>
              <div style={{ opacity: banner.active ? 1 : 0.45 }}>
                <BannerPreview banner={banner} />
              </div>
            </button>
            <div className="row" style={{ padding: 'var(--space-3) var(--space-3) var(--space-3) var(--space-4)' }}>
              <span className="num muted">Slide {index + 1}</span>
              {banner.active ? (
                <Badge tone="success" icon={EyeIcon}>
                  Showing
                </Badge>
              ) : (
                <Badge tone="neutral" icon={EyeSlashIcon}>
                  Hidden
                </Badge>
              )}
              <span className="spacer" />
              <IconButton icon={ArrowLeftIcon} label={`Move slide ${index + 1} earlier`} disabled={index === 0} onClick={() => move(index, -1)} />
              <IconButton icon={ArrowRightIcon} label={`Move slide ${index + 1} later`} disabled={index === banners.length - 1} onClick={() => move(index, 1)} />
              <IconButton icon={banner.active ? EyeSlashIcon : EyeIcon} label={banner.active ? `Hide slide ${index + 1}` : `Show slide ${index + 1}`} onClick={() => setActive(banner, !banner.active)} />
              <IconButton icon={TrashIcon} tone="danger" label={`Delete slide ${index + 1}`} onClick={() => setDeleting(banner)} />
            </div>
          </li>
        ))}
      </ol>

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={JSON.stringify(draft) !== JSON.stringify(original)}
        title={editing ? 'Edit banner' : 'New banner'}
        description="The preview shows it as it appears in the app."
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              {editing ? 'Save' : 'Add Banner'}
            </Button>
          </>
        }
      >
        <div className="stack-lg">
          <BannerPreview banner={draft} />
          <TextField label="Headline" required value={draft.headline} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} onBlur={() => setTouched((current) => new Set(current).add('headline'))} error={shown('headline')} maxLength={60} hint="Up to 60 characters so it fits on a phone." data-autofocus />
          <TextField label="Label above the headline" value={draft.kicker} onChange={(event) => setDraft({ ...draft, kicker: event.target.value })} maxLength={40} placeholder="e.g. New collection · 2026" />
          <TextAreaField label="Supporting line" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} maxLength={90} rows={2} />
          <ImagePicker label="Photo" shape="wide" allowRemove={false} value={draft.image || null} onChange={(image) => image && setDraft({ ...draft, image })} hint="A wide room photo; the bottom third sits under the text. Up to 500 KB." />
          {shown('image') && (
            <p className="field__error" role="alert">
              {errors.image}
            </p>
          )}
          <Switch label="Show in the slideshow" checked={draft.active} onChange={(value) => setDraft({ ...draft, active: value })} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this banner?"
        body={`“${deleting?.headline ?? ''}” will be removed from the slideshow. To keep it for later, hide it instead.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            const previous = banners;
            update('banners', (current) => current.filter((banner) => banner.id !== deleting.id), { area: 'content', summary: `Deleted the home banner “${deleting.headline}”`, to: '/banners' });
            toast({ message: 'Banner deleted.', action: { label: 'Undo', onAction: () => update('banners', () => previous, { area: 'content', summary: `Restored the home banner “${deleting.headline}”`, to: '/banners' }) } });
          }
          setDeleting(null);
        }}
      />
    </>
  );
}
