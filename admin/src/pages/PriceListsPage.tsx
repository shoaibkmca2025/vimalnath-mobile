import { ArrowSquareOutIcon, CheckCircleIcon, ClockIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { PriceList } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

const COVER: Record<string, string> = {
  blue: 'linear-gradient(160deg, #2458e8, #6d94ff)',
  sand: 'linear-gradient(160deg, #b87942, #e7b678)',
  green: 'linear-gradient(160deg, #2c896e, #83c6af)',
  muted: 'linear-gradient(160deg, #8d97aa, #c6ccd6)',
};

function urlError(url: string) {
  if (!url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' ? null : 'Use a secure link that starts with https://.';
  } catch {
    return 'Enter the full link, starting with https://.';
  }
}

export default function PriceListsPage() {
  const { db, update } = useData();
  const toast = useToast();
  const drawer = useDrawerItem<PriceList>();
  const [draft, setDraft] = useState<PriceList | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const published = db.catalogues.filter((list) => list.url).length;

  const edit = (list: PriceList) => {
    setDraft(list);
    setTouched(new Set());
    drawer.show(list);
  };

  const errors = draft ? { title: draft.title.trim() ? null : 'Enter the price list’s title.', url: urlError(draft.url) } : { title: null, url: null };
  const dirty = Boolean(draft && drawer.item && JSON.stringify(draft) !== JSON.stringify(drawer.item));

  const save = () => {
    setTouched(new Set(['title', 'url']));
    if (!draft || errors.title || errors.url) return;
    const saved = { ...draft, title: draft.title.trim(), url: draft.url.trim() };
    update('catalogues', (lists) => lists.map((list) => (list.number === saved.number ? saved : list)), {
      area: 'catalogue',
      summary: saved.url ? `Published the ${saved.title} price list` : `Edited the ${saved.title} price list`,
      to: '/price-lists',
    });
    drawer.close();
    toast({ message: saved.url ? `${saved.title} is published in the app.` : `${saved.title} saved. It shows as coming soon until it has a link.` });
  };

  return (
    <>
      <PageHeader
        title="Price Lists"
        description={`The Taiton PDF catalogues in the app’s Catalog tab. ${published ? `${plural(published, 'list')} published.` : 'None are published yet — add a link to publish one.'}`}
      />

      <div className="stack">
        {db.catalogues.map((list) => (
          <Card key={list.number} className="list-row" style={{ padding: 'var(--space-4) var(--space-5)', gap: 'var(--space-4)' }}>
            <div
              aria-hidden
              style={{
                width: 56,
                height: 74,
                flexShrink: 0,
                borderRadius: 6,
                background: COVER[list.tone] ?? COVER.blue,
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 6,
                fontWeight: 700,
              }}
            >
              <span style={{ fontSize: 9, letterSpacing: '0.08em' }}>TAITON</span>
              <span style={{ fontSize: 20, textAlign: 'center' }}>{list.number}</span>
              <span />
            </div>
            <div className="list-row__main">
              <p className="cell-sub" style={{ fontWeight: 600, letterSpacing: '0.02em' }}>
                {list.kicker}
              </p>
              <h2 style={{ fontSize: 'var(--text-lg)' }}>{list.title}</h2>
              <p className="list-row__meta">{list.meta}</p>
            </div>
            {list.url ? (
              <Badge tone="success" icon={CheckCircleIcon}>
                Published
              </Badge>
            ) : (
              <Badge tone="warning" icon={ClockIcon}>
                Coming soon
              </Badge>
            )}
            <span className="row-wrap">
              {list.url && (
                <a className="btn btn--plain btn--sm" href={list.url} target="_blank" rel="noreferrer">
                  Open PDF <ArrowSquareOutIcon size={14} aria-hidden />
                  <span className="visually-hidden">(opens in a new tab)</span>
                </a>
              )}
              <Button size="sm" icon={PencilSimpleIcon} onClick={() => edit(list)} aria-label={`Edit ${list.title}`}>
                Edit
              </Button>
            </span>
          </Card>
        ))}
      </div>

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={dirty}
        title="Edit price list"
        description={drawer.item?.title}
        footer={
          <>
            <Button onClick={drawer.close}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="stack-lg">
            <TextField
              label="PDF link"
              type="url"
              inputMode="url"
              placeholder="https://drive.google.com/…"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              onBlur={() => setTouched((current) => new Set(current).add('url'))}
              error={touched.has('url') ? errors.url : null}
              hint="A share link anyone can open. Leave empty to show “coming soon” in the app."
              data-autofocus
            />
            <TextField
              label="Title"
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              onBlur={() => setTouched((current) => new Set(current).add('title'))}
              error={touched.has('title') ? errors.title : null}
            />
            <div className="grid-2">
              <TextField label="Label above the title" value={draft.kicker} onChange={(event) => setDraft({ ...draft, kicker: event.target.value })} hint="e.g. MASTER CATALOGUE" />
              <TextField label="Edition" value={draft.meta} onChange={(event) => setDraft({ ...draft, meta: event.target.value })} hint="e.g. Feb 2026 · PDF" />
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
