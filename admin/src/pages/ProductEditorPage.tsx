import { ArrowSquareOutIcon, PackageIcon, PlusIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';

import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { SelectField, Switch, TextField } from '@/components/Field';
import { ImagePicker } from '@/components/ImagePicker';
import { PageHeader } from '@/components/PageHeader';
import { useToast } from '@/components/useToast';
import { productTitle } from '@/data/products';
import { formatDate, formatINR, formatNumber, plural } from '@/lib/format';
import { useData } from '@/data/useData';
import type { CatalogSource, Product } from '@/data/types';

const SOURCES: { value: CatalogSource; label: string }[] = [
  { value: 'master', label: 'Master Catalogue' },
  { value: 'office', label: 'Office Partition Price List' },
  { value: 'tavic', label: 'Tavic Wardrobe & Sliding Price List' },
];

/** Prices and page numbers are edited as text so a field can be empty while someone types. */
type Draft = Omit<Product, 'options' | 'catalogPage' | 'specs'> & {
  options: { key: number; label: string; code: string; mrp: string }[];
  catalogPage: { source: CatalogSource; page: string };
  specs: { key: number; label: string; value: string }[];
};

let rowKey = 0;
const nextKey = () => ++rowKey;

function toDraft(product: Product): Draft {
  return {
    ...product,
    options: product.options.map((option) => ({ key: nextKey(), label: option.label, code: option.code ?? '', mrp: String(option.mrp) })),
    specs: product.specs.map((spec) => ({ key: nextKey(), ...spec })),
    catalogPage: { source: product.catalogPage.source, page: String(product.catalogPage.page) },
  };
}

function fromDraft(draft: Draft): Product {
  const filled = <T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) => rows.filter((row) => keys.some((key) => String(row[key]).trim()));
  return {
    ...draft,
    code: draft.code.trim(),
    name: draft.name.trim(),
    section: draft.section.trim(),
    options: filled(draft.options, ['label', 'code', 'mrp']).map((option) => ({
      label: option.label.trim(),
      ...(option.code.trim() ? { code: option.code.trim() } : {}),
      mrp: Number(option.mrp),
    })),
    specs: filled(draft.specs, ['label', 'value']).map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() })),
    catalogPage: { source: draft.catalogPage.source, page: Number(draft.catalogPage.page) },
  };
}

const blank = (category: string): Product => ({
  id: '',
  code: '',
  name: '',
  category,
  section: '',
  image: null,
  catalogPage: { source: 'master', page: 1 },
  options: [],
  specs: [],
  featured: false,
  visible: true,
});

type Errors = Record<string, string>;

