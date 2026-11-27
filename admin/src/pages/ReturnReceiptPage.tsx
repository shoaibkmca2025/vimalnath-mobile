import { ArrowUUpLeftIcon, PrinterIcon, WhatsappLogoIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { PRINT_UNIT, invoiceAmount, invoiceDay } from '@/data/gst';
import { stateOfGstin } from '@/data/india';
import { whatsappLink } from '@/data/orders';
import { CONDITIONS, REFUND_METHODS, REFUND_STATUS, RETURN_REASONS, RETURN_STATUS, moneyOf } from '@/data/returns';
import type { ReturnSettings, SalesReturn, ShopDetails } from '@/data/types';
import { useData } from '@/data/useData';
import { api } from '@/lib/api';
import { formatINR, formatNumber } from '@/lib/format';
import { rupeesInWords } from '@/lib/words';

type Loaded = { ret: SalesReturn; shop: ShopDetails; settings: ReturnSettings };

/**
 * A return's receipt, to print, save as PDF from the print dialog, or share. When the return carries a GST credit note it
 * is printed as that credit note, with what the rules ask of one: the shop's and buyer's GSTINs, its own number and date,
 * the original invoice's number and date, and the taxable value and tax credited by rate and HSN.
 */
export default function ReturnReceiptPage() {
  const { id } = useParams();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([api<{ return: SalesReturn }>(`/returns/${id}`), api<ShopDetails>('/returns/shop'), api<ReturnSettings>('/returns/settings')]).then(
      ([detail, shop, settings]) => active && setData({ ret: detail.return, shop, settings }),
      (problem: unknown) => active && setError(problem instanceof Error ? problem.message : 'Couldn’t load the receipt.'),
    );
    return () => {
      active = false;
    };
  }, [id]);
  if (!data)
    return (
      <>
        <PageHeader title="Return Receipt" crumbs={[{ label: 'Customer Returns', to: '/returns/list' }]} />
        <Card>
          <EmptyState icon={ArrowUUpLeftIcon} title={error ? 'Couldn’t load the receipt' : 'Loading…'}>
            {error}
          </EmptyState>
        </Card>
      </>
    );
  return <Receipt {...data} />;
}

