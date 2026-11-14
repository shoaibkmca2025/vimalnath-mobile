import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeSlashIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Drawer } from '@/components/Drawer';
import { Segmented, Switch, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { useData } from '@/data/useData';
import type { Category } from '@/data/types';
import { useDrawerItem } from '@/hooks/useDrawerItem';
import { plural } from '@/lib/format';

export default function CategoriesPage() {
  const { db, update } = useData();
  const toast = useToast();
  const drawer = useDrawerItem<Category>();
  const [draft, setDraft] = useState<Category | null>(null);
  const [touched, setTouched] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of db.products) map.set(product.category, (map.get(product.category) ?? 0) + 1);
    return map;
  }, [db.products]);

  const edit = (category: Category) => {
    setDraft(category);
    setTouched(false);
    drawer.show(category);
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= db.categories.length) return;
    const moved = db.categories[index]!;
    // Found by id when the save runs (after any earlier click's save), so quick clicks each move it one more place.
    const ok = await update('categories', (categories) => {
      const from = categories.findIndex((category) => category.id === moved.id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= categories.length) return categories;
      const next = [...categories];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    }, { area: 'catalogue', summary: `Moved the ${moved.label} category ${direction < 0 ? 'up' : 'down'}`, to: '/categories' });
    if (ok) toast({ message: `${moved.label} moved ${direction < 0 ? 'up' : 'down'}.`, tone: 'info' });
  };

  const labelError = draft && !draft.label.trim() ? 'Enter a name for this category.' : null;
  const dirty = Boolean(draft && drawer.item && JSON.stringify(draft) !== JSON.stringify(drawer.item));

  const save = async () => {
    setTouched(true);
    if (!draft || labelError) return;
    const saved = { ...draft, label: draft.label.trim() };
    const ok = await update('categories', (categories) => categories.map((category) => (category.id === saved.id ? saved : category)), {
      area: 'catalogue',
      summary: `Edited the ${saved.label} category${saved.visible ? '' : ' (hidden)'}`,
      to: '/categories',
    });
    if (!ok) return;
    drawer.close();
    toast({ message: `${saved.label} saved.` });
  };

  return (
    <>
      <PageHeader title="Categories" description="The category tiles at the top of the app’s Shop, in the order they appear." />

      <Card aria-labelledby="category-list">
        <CardHeader id="category-list" title="Shop categories" description={`${plural(db.categories.length, 'category', 'categories')} · products are filed under these in the catalogue`} />
        <ol className="list">
          {db.categories.map((category, index) => (
            <li key={category.id} className="list-row">
              <span className="num muted" style={{ width: 20 }} aria-hidden>
                {index + 1}
              </span>
              <Thumb src={category.image} size="lg" fit={category.fit} />
              <div className="list-row__main">
                <button type="button" className="list-row__title cell-title link-reset" onClick={() => edit(category)}>
                  {category.label}
                </button>
                <div className="list-row__meta">
                  <Link to={`/products?category=${category.id}`}>{plural(counts.get(category.id) ?? 0, 'product')}</Link>
                </div>
              </div>
              {category.visible ? (
                <Badge tone="success" icon={EyeIcon}>
                  Shown
                </Badge>
              ) : (
                <Badge tone="neutral" icon={EyeSlashIcon}>
                  Hidden
                </Badge>
              )}
              <span className="row" style={{ gap: 0 }}>
                <IconButton icon={ArrowUpIcon} label={`Move ${category.label} up`} disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton icon={ArrowDownIcon} label={`Move ${category.label} down`} disabled={index === db.categories.length - 1} onClick={() => move(index, 1)} />
                <IconButton icon={PencilSimpleIcon} label={`Edit ${category.label}`} onClick={() => edit(category)} />
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Drawer
        open={drawer.open}
        onClose={drawer.close}
        onSubmit={save}
        dirty={dirty}
        title="Edit category"
        description={drawer.item?.label}
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
            <TextField label="Name" required value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} onBlur={() => setTouched(true)} error={touched ? labelError : null} data-autofocus />
            <Switch label="Show in the Shop" description="Hidden categories keep their products, but the tile disappears." checked={draft.visible} onChange={(visible) => setDraft({ ...draft, visible })} />
            <div className="field">
              <span className="field__label" id="fit-label">
                Tile image
              </span>
              <Segmented<Category['fit']>
                label="Tile image"
                value={draft.fit}
                onChange={(fit) => setDraft({ ...draft, fit })}
                options={[
                  { value: 'cover', label: 'Fill the tile' },
                  { value: 'contain', label: 'Show whole photo' },
                ]}
              />
              <p className="field__hint">Room photos look best filling the tile; product photos on white look best shown whole.</p>
              <Thumb src={draft.image} size="lg" fit={draft.fit} />
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