function validate(draft: Draft, products: Product[]): Errors {
  const errors: Errors = {};
  const code = draft.code.trim();
  if (!code) errors.code = 'Enter the product code from the catalogue.';
  // Catalogues repeat items, so a code that's already shared stays allowed; only a new or changed code must be free.
  else if (code.toLowerCase() !== products.find((product) => product.id === draft.id)?.code.toLowerCase() && products.some((product) => product.code.toLowerCase() === code.toLowerCase()))
    errors.code = `Another product already uses ${code}.`;
  if (!draft.name.trim() && !draft.section.trim()) errors.name = 'Enter a name, or a section the app can show instead.';
  const labels = new Set<string>();
  draft.options.forEach((option, index) => {
    const used = option.label.trim() || option.code.trim() || option.mrp.trim();
    if (!used) return;
    const label = option.label.trim();
    if (!label) errors[`option-${option.key}-label`] = `Name option ${index + 1}, e.g. a finish or size.`;
    // The app and saved carts find an option by its name.
    else if (labels.has(label)) errors[`option-${option.key}-label`] = `Another option is already called ${label}.`;
    labels.add(label);
    const mrp = Number(option.mrp);
    if (!option.mrp.trim() || !Number.isInteger(mrp) || mrp <= 0) errors[`option-${option.key}-mrp`] = 'Enter an MRP in whole rupees, above ₹0.';
  });
  draft.specs.forEach((spec) => {
    if (spec.label.trim() && !spec.value.trim()) errors[`spec-${spec.key}-value`] = `Enter a value for ${spec.label.trim()}.`;
    if (!spec.label.trim() && spec.value.trim()) errors[`spec-${spec.key}-label`] = 'Name this specification.';
  });
  const page = Number(draft.catalogPage.page);
  if (!Number.isInteger(page) || page < 1) errors.page = 'Enter the page number, 1 or more.';
  return errors;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export default function ProductEditorPage() {
  const { id } = useParams();
  const { db, update } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const isNew = !id;
  const existing = id ? db.products.find((product) => product.id === id) : undefined;

  const original = useMemo(() => (existing ? toDraft(existing) : toDraft(blank(db.categories[0]?.id ?? 'glass'))), [existing, db.categories]);
  const [draft, setDraft] = useState<Draft>(original);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  // Another product, or the saved version of this one, starts the form over.
  const [source, setSource] = useState(original);
  if (source !== original) {
    setSource(original);
    setDraft(original);
    setTouched(new Set());
    setSubmitted(false);
  }

  const dirty = useMemo(() => JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(original)), [draft, original]);
  const errors = useMemo(() => validate(draft, db.products), [draft, db.products]);
  const shown = (key: string) => (submitted || touched.has(key) ? errors[key] : undefined);
  const touch = (key: string) => () => setTouched((current) => new Set(current).add(key));

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sections = useMemo(
    () => [...new Set(db.products.filter((product) => product.category === draft.category).map((product) => product.section))].sort(),
    [db.products, draft.category],
  );
  const pageImage = db.catalogPages[`${draft.catalogPage.source}-${draft.catalogPage.page}`];

  if (!isNew && !existing)
    return (
      <>
        <PageHeader title="Product not found" crumbs={[{ label: 'Products', to: '/products' }]} />
        <Card>
          <EmptyState
            icon={PackageIcon}
            title="This product doesn’t exist"
            action={
              <ButtonLink to="/products" variant="primary">
                Back to Products
              </ButtonLink>
            }
          >
            It may have been deleted, or the link is incomplete.
          </EmptyState>
        </Card>
      </>
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    // A second Save or Enter while the first is on its way would add the same new product again.
    if (saving) return;
    setSubmitted(true);
    if (Object.keys(errors).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const product = fromDraft(draft);
    setSaving(true);
    try {
      if (isNew) {
        let newId = `custom-${slug(product.code) || 'product'}`;
        while (db.products.some((item) => item.id === newId)) newId += '-1';
        product.id = newId;
        if (!(await update('products', (products) => [product, ...products], { area: 'catalogue', summary: `Added ${product.code} to the Shop`, to: `/products/${newId}` }))) return;
        toast({ message: `${product.code} added to the Shop.` });
        leaving.current = true;
        navigate(`/products/${newId}`, { replace: true });
      } else {
        if (!(await update('products', (products) => products.map((item) => (item.id === product.id ? product : item)), { area: 'catalogue', summary: `Edited ${product.code}`, to: `/products/${product.id}` }))) return;
        toast({ message: `${product.code} saved.` });
        setSubmitted(false);
        setTouched(new Set());
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const previous = db.products;
    leaving.current = true;
    if (!(await update('products', (products) => products.filter((product) => product.id !== existing.id), { area: 'catalogue', summary: `Deleted ${existing.code}` }))) {
      leaving.current = false;
      return;
    }
    toast({ message: `${existing.code} deleted.`, action: { label: 'Undo', onAction: () => update('products', () => previous, { area: 'catalogue', summary: `Restored ${existing.code}`, to: `/products/${existing.id}` }) } });
    navigate('/products', { replace: true });
  };

  const errorList = Object.entries(errors);
  const title = isNew ? 'New Product' : productTitle(existing!);

  return (
    <form onSubmit={save} noValidate>
      <PageHeader
        title={title}
        crumbs={[{ label: 'Products', to: '/products' }]}
        description={isNew ? 'Add a product to the app’s Shop.' : <span className="mono">{existing!.code}</span>}
      />

      {submitted && errorList.length > 0 && (
        <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1} aria-labelledby="error-summary-title" style={{ marginBottom: 'var(--space-5)' }}>
          <h2 id="error-summary-title">
            <WarningCircleIcon size={18} weight="fill" aria-hidden />
            Fix {errorList.length === 1 ? 'this' : `these ${errorList.length} things`} before saving
          </h2>
          <ul>
            {errorList.map(([key, message]) => (
              <li key={key}>
                <a
                  href={`#${key}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(key)?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="details-title">
            <CardHeader id="details-title" title="Details" />
            <div className="card__body form-grid">
              <TextField
                id="name"
                className="span-2"
                label="Name"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
                onBlur={touch('name')}
                error={shown('name')}
                hint="Leave blank to show the section title, as the catalogue does."
              />
              <TextField
                id="code"
                label="Product code"
                required
                value={draft.code}
                onChange={(event) => set('code', event.target.value)}
                onBlur={touch('code')}
                error={shown('code')}
                autoComplete="off"
                spellCheck={false}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <SelectField
                id="category"
                label="Category"
                value={draft.category}
                onChange={(event) => set('category', event.target.value)}
                options={db.categories.map((category) => ({ value: category.id, label: category.label }))}
              />
              <TextField
                id="section"
                className="span-2"
                label="Section"
                value={draft.section}
                onChange={(event) => set('section', event.target.value)}
                list="section-suggestions"
                hint="The heading it sits under in the Shop, e.g. Patch Fittings."
              />
              <datalist id="section-suggestions">
                {sections.map((section) => (
                  <option key={section} value={section} />
                ))}
              </datalist>
            </div>
          </Card>

          <Card aria-labelledby="prices-title">
            <CardHeader
              id="prices-title"
              title="Prices"
              description="Each option people can order, such as a finish or size, with its MRP."
              action={
                <Button size="sm" variant="plain" icon={PlusIcon} onClick={() => set('options', [...draft.options, { key: nextKey(), label: '', code: '', mrp: '' }])}>
                  Add Option
                </Button>
              }
            />
            <div className="card__body stack">
              {draft.options.length === 0 && <p className="muted">No prices yet. The app shows “Price in catalogue” and points to the catalogue page below.</p>}
              {draft.options.map((option, index) => {
                const change = (patch: Partial<typeof option>) => set('options', draft.options.map((item) => (item.key === option.key ? { ...item, ...patch } : item)));
                return (
                  <div key={option.key} className="repeat-row">
                    <TextField
                      id={`option-${option.key}-label`}
                      label={`Option ${index + 1}`}
                      placeholder="e.g. Black Matte (BM)"
                      value={option.label}
                      onChange={(event) => change({ label: event.target.value })}
                      onBlur={touch(`option-${option.key}-label`)}
                      error={shown(`option-${option.key}-label`)}
                    />
                    <TextField label="Order code" placeholder="Optional" value={option.code} onChange={(event) => change({ code: event.target.value })} spellCheck={false} />
                    <TextField
                      id={`option-${option.key}-mrp`}
                      label="MRP"
                      prefix="₹"
                      inputMode="numeric"
                      value={option.mrp}
                      onChange={(event) => change({ mrp: event.target.value.replace(/[^\d.]/g, '') })}
                      onBlur={touch(`option-${option.key}-mrp`)}
                      error={shown(`option-${option.key}-mrp`)}
                      className="num"
                    />
                    <IconButton
                      icon={TrashIcon}
                      tone="danger"
                      label={`Remove option ${index + 1}`}
                      onClick={() => set('options', draft.options.filter((item) => item.key !== option.key))}
                      style={{ marginBottom: 0 }}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card aria-labelledby="specs-title">
            <CardHeader
              id="specs-title"
              title="Specifications"
              description="Shown as a table on the product page."
              action={
                <Button size="sm" variant="plain" icon={PlusIcon} onClick={() => set('specs', [...draft.specs, { key: nextKey(), label: '', value: '' }])}>
                  Add Specification
                </Button>
              }
            />
            <div className="card__body stack">
              {draft.specs.length === 0 && <p className="muted">No specifications. Add size limits, finishes or materials people ask about.</p>}
              {draft.specs.map((spec, index) => {
                const change = (patch: Partial<typeof spec>) => set('specs', draft.specs.map((item) => (item.key === spec.key ? { ...item, ...patch } : item)));
                return (
                  <div key={spec.key} className="repeat-row repeat-row--2">
                    <TextField
                      id={`spec-${spec.key}-label`}
                      label={`Specification ${index + 1}`}
                      placeholder="e.g. Glass thickness"
                      value={spec.label}
                      onChange={(event) => change({ label: event.target.value })}
                      onBlur={touch(`spec-${spec.key}-label`)}
                      error={shown(`spec-${spec.key}-label`)}
                    />
                    <TextField
                      id={`spec-${spec.key}-value`}
                      label="Value"
                      placeholder="e.g. 8 mm to 12 mm"
                      value={spec.value}
                      onChange={(event) => change({ value: event.target.value })}
                      onBlur={touch(`spec-${spec.key}-value`)}
                      error={shown(`spec-${spec.key}-value`)}
                    />
                    <IconButton icon={TrashIcon} tone="danger" label={`Remove specification ${index + 1}`} onClick={() => set('specs', draft.specs.filter((item) => item.key !== spec.key))} />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card aria-labelledby="page-title">
            <CardHeader id="page-title" title="Catalogue page" description="Where the app sends people for every size, finish and price." />
            <div className="card__body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-5)', alignItems: 'start' }}>
              <div className="stack">
                <SelectField
                  label="Price list"
                  value={draft.catalogPage.source}
                  onChange={(event) => set('catalogPage', { ...draft.catalogPage, source: event.target.value as CatalogSource })}
                  options={SOURCES}
                />
                <TextField
                  id="page"
                  label="Page"
                  inputMode="numeric"
                  value={draft.catalogPage.page}
                  onChange={(event) => set('catalogPage', { ...draft.catalogPage, page: event.target.value.replace(/\D/g, '') })}
                  onBlur={touch('page')}
                  error={shown('page')}
                  style={{ maxWidth: 120 }}
                />
              </div>
              {pageImage ? (
                <a href={pageImage} target="_blank" rel="noreferrer" className="stack" style={{ gap: 'var(--space-1)', alignItems: 'center', fontSize: 'var(--text-sm)' }}>
                  <img src={pageImage} alt={`${SOURCES.find((source) => source.value === draft.catalogPage.source)?.label} page ${draft.catalogPage.page}`} width={110} height={156} loading="lazy" style={{ width: 110, height: 156, objectFit: 'cover', objectPosition: 'top', borderRadius: 6, border: '1px solid var(--border)' }} />
                  <span className="row" style={{ gap: 4 }}>
                    Open page <ArrowSquareOutIcon size={14} aria-hidden />
                  </span>
                </a>
              ) : (
                <p className="muted" style={{ maxWidth: 160, fontSize: 'var(--text-sm)' }}>
                  No preview for this page.
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="app-title">
            <CardHeader id="app-title" title="In the app" />
            <div className="card__body stack">
              <Switch label="Show in the Shop" description="Hidden products stay here but disappear from the app." checked={draft.visible} onChange={(value) => set('visible', value)} />
              <Switch label="Featured" description="Listed first in its category." checked={draft.featured} onChange={(value) => set('featured', value)} />
            </div>
          </Card>

          <Card aria-labelledby="photo-title">
            <CardHeader id="photo-title" title="Photo" />
            <div className="card__body">
              <ImagePicker label="Product photo" value={draft.image} onChange={(image) => set('image', image)} hint="A square photo on white works best. JPG, PNG or WebP, up to 5 MB." />
            </div>
          </Card>

          {!isNew && existing && <OrdersCard productId={existing.id} />}

          {!isNew && (
            <Button variant="danger-plain" icon={TrashIcon} onClick={() => setConfirmDelete(true)}>
              Delete Product
            </Button>
          )}
        </div>
      </div>

      {(dirty || isNew) && (
        <div className="savebar" role="region" aria-label="Save changes">
          <span className="savebar__text">{isNew ? 'New product' : 'Unsaved changes'}</span>
          <Button
            onClick={() => {
              if (isNew) navigate('/products');
              else {
                setDraft(original);
                setSubmitted(false);
                setTouched(new Set());
              }
            }}
          >
            {isNew ? 'Cancel' : 'Discard'}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {isNew ? 'Add Product' : 'Save Changes'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${existing?.code ?? 'this product'}?`}
        body="It will be removed from the app’s Shop. Orders that already include it keep their details."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        body="Your changes to this product will be lost."
        confirmLabel="Leave"
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </form>
  );
}

/** How this product has sold through the app, cancelled orders left out. */
function OrdersCard({ productId }: { productId: string }) {
  const { db } = useData();
  const lines = db.orders.filter((order) => order.status !== 'cancelled').flatMap((order) => order.lines.filter((line) => line.productId === productId).map((line) => ({ order, line })));
  const units = lines.reduce((sum, { line }) => sum + line.qty, 0);
  const value = lines.reduce((sum, { line }) => sum + (line.mrp ?? 0) * line.qty, 0);
  const last = lines.reduce<string | null>((latest, { order }) => (!latest || order.createdAt > latest ? order.createdAt : latest), null);
  const options = new Map<string, number>();
  for (const { line } of lines) if (line.option) options.set(line.option, (options.get(line.option) ?? 0) + line.qty);
  const topOption = [...options.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <Card aria-labelledby="orders-title">
      <CardHeader id="orders-title" title="Orders" description="From the app, cancelled orders left out." />
      {lines.length ? (
        <>
          <dl className="card__body kv kv--compact">
            <dt>Orders</dt>
            <dd className="num">{formatNumber(new Set(lines.map(({ order }) => order.id)).size)}</dd>
            <dt>Units ordered</dt>
            <dd className="num">{formatNumber(units)}</dd>
            <dt>Value (MRP)</dt>
            <dd className="num">{formatINR(value)}</dd>
            <dt>Last ordered</dt>
            <dd>{last ? formatDate(last) : '—'}</dd>
            {topOption && (
              <>
                <dt>Most ordered</dt>
                <dd>
                  {topOption[0]} <span className="muted">({plural(topOption[1], 'unit')})</span>
                </dd>
              </>
            )}
          </dl>
          <div className="card__footer">
            <Link to={`/orders?product=${encodeURIComponent(productId)}`}>View these orders</Link>
          </div>
        </>
      ) : (
        <p className="card__body muted">Not ordered through the app yet.</p>
      )}
    </Card>
  );
}