function Receipt({ ret, shop, settings }: Loaded) {
  const { db } = useData();
  const note = ret.creditNote?.status === 'posted' ? ret.creditNote : null;
  const name = shop.legalName || db.settings.companyName;
  const sellerState = shop.gstin ? stateOfGstin(shop.gstin) : undefined;
  const money = moneyOf(ret);
  const taxed = Boolean(ret.invoiceId);
  const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst') => ret.items.reduce((total, item) => total + item[key], 0);
  const exact = sum('taxable') + sum('cgst') + sum('sgst') + sum('igst');
  const roundOff = Math.round((ret.returnValue - exact) * 100) / 100;
  const title = note ? 'CREDIT NOTE' : ret.kind === 'replacement' ? 'RETURN & REPLACEMENT RECEIPT' : 'RETURN RECEIPT';
  const settleLine =
    ret.settleAmount > 0 ? `Refundable to the customer: ${formatINR(ret.settleAmount)}` : ret.settleAmount < 0 ? `Payable by the customer: ${formatINR(-ret.settleAmount)}` : 'Even exchange: nothing payable either way';
  const share = () => {
    const lines = [
      `${name}: ${title.toLowerCase().replace(/^./, (char) => char.toUpperCase())} ${ret.number}`,
      `Date: ${invoiceDay(ret.returnDate)} · ${ret.orderId ? `Order ${ret.orderNumber}${ret.invoiceNumber ? ` · Invoice ${ret.invoiceNumber}` : ''}` : `Bill ${ret.orderNumber}`}`,
      ...ret.items.map((item) => `• ${formatNumber(item.qty)} ${PRINT_UNIT[item.unit]} ${item.description}: ${formatINR(item.amount)}`),
      ...(ret.replacementItems ?? []).map((item) => `↺ ${formatNumber(item.qty)} ${PRINT_UNIT[item.unit]} ${item.name}: ${formatINR(item.amount)}`),
      note ? `Credit note ${note.number}: ${formatINR(note.total)}` : '',
      settleLine,
      `Status: ${RETURN_STATUS[ret.status].label}`,
    ].filter(Boolean);
    window.open(`${whatsappLink(ret.customerPhone ?? '')}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  };

  return (
    <>
      <PageHeader
        title={`Receipt ${ret.number}`}
        crumbs={[
          { label: 'Customer Returns', to: '/returns/list' },
          { label: ret.number, to: `/returns/${ret.id}` },
        ]}
        description="Print it, or choose “Save as PDF” in the print dialog to download it."
        actions={
          <>
            <Button variant="primary" icon={PrinterIcon} onClick={() => window.print()} className="no-print">
              Print or Save PDF
            </Button>
            {ret.customerPhone && (
              <Button icon={WhatsappLogoIcon} onClick={share} className="no-print">
                Share on WhatsApp
              </Button>
            )}
          </>
        }
      />
      <div className="tally-scroll">
        <article className="tally" aria-label={`${title} ${ret.number}`}>
          <h2 className="tally__title">{title}</h2>
          <div className="tally__box">
            <div className="tally__top">
              <div className="tally__parties">
                <section className="tally__cell tally__party">
                  <strong className="tally__name">{name}</strong>
                  {shop.address && <div className="tally__address">{shop.address}</div>}
                  {sellerState && (
                    <div>
                      {sellerState}
                      {shop.pincode ? ` - ${shop.pincode}` : ''}, India
                    </div>
                  )}
                  <dl className="tally__facts">
                    {shop.gstin && (
                      <>
                        <dt>GSTIN/UIN</dt>
                        <dd>{shop.gstin}</dd>
                      </>
                    )}
                    {(shop.phone || db.settings.phone) && (
                      <>
                        <dt>Contact</dt>
                        <dd>{shop.phone || db.settings.phone}</dd>
                      </>
                    )}
                    {(shop.email || db.settings.email) && (
                      <>
                        <dt>E-Mail</dt>
                        <dd>{shop.email || db.settings.email}</dd>
                      </>
                    )}
                  </dl>
                </section>
                <section className="tally__cell tally__party">
                  <div className="tally__label">{note ? 'Buyer (Bill to)' : 'Customer'}</div>
                  <strong className="tally__name">{ret.customerName}</strong>
                  {ret.billingAddress && <div className="tally__address">{ret.billingAddress}</div>}
                  <dl className="tally__facts">
                    {ret.customerGstin && (
                      <>
                        <dt>GSTIN/UIN</dt>
                        <dd>{ret.customerGstin}</dd>
                      </>
                    )}
                    {ret.placeOfSupply && (
                      <>
                        <dt>State Name</dt>
                        <dd>
                          {ret.placeOfSupply}
                          {ret.posCode ? `, Code : ${ret.posCode}` : ''}
                        </dd>
                      </>
                    )}
                    {ret.customerPhone && (
                      <>
                        <dt>Contact</dt>
                        <dd>{ret.customerPhone}</dd>
                      </>
                    )}
                  </dl>
                </section>
              </div>
              <div className="tally__refs">
                <dl className="tally__ref-grid">
                  {(
                    [
                      note ? ['Credit Note No.', note.number] : ['Return No.', ret.number],
                      ['Dated', invoiceDay(note ? note.date : ret.returnDate)],
                      note ? ['Return No.', ret.number] : [ret.orderId ? 'Order No.' : 'Bill No.', ret.orderNumber],
                      ['Return Date', invoiceDay(ret.returnDate)],
                      ['Original Invoice No.', ret.invoiceNumber ?? '—'],
                      ['Invoice Date', ret.invoiceDate ? invoiceDay(ret.invoiceDate) : '—'],
                      ret.orderId ? ['Order No.', ret.orderNumber] : ['Sold', 'At the counter'],
                      ['Status', RETURN_STATUS[ret.status].label],
                    ] as [string, string][]
                  ).map(([label, value], index) => (
                    <div key={index} className="tally__ref">
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="tally__ref tally__ref--wide">
                  <dt>Reason for Return</dt>
                  <dd className="tally__address">
                    {RETURN_REASONS[ret.reason]}
                    {ret.reasonNote ? `: ${ret.reasonNote}` : ''}
                  </dd>
                </dl>
              </div>
            </div>

            <table className="tally__lines">
              <thead>
                <tr>
                  <th scope="col">Sl</th>
                  <th scope="col">Description of Goods Returned</th>
                  <th scope="col">HSN/SAC</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">{taxed ? 'Rate' : 'Price'}</th>
                  {taxed && <th scope="col">GST %</th>}
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ret.items.map((item, index) => (
                  <tr key={item.position}>
                    <td className="tally__c">{index + 1}</td>
                    <td>
                      <strong>{item.description}</strong>
                      <div className="tally__detail">
                        {item.name}
                        {item.name ? ' · ' : ''}
                        {CONDITIONS[item.condition]}
                      </div>
                    </td>
                    <td>{item.hsn}</td>
                    <td className="tally__n">
                      <strong>
                        {formatNumber(item.qty)} {PRINT_UNIT[item.unit]}
                      </strong>
                    </td>
                    <td className="tally__n">{invoiceAmount(item.rate)}</td>
                    {taxed && <td className="tally__n">{item.gstRate}%</td>}
                    <td className="tally__n">
                      <strong>{invoiceAmount(taxed ? item.taxable : item.amount)}</strong>
                    </td>
                  </tr>
                ))}
                {taxed && (
                  <>
                    {(ret.interstate ? [['IGST', sum('igst')]] : [['CGST', sum('cgst')], ['SGST', sum('sgst')]]).map(([head, value]) => (
                      <tr key={head as string}>
                        <td />
                        <td className="tally__ledger">
                          <strong>{head as string}</strong>
                        </td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td className="tally__n">
                          <strong>{invoiceAmount(value as number)}</strong>
                        </td>
                      </tr>
                    ))}
                    {roundOff !== 0 && (
                      <tr>
                        <td />
                        <td className="tally__ledger">
                          <strong>Rounding Off</strong>
                        </td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td className="tally__n">
                          <strong>
                            {roundOff < 0 ? '(-)' : ''}
                            {invoiceAmount(roundOff)}
                          </strong>
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className="tally__n">Total {note ? 'credited' : 'returned'}</td>
                  <td />
                  <td />
                  <td />
                  {taxed && <td />}
                  <td className="tally__n tally__grand">₹ {invoiceAmount(ret.returnValue)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="tally__cell tally__words">
              <span>Amount (in words)</span>
              <strong>{rupeesInWords(ret.returnValue)}</strong>
            </div>

            {ret.kind === 'replacement' && (ret.replacementItems ?? []).length > 0 && (
              <table className="tally__hsn">
                <thead>
                  <tr>
                    <th scope="col">Goods Given in Exchange</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Rate</th>
                    <th scope="col">Amount{taxed ? ' (with GST)' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {ret.replacementItems!.map((item) => (
                    <tr key={item.position}>
                      <td>
                        {item.name} <span className="tally__detail">{item.description}</span>
                      </td>
                      <td className="tally__n">
                        {formatNumber(item.qty)} {PRINT_UNIT[item.unit]}
                      </td>
                      <td className="tally__n">{invoiceAmount(item.rate)}</td>
                      <td className="tally__n">{invoiceAmount(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} className="tally__n">
                      Goods given
                    </th>
                    <td className="tally__n">{invoiceAmount(ret.replacementValue)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            <div className="tally__cell tally__words">
              {ret.charges > 0 && (
                <div className="tally__split">
                  <span>Less: {ret.chargesNote || 'Charges'}</span>
                  <strong>{invoiceAmount(ret.charges)}</strong>
                </div>
              )}
              <div className="tally__split">
                <strong>{settleLine}</strong>
              </div>
              {(ret.refunds ?? [])
                .filter((refund) => refund.status !== 'cancelled' && refund.status !== 'failed')
                .map((refund) => (
                  <div key={refund.id} className="tally__split">
                    <span>
                      {refund.direction === 'out' ? 'Refund' : 'Received'} · {REFUND_METHODS[refund.method]}
                      {refund.orderNumber ? ` (${refund.orderNumber})` : ''}
                      {refund.reference ? ` · ${refund.reference}` : ''}
                      {refund.paidOn ? ` · ${invoiceDay(refund.paidOn)}` : ''}
                    </span>
                    <span>
                      {invoiceAmount(refund.amount)} {REFUND_STATUS[refund.status].label}
                    </span>
                  </div>
                ))}
              {(money.pendingOut > 0 || money.pendingIn > 0) && <div className="tally__split">Balance: {formatINR(money.pendingOut || money.pendingIn)}</div>}
            </div>

            <div className="tally__end">
              <div className="tally__end-left">
                {settings.terms && (
                  <div className="tally__declaration" style={{ marginTop: 0, paddingTop: 0 }}>
                    <span className="tally__label tally__label--rule">Terms</span>
                    <div className="tally__address">{settings.terms}</div>
                  </div>
                )}
                <div className="tally__declaration">
                  <span className="tally__label">Customer’s signature</span>
                </div>
              </div>
              <div className="tally__end-right">
                <div className="tally__sign">
                  <strong>for {name}</strong>
                  <span>Authorised Signatory</span>
                </div>
              </div>
            </div>
          </div>
          {shop.jurisdiction && <p className="tally__after">{shop.jurisdiction}</p>}
          <p className="tally__after">This is a Computer Generated {note ? 'Credit Note' : 'Receipt'}</p>
        </article>
      </div>
    </>
  );
}
