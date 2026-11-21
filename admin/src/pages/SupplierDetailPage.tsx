import { ChatCircleTextIcon, PencilSimpleIcon, PhoneIcon, PlusIcon, ReceiptIcon, TrashIcon, TruckIcon, UsersThreeIcon, WalletIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Badge } from '@/components/Badge';
import { Button, ButtonLink, IconButton } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { DataTable, type Column } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Stat } from '@/components/Stat';
import { SupplierDrawer } from '@/components/SupplierDrawer';
import { SupplierPaymentDrawer } from '@/components/SupplierPaymentDrawer';
import { useToast } from '@/components/useToast';
import { whatsappLink } from '@/data/orders';
import { PAYMENT_METHODS, dayLabel, localDay } from '@/data/payments';
import { PURCHASE_STATUS, balanceOf, formatMoney, ledger, payState } from '@/data/purchases';
import type { Answer } from '@/data/stock';
import type { Purchase, SupplierPayment } from '@/data/types';
import { useData } from '@/data/useData';
import { usePurchasing } from '@/hooks/usePurchasing';
import { api } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';

type Paid = SupplierPayment & { purchaseId: string | null; purchaseNumber: string | null };

export default function SupplierDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { send } = useData();
  const { suppliers, purchases, error, apply, keepSupplier, reload } = usePurchasing();
  const [payments, setPayments] = useState<Paid[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [removing, setRemoving] = useState<Paid | null>(null);
  const supplier = suppliers?.find((one) => String(one.id) === id);

  // Raised after a payment is recorded or removed, to read the ledger again.
  const [paymentsVersion, setPaymentsVersion] = useState(0);
  const loadPayments = useCallback(() => setPaymentsVersion((count) => count + 1), []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<Paid[]>(`/suppliers/${encodeURIComponent(id)}/payments`).then(
      (loaded) => active && setPayments(loaded),
      () => active && setPayments([]),
    );
    return () => {
      active = false;
    };
  }, [id, paymentsVersion]);

  if (!suppliers || !purchases)
    return (
      <>
        <PageHeader title="Supplier" crumbs={[{ label: 'Suppliers', to: '/suppliers' }]} />
        <Card>
          <EmptyState icon={UsersThreeIcon} title={error ? 'Couldn’t load the supplier' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  if (!supplier)
    return (
      <>
        <PageHeader title="Supplier not found" crumbs={[{ label: 'Suppliers', to: '/suppliers' }]} />
        <Card>
          <EmptyState icon={UsersThreeIcon} title="This supplier doesn’t exist" action={<ButtonLink to="/suppliers" variant="primary">Back to Suppliers</ButtonLink>}>
            They may have been deleted.
          </EmptyState>
        </Card>
      </>
    );

  const today = localDay();
  const bills = purchases.filter((bill) => bill.supplier.id === supplier.id);
  const rows = payments ? ledger(supplier, bills, payments) : [];
  const overdue = bills.filter((bill) => payState(bill, supplier, today).label === 'Overdue');

  const afterPayment = (answer: Answer) => {
    apply(answer);
    void loadPayments();
  };
  const removePayment = async (payment: Paid) => {
    setRemoving(null);
    const answer = await send(`/suppliers/${supplier.id}/payments/${payment.id}`, 'DELETE', undefined, {
      area: 'purchases',
      summary: `Removed a ${formatMoney(payment.amount)} payment to ${supplier.name}${payment.purchaseNumber ? ` from ${payment.purchaseNumber}` : ''}`,
      to: `/suppliers/${supplier.id}`,
    });
    if (!answer) return;
    afterPayment(answer);
    toast({ message: 'Payment removed.' });
  };

  const billColumns: Column<Purchase>[] = [
    {
      key: 'number',
      header: 'Bill',
      sortValue: (bill) => bill.number,
      cell: (bill) => (
        <>
          <Link to={`/purchases/${bill.id}`} className="cell-title num">
            {bill.number}
          </Link>
          <div className="cell-sub">{bill.supplierInvoice ? `Their bill ${bill.supplierInvoice}` : 'No bill number'}</div>
        </>
      ),
    },
    { key: 'date', header: 'Bill date', sortValue: (bill) => bill.billDate, cell: (bill) => <span className="num">{dayLabel(bill.billDate)}</span> },
    { key: 'status', header: 'Status', cell: (bill) => <Badge tone={PURCHASE_STATUS[bill.status].tone}>{PURCHASE_STATUS[bill.status].label}</Badge> },
    { key: 'total', header: 'Total', align: 'num', sortValue: (bill) => bill.total, cell: (bill) => formatMoney(bill.total) },
    {
      key: 'balance',
      header: 'To pay',
      align: 'num',
      sortValue: (bill) => balanceOf(bill),
      cell: (bill) => {
        const state = payState(bill, supplier, today);
        return (
          <>
            {bill.status === 'cancelled' ? <span className="muted">—</span> : <span className={state.tone === 'danger' ? 'money-late' : undefined}>{formatMoney(balanceOf(bill))}</span>}
            <div className="cell-sub">{state.label}</div>
          </>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={supplier.name}
        crumbs={[{ label: 'Suppliers', to: '/suppliers' }]}
        description={[supplier.company, supplier.gstin && `GSTIN ${supplier.gstin}`, supplier.archived && 'Archived'].filter(Boolean).join(' · ') || 'Supplier'}
        actions={
          <>
            <Button icon={PencilSimpleIcon} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button icon={WalletIcon} onClick={() => setPaying(true)}>
              Record Payment
            </Button>
            {!supplier.archived && (
              <ButtonLink to={`/purchases/new?supplier=${supplier.id}`} variant="primary" icon={PlusIcon}>
                New Purchase
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="stack-lg">
        <div className="stats">
          <Stat label="Bought" icon={TruckIcon} value={formatMoney(supplier.billed)} foot={`${plural(supplier.bills, 'received bill')}${supplier.lastPurchase ? `, last ${dayLabel(supplier.lastPurchase)}` : ''}`} />
          <Stat label="Paid" icon={ReceiptIcon} value={formatMoney(supplier.paid)} foot={supplier.openingBalance ? `Opening balance ${formatMoney(supplier.openingBalance)}` : 'No opening balance'} />
          <Stat
            label={supplier.outstanding < 0 ? 'Advance with them' : 'To pay'}
            icon={WalletIcon}
            value={formatMoney(Math.abs(supplier.outstanding))}
            foot={overdue.length ? <span className="money-late">{plural(overdue.length, 'bill')} overdue</span> : supplier.paymentDays !== null ? `Terms: ${plural(supplier.paymentDays, 'day')}` : 'No payment terms set'}
          />
          <Stat label="Drafts" icon={PencilSimpleIcon} value={formatNumber(supplier.drafts)} foot={supplier.drafts ? 'Goods not received yet' : 'Nothing waiting'} />
        </div>

        <div className="editor">
          <div className="stack">
            <Card aria-labelledby="ledger-title" className="table-card">
              <CardHeader id="ledger-title" title="Ledger" description="Received bills add to what you owe; payments take it down. Drafts and cancelled bills aren’t in it." />
              {payments === null ? (
                <p className="card__body muted">Loading…</p>
              ) : rows.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <caption className="visually-hidden">Ledger for {supplier.name}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Entry</th>
                        <th scope="col" className="is-num">
                          Bill
                        </th>
                        <th scope="col" className="is-num">
                          Paid
                        </th>
                        <th scope="col" className="is-num">
                          Balance
                        </th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key}>
                          <td className="num">{dayLabel(row.day)}</td>
                          <td>
                            {row.to ? <Link to={row.to}>{row.label}</Link> : row.label}
                            {row.payment && (
                              <div className="cell-sub">
                                {PAYMENT_METHODS[row.payment.method]} · {row.payment.by}
                                {row.payment.note && ` · ${row.payment.note}`}
                              </div>
                            )}
                          </td>
                          <td className="is-num">{row.billed ? formatMoney(row.billed) : ''}</td>
                          <td className="is-num">{row.paid ? formatMoney(row.paid) : ''}</td>
                          <td className="is-num" style={{ fontWeight: 600 }}>
                            {formatMoney(row.balance)}
                          </td>
                          <td>{row.payment && <IconButton icon={TrashIcon} tone="danger" label={`Remove the ${formatMoney(row.payment.amount)} payment`} onClick={() => setRemoving(row.payment as Paid)} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card__body muted">Nothing yet. Received bills and payments appear here.</p>
              )}
            </Card>

            <Card aria-labelledby="bills-title" className="table-card">
              <CardHeader id="bills-title" title="Bills" description={plural(bills.length, 'bill')} />
              <DataTable
                caption={`Bills from ${supplier.name}`}
                rows={bills}
                columns={billColumns}
                getRowId={(bill) => bill.id}
                onRowClick={(bill) => navigate(`/purchases/${bill.id}`)}
                initialSort={{ key: 'date', direction: 'desc' }}
                pageSize={10}
                empty={
                  <EmptyState icon={TruckIcon} title="No bills yet" action={!supplier.archived && <ButtonLink to={`/purchases/new?supplier=${supplier.id}`} variant="primary" icon={PlusIcon}>New Purchase</ButtonLink>}>
                    Enter their first bill; receiving its goods adds them to stock.
                  </EmptyState>
                }
              />
            </Card>
          </div>

          <div className="stack editor__aside">
            <Card aria-labelledby="contact-title">
              <CardHeader id="contact-title" title="Contact" />
              <div className="card__body stack">
                <dl className="kv kv--compact" style={{ margin: 0 }}>
                  <dt>Contact</dt>
                  <dd>{supplier.contactPerson || '—'}</dd>
                  <dt>Phone</dt>
                  <dd className="num">{supplier.phone || '—'}</dd>
                  <dt>Email</dt>
                  <dd>{supplier.email || '—'}</dd>
                  <dt>State</dt>
                  <dd>{supplier.state || '—'}</dd>
                  <dt>Address</dt>
                  <dd style={{ whiteSpace: 'pre-line' }}>{supplier.address || '—'}</dd>
                </dl>
                {supplier.phone && (
                  <div className="row-wrap">
                    <a className="btn btn--secondary btn--sm" href={`tel:${supplier.phone.replace(/\s/g, '')}`}>
                      <PhoneIcon size={15} weight="bold" aria-hidden /> Call
                    </a>
                    <a className="btn btn--secondary btn--sm" href={whatsappLink(supplier.phone)} target="_blank" rel="noreferrer">
                      <ChatCircleTextIcon size={15} weight="bold" aria-hidden /> WhatsApp
                    </a>
                  </div>
                )}
              </div>
            </Card>
            {(supplier.bankDetails || supplier.notes) && (
              <Card aria-labelledby="bank-title">
                <CardHeader id="bank-title" title="Bank and notes" />
                <div className="card__body stack">
                  {supplier.bankDetails && <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{supplier.bankDetails}</p>}
                  {supplier.notes && (
                    <p className="muted" style={{ whiteSpace: 'pre-line', margin: 0 }}>
                      {supplier.notes}
                    </p>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      <SupplierDrawer
        open={editing}
        supplier={supplier}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          keepSupplier(saved);
          setEditing(false);
        }}
        onDeleted={() => {
          void reload();
          navigate('/suppliers', { replace: true });
        }}
      />
      <SupplierPaymentDrawer open={paying} onClose={() => setPaying(false)} supplier={supplier} bills={bills} onSaved={afterPayment} />
      <ConfirmDialog
        open={Boolean(removing)}
        title={removing ? `Remove the ${formatMoney(removing.amount)} payment?` : 'Remove payment?'}
        body={removing ? `${PAYMENT_METHODS[removing.method]} on ${dayLabel(removing.paidOn)}, recorded by ${removing.by}. ${supplier.name} will be owed it again. Only do this if it was entered by mistake.` : ''}
        confirmLabel="Remove Payment"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && removePayment(removing)}
      />
    </>
  );
}
