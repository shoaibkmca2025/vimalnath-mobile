import { DeviceMobileIcon, PaperPlaneTiltIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { SearchInput, SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { Thumb } from '@/components/Thumb';
import { useToast } from '@/components/useToast';
import { lowestPrice, productTitle } from '@/data/products';
import { useData } from '@/data/useData';
import type { Order, Product } from '@/data/types';
import { ApiError, api } from '@/lib/api';
import { formatINR, plural } from '@/lib/format';

type AppUser = { id: number; label: string; name: string; business: string; phone: string; blocked: boolean; lastSeenAt: string | null };
type Line = { key: number; productId: string; option?: string; qty: string; note: string };
type Errors = Partial<Record<'appUserId' | 'customer' | 'phone' | 'notes' | 'lines', string>> & Record<string, string | undefined>;

const RESULTS = 8;
let nextKey = 0;

const quantity = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : NaN);

/**
 * Staff make an order for a customer and send it to their app. The customer confirms it there (it then goes to the
 * inventory team) or declines it. Prices come from the catalogue now, as they would for an order placed in the app.
 */
export default function NewOrderRequestPage() {
  const { db, update } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [appUsers, setAppUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appUserId, setAppUserId] = useState(params.get('appUser') ?? '');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<AppUser[]>('/app-users')
      .then((users) => {
        setAppUsers(users.filter((user) => !user.blocked));
        const chosen = users.find((user) => String(user.id) === params.get('appUser'));
        if (chosen) fillFrom(chosen);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Couldn’t load the app users.'));
    // Only once: the page's starting customer comes from the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const products = useMemo(() => new Map(db.products.map((product) => [product.id, product])), [db.products]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return db.products
      .filter((product) => product.visible && [product.code, product.name, product.section, ...product.options.map((option) => option.code ?? '')].some((field) => field.toLowerCase().includes(needle)))
      .slice(0, RESULTS);
  }, [db.products, query]);

  function fillFrom(user: AppUser) {
    setCustomer(user.business || user.name || user.label);
    setPhone(user.phone);
  }

  const chooseAppUser = (id: string) => {
    setAppUserId(id);
    setErrors((current) => ({ ...current, appUserId: undefined }));
    const user = appUsers?.find((item) => String(item.id) === id);
    if (user) fillFrom(user);
  };

  const add = (product: Product) => {
    setLines((current) => [...current, { key: ++nextKey, productId: product.id, option: product.options[0]?.label, qty: '1', note: '' }]);
    setErrors((current) => ({ ...current, lines: undefined }));
    setQuery('');
  };
  const change = (key: number, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const remove = (key: number) => setLines((current) => current.filter((line) => line.key !== key));

  const mrpOf = (line: Line) => products.get(line.productId)?.options.find((option) => option.label === line.option)?.mrp;
  const total = lines.reduce((sum, line) => sum + (mrpOf(line) ?? 0) * (quantity(line.qty) || 0), 0);
  const unpriced = lines.filter((line) => mrpOf(line) === undefined).length;
  const items = lines.reduce((sum, line) => sum + (quantity(line.qty) || 0), 0);
  const chosen = appUsers?.find((user) => String(user.id) === appUserId);

  const send = async () => {
    const found: Errors = {};
    if (!appUserId) found.appUserId = 'Choose who to send it to.';
    if (!customer.trim()) found.customer = 'Enter the customer or site name.';
    if (!lines.length) found.lines = 'Add at least one product.';
    lines.forEach((line) => {
      const qty = quantity(line.qty);
      if (!(qty >= 1 && qty <= 100_000)) found[`qty-${line.key}`] = 'Enter a whole number from 1.';
    });
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setSending(true);
    try {
      const { orders } = await api<{ orders: Order[] }>('/orders', 'POST', {
        appUserId: Number(appUserId),
        customer: customer.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        lines: lines.map((line) => ({ productId: line.productId, ...(line.option !== undefined && { option: line.option }), qty: quantity(line.qty), ...(line.note.trim() && { note: line.note.trim() }) })),
      });
      const created = orders[0]!;
      // Already saved on the server: this only adds it to the list and the activity log.
      await update('orders', (current) => [created, ...current], { area: 'orders', summary: `Sent order request ${created.number} to ${chosen?.label ?? created.customer}`, to: `/orders/${created.id}` });
      toast({ message: `${created.number} sent to ${chosen?.label ?? created.customer}. It appears in their app for them to confirm.` });
      navigate('/order-requests', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      const field = error instanceof ApiError ? error.field : undefined;
      if (field === 'appUserId' || field === 'customer' || field === 'phone' || field === 'notes') setErrors({ [field]: message });
      else if (field?.startsWith('lines')) setErrors({ lines: message });
      else toast({ tone: 'error', message: `${message} The request wasn’t sent.` });
    } finally {
      setSending(false);
    }
  };

  if (loadError)
    return (
      <>
        <PageHeader title="New Order Request" crumbs={[{ label: 'Order Requests', to: '/order-requests' }]} />
        <Card>
          <EmptyState icon={DeviceMobileIcon} title="Couldn’t load app users" action={<Button onClick={() => window.location.reload()}>Try Again</Button>}>
            {loadError}
          </EmptyState>
        </Card>
      </>
    );

  if (appUsers && !appUsers.length)
    return (
      <>
        <PageHeader title="New Order Request" crumbs={[{ label: 'Order Requests', to: '/order-requests' }]} />
        <Card>
          <EmptyState
            icon={DeviceMobileIcon}
            title="No app users yet"
            action={
              <ButtonLink to="/app-users" variant="primary">
                Go to App Users
              </ButtonLink>
            }
          >
            A request is sent to a customer’s app, so connect their app to the shop first.
          </EmptyState>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Request Order"
        crumbs={[{ label: 'Order Requests', to: '/order-requests' }]}
        description="Make an order for a customer and send it to their app. When they confirm it, it goes straight to the inventory team."
      />

      <div className="editor">
        <div className="stack">
          <Card aria-labelledby="products-title">
            <CardHeader id="products-title" title="Products" description={lines.length ? `${plural(lines.length, 'line')} · ${plural(items, 'item')}` : 'Search by code or name, then add.'} />
            <div className="card__body stack">
              <SearchInput label="Search products" placeholder="Product code or name, e.g. TGH-55" value={query} onChange={setQuery} />
              {query.trim() && (
                <ul className="list" aria-label="Matching products">
                  {results.length ? (
                    results.map((product) => {
                      const from = lowestPrice(product);
                      return (
                        <li key={product.id} className="list-row">
                          <span className="cell-media" style={{ flex: 1, minWidth: 0 }}>
                            <Thumb src={product.image} />
                            <span style={{ minWidth: 0 }}>
                              <span className="cell-title" style={{ display: 'block' }}>
                                {productTitle(product)}
                              </span>
                              <span className="cell-sub mono">{product.code}</span>
                              <span className="cell-sub"> · {from === undefined ? 'catalogue price' : product.options.length > 1 ? `from ${formatINR(from)}` : formatINR(from)}</span>
                            </span>
                          </span>
                          <Button size="sm" icon={PlusIcon} onClick={() => add(product)} aria-label={`Add ${productTitle(product)}, ${product.code}`}>
                            Add
                          </Button>
                        </li>
                      );
                    })
                  ) : (
                    <li className="list-row muted">No products match “{query.trim()}”.</li>
                  )}
                </ul>
              )}
              {errors.lines && (
                <p className="field__error" role="alert">
                  {errors.lines}
                </p>
              )}
            </div>

            {lines.length > 0 && (
              <div className="table-scroll">
                <table className="table table--request">
                  <caption className="visually-hidden">Products in this order request</caption>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" className="is-num">
                        Qty
                      </th>
                      <th scope="col" className="is-num">
                        Total
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const product = products.get(line.productId)!;
                      const mrp = mrpOf(line);
                      const qty = quantity(line.qty);
                      const title = productTitle(product);
                      return (
                        <tr key={line.key}>
                          <td>
                            <div className="cell-media">
                              <Thumb src={product.image} />
                              <div className="stack" style={{ minWidth: 0, flex: 1, gap: 'var(--space-2)' }}>
                                <span>
                                  <Link to={`/products/${product.id}`} className="cell-title">
                                    {title}
                                  </Link>
                                  <span className="cell-sub mono" style={{ display: 'block' }}>
                                    {product.code}
                                  </span>
                                </span>
                                {product.options.length > 0 ? (
                                  <SelectField
                                    label={`Option for ${title}`}
                                    className="field--compact"
                                    value={line.option}
                                    onChange={(event) => change(line.key, { option: event.target.value })}
                                    options={product.options.map((option) => ({ value: option.label, label: `${option.label} · ${formatINR(option.mrp)}` }))}
                                  />
                                ) : (
                                  <span className="cell-sub">Priced from the catalogue page</span>
                                )}
                                <TextField label={`Note for ${title}`} className="field--compact" value={line.note} maxLength={500} placeholder="Optional, e.g. finish or size" onChange={(event) => change(line.key, { note: event.target.value })} />
                              </div>
                            </div>
                          </td>
                          <td className="is-num" style={{ verticalAlign: 'top' }}>
                            <TextField
                              label={`Quantity of ${title}`}
                              className="field--compact field--qty"
                              inputMode="numeric"
                              value={line.qty}
                              error={errors[`qty-${line.key}`]}
                              onChange={(event) => change(line.key, { qty: event.target.value.replace(/\D/g, '').slice(0, 6) })}
                            />
                          </td>
                          <td className="is-num" style={{ verticalAlign: 'top' }}>
                            {mrp === undefined ? <span className="cell-sub">—</span> : Number.isFinite(qty) ? formatINR(mrp * qty) : '—'}
                          </td>
                          <td style={{ verticalAlign: 'top' }}>
                            <IconButton icon={TrashIcon} tone="danger" label={`Remove ${title}`} onClick={() => remove(line.key)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2} className="table__total-label">
                        Total at MRP{unpriced ? `, ${plural(lines.length - unpriced, 'priced line')}` : ''}
                      </th>
                      <td className="is-num table__total">{formatINR(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="stack editor__aside">
          <Card aria-labelledby="to-title">
            <CardHeader id="to-title" title="Send to" description="The customer sees it in their app under Orders, ready to confirm." />
            <div className="card__body stack">
              <SelectField
                label="App user"
                required
                value={appUserId}
                disabled={!appUsers}
                error={errors.appUserId}
                onChange={(event) => chooseAppUser(event.target.value)}
                options={[
                  { value: '', label: appUsers ? 'Choose a customer’s app…' : 'Loading…' },
                  ...(appUsers ?? []).map((user) => ({
                    value: String(user.id),
                    label: `${user.label}${user.business || user.name ? ` · ${user.business || user.name}` : ''}${user.lastSeenAt ? '' : ' (not connected yet)'}`,
                  })),
                ]}
                hint={chosen && !chosen.lastSeenAt ? 'This app hasn’t connected yet. They’ll see the request once they enter their token.' : undefined}
              />
              <TextField label="Customer or site name" required value={customer} maxLength={200} error={errors.customer} onChange={(event) => setCustomer(event.target.value)} />
              <TextField label="Phone" value={phone} maxLength={40} inputMode="tel" error={errors.phone} onChange={(event) => setPhone(event.target.value)} />
              <TextAreaField label="Delivery notes" value={notes} maxLength={2000} rows={3} error={errors.notes} placeholder="Delivery address, timing…" onChange={(event) => setNotes(event.target.value)} />
            </div>
          </Card>

          <Card aria-labelledby="summary-title">
            <CardHeader id="summary-title" title="Summary" />
            <div className="card__body stack">
              <dl className="kv kv--compact">
                <dt>Products</dt>
                <dd className="num">{plural(lines.length, 'line')}</dd>
                <dt>Items</dt>
                <dd className="num">{items}</dd>
                <dt>Total at MRP</dt>
                <dd className="num">{formatINR(total)}</dd>
              </dl>
              {unpriced > 0 && <p className="muted">{plural(unpriced, 'line')} priced from the catalogue page, left out of the total.</p>}
              <Button variant="primary" icon={PaperPlaneTiltIcon} loading={sending} loadingLabel="Sending…" onClick={send} block>
                Send to Customer
              </Button>
              <ButtonLink to="/order-requests" block>
                Cancel
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
