import { EyeIcon, EyeSlashIcon, PackageIcon, PlusIcon, StarIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { lowestPrice, productTitle } from '@/data/products';
import { useData } from '@/data/useData';
import type { Product } from '@/data/types';
import { formatINR, formatNumber, plural } from '@/lib/format';

const VIEWS = {
  all: 'All products',
  'missing-price': 'Without a price',
  'missing-photo': 'Without a photo',
  hidden: 'Hidden from the app',
  featured: 'Featured',
} as const;
type View = keyof typeof VIEWS;

export default function ProductsPage() {
  const { db, update } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = params.get('q') ?? '';
  const category = params.get('category') ?? 'all';
  const view: View = (params.get('view') as View) in VIEWS ? (params.get('view') as View) : 'all';

  const setParam = (key: string, value: string, empty: string) => {
    const next = new URLSearchParams(params);
    if (value === empty) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const categoryLabel = useMemo(() => new Map(db.categories.map((item) => [item.id, item.label])), [db.categories]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return db.products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (view === 'missing-price' && product.options.length) return false;
      if (view === 'missing-photo' && product.image) return false;
      if (view === 'hidden' && product.visible) return false;
      if (view === 'featured' && !product.featured) return false;
      return !needle || [product.code, product.name, product.section].some((field) => field.toLowerCase().includes(needle));
    });
  }, [db.products, query, category, view]);

  const setVisibility = async (ids: string[], visible: boolean) => {
    const previous = db.products;
    const ok = await update('products', (products) => products.map((product) => (ids.includes(product.id) ? { ...product, visible } : product)), {
      area: 'catalogue',
      summary: `${visible ? 'Showed' : 'Hid'} ${plural(ids.length, 'product')} in the Shop`,
      to: '/products',
    });
    if (!ok) return;
    setSelected(new Set());
    toast({
      message: `${plural(ids.length, 'product')} ${visible ? 'shown in' : 'hidden from'} the app.`,
      action: {
        label: 'Undo',
        onAction: () => update('products', () => previous, { area: 'catalogue', summary: `Undid: ${visible ? 'showing' : 'hiding'} ${plural(ids.length, 'product')}`, to: '/products' }),
      },
    });
  };

  const columns: Column<Product>[] = [
    {
      key: 'product',
      header: 'Product',
      sortValue: (product) => productTitle(product),
      cell: (product) => (
        <div className="cell-media">
          <Thumb src={product.image} />
          <span style={{ minWidth: 0 }}>
            <Link to={`/products/${product.id}`} className="cell-title">
              {productTitle(product)}
            </Link>
            <span className="cell-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono">{product.code}</span>
              {product.featured && (
                <span className="row" style={{ gap: 2, color: 'var(--warning)' }}>
                  <StarIcon size={12} weight="fill" aria-hidden />
                  Featured
                </span>
              )}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortValue: (product) => categoryLabel.get(product.category) ?? product.category,
      cell: (product) => (
        <>
          {categoryLabel.get(product.category) ?? product.category}
          <div className="cell-sub">{product.section}</div>
        </>
      ),
    },
    {
      key: 'price',
      header: 'Price (MRP)',
      align: 'num',
      sortValue: (product) => lowestPrice(product) ?? -1,
      cell: (product) => {
        const price = lowestPrice(product);
        if (price === undefined) return <span className="muted">In catalogue</span>;
        return product.options.length > 1 ? (
          <>
            <span className="muted">From </span>
            {formatINR(price)}
          </>
        ) : (
          formatINR(price)
        );
      },
    },
    {
      key: 'status',
      header: 'In app',
      sortValue: (product) => (product.visible ? 1 : 0),
      cell: (product) =>
        product.visible ? (
          <Badge tone="success" icon={EyeIcon}>
            Shown
          </Badge>
        ) : (
          <Badge tone="neutral" icon={EyeSlashIcon}>
            Hidden
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hideHeader: true,
      align: 'actions',
      cell: (product) => (
        <IconButton
          icon={product.visible ? EyeSlashIcon : EyeIcon}
          label={`${product.visible ? 'Hide' : 'Show'} ${product.code} ${product.visible ? 'from' : 'in'} the app`}
          onClick={() => setVisibility([product.id], !product.visible)}
        />
      ),
    },
  ];

  const filtered = query || category !== 'all' || view !== 'all';

  return (
    <>
      <PageHeader
        title="Products"
        description={`Everything in the app’s Shop: ${plural(db.products.length, 'product')} across ${plural(db.categories.length, 'category', 'categories')}.`}
        actions={
          <ButtonLink to="/products/new" variant="primary" icon={PlusIcon}>
            New Product
          </ButtonLink>
        }
      />

      <div className="toolbar">
        <SearchInput label="Search products" placeholder="Code, name or section" value={query} onChange={(value) => setParam('q', value, '')} />
        <label className="visually-hidden" htmlFor="category-filter">
          Category
        </label>
        <select id="category-filter" className="select" style={{ width: 'auto', minWidth: 190 }} value={category} onChange={(event) => setParam('category', event.target.value, 'all')}>
          <option value="all">All categories</option>
          {db.categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor="view-filter">
          Show
        </label>
        <select id="view-filter" className="select" style={{ width: 'auto', minWidth: 180 }} value={view} onChange={(event) => setParam('view', event.target.value, 'all')}>
          {Object.entries(VIEWS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="muted num" role="status">
          {formatNumber(rows.length)} shown
        </span>
      </div>

      <Card className="table-card">
        <DataTable
          caption="Products"
          rows={rows}
          columns={columns}
          getRowId={(product) => product.id}
          onRowClick={(product) => navigate(`/products/${product.id}`)}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          resetKey={`${query}|${category}|${view}`}
          bulkActions={(ids) => (
            <>
              <Button size="sm" icon={EyeIcon} onClick={() => setVisibility(ids, true)}>
                Show in App
              </Button>
              <Button size="sm" icon={EyeSlashIcon} onClick={() => setVisibility(ids, false)}>
                Hide from App
              </Button>
            </>
          )}
          empty={
            <EmptyState icon={PackageIcon} title="No products match" action={filtered && <Button onClick={() => setParams({})}>Clear Filters</Button>}>
              Try another search, or show all categories.
            </EmptyState>
          }
        />
      </Card>
    </>
  );
}
