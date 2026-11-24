import type { ReactNode } from 'react';

import { PRINT_UNIT, computeInvoice, invoiceAmount, invoiceDay, invoiceHsnTable, invoiceTaxRows } from '@/data/gst';
import { GSTIN, codeOfState, stateOfGstin } from '@/data/india';
import { r2 } from '@/data/purchases';
import type { GstSettings, Order, SalesInvoice, StockItem } from '@/data/types';
import { rupeesInWords } from '@/lib/words';

/** The shop's own details from its general settings: what a bill prints when the GST settings aren't to hand. */
export type Company = { companyName: string; address: string; phone: string; email: string; logo: string };

export const Pair = ({ label, value }: { label: string; value: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd className="num">{value}</dd>
  </>
);

/** A day typed as a date prints as 5-Nov-26; anything else as typed. */
const printedDay = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? invoiceDay(value) : (value ?? ''));
const balance = (value: number) => `${invoiceAmount(value)} ${value < 0 ? 'Cr' : 'Dr'}`;

/** The seller, consignee or buyer, as the invoice prints them. */
function Party({ title, name, address, gstin, state, code, contact, phone, email }: { title?: string; name: string; address?: string; gstin?: string; state?: string; code?: string; contact?: string; phone?: string; email?: string }) {
  return (
    <section className="tally__cell tally__party">
      {title && <div className="tally__label">{title}</div>}
      <strong className="tally__name">{name}</strong>
      {address && <div className="tally__address">{address}</div>}
      <dl className="tally__facts">
        {gstin && <Pair label="GSTIN/UIN" value={gstin} />}
        {state && <Pair label="State Name" value={`${state}${code ? `, Code : ${code}` : ''}`} />}
        {contact && <Pair label="Contact person" value={contact} />}
        {phone && <Pair label="Contact" value={phone} />}
        {email && <Pair label="E-Mail" value={email} />}
      </dl>
    </section>
  );
}

/**
 * An order's estimate: the tax invoice it would get, worked out as the server makes a draft (server/src/gst.ts): each
 * line's code, its name under it, HSN, unit and GST rate from Stock (18% if not set), MRP as the rate before GST.
 * shortcut: always CGST + SGST, as for a buyer in the shop's state; the draft invoice sets IGST for another state.
 */
export function estimateOf(order: Order, stock: StockItem[]): SalesInvoice {
  const items = new Map(stock.map((item) => [`${item.productId}\u0000${item.option}`, item]));
  const figures = computeInvoice(
    order.lines.map((line) => {
      const item = items.get(`${line.productId}\u0000${line.option ?? ''}`);
      return {
        productId: line.productId,
        option: line.option ?? '',
        description: line.optionCode ?? line.code,
        detail: line.option ? `${line.name} · ${line.option}` : line.name,
        hsn: item?.hsn ?? '',
        qty: line.qty,
        unit: item?.unit ?? ('pcs' as const),
        rate: line.mrp ?? item?.sellingPrice ?? 0,
        discountPct: 0,
        gstRate: item?.gstRate ?? 18,
      };
    }),
    false,
  );
  const day = new Date(order.createdAt).toLocaleDateString('en-CA');
  const unpriced = order.lines.filter((line) => line.mrp === undefined).length;
  return {
    id: '',
    orderId: order.id,
    orderNumber: order.number,
    invoiceDate: day,
    status: 'draft',
    customerName: order.customer,
    billingAddress: order.notes,
    interstate: false,
    taxable: figures.taxable,
    cgst: figures.cgst,
    sgst: figures.sgst,
    igst: figures.igst,
    roundOff: figures.roundOff,
    total: figures.total,
    notes: unpriced ? `${unpriced} item${unpriced === 1 ? ' is' : 's are'} priced from the catalogue: the rate is confirmed on the tax invoice.` : undefined,
    details: { buyerPhone: order.phone, reference: `${order.number} dt. ${invoiceDay(day)}`, paymentTerms: order.terms === 'cash' ? 'Cash' : order.terms === 'credit' ? 'Credit' : undefined },
    items: figures.lines,
    createdBy: '',
    createdAt: order.createdAt,
  };
}

/**
 * A tax invoice laid out as the shop's Tally invoices are, the same on screen and on paper. With `estimate`, the same
 * bill for an order not invoiced yet: titled ESTIMATE, with no invoice number or balance. Without the GST settings
 * (only Owners read them), the seller's details come from the shop's general settings.
 */
export function InvoiceDocument({ invoice, settings, company, estimate = false }: { invoice: SalesInvoice; settings: GstSettings | null; company: Company; estimate?: boolean }) {
  const cancelled = invoice.status === 'cancelled';
  const details = invoice.details ?? {};
  const tax = r2(invoice.cgst + invoice.sgst + invoice.igst);
  const legalName = settings?.legalName || company.companyName;
  const sellerGstin = invoice.sellerGstin ?? settings?.gstin ?? '';
  const sellerState = stateOfGstin(sellerGstin);
  const taxRows = invoiceTaxRows(invoice.items, invoice.interstate);
  const hsnRows = invoiceHsnTable(invoice.items);
  const units = [...new Set(invoice.items.map((item) => item.unit))];
  const totalQty = units.length === 1 ? `${Math.round(invoice.items.reduce((sum, item) => sum + item.qty, 0) * 1000) / 1000} ${PRINT_UNIT[units[0]!]}` : '';
  const shipGstin = details.shipGstin || '';
  const shipState = details.shipState || invoice.placeOfSupply || '';
  const shipCode = GSTIN.test(shipGstin) ? shipGstin.slice(0, 2) : codeOfState(shipState);
  const previous = estimate ? undefined : invoice.previousBalance;
  const phone = settings?.phone || company.phone;
  const email = settings?.email || company.email;
  const title = estimate ? 'ESTIMATE' : cancelled ? 'TAX INVOICE (CANCELLED)' : 'TAX INVOICE';

  const refs: [string, string | undefined][] = [
    estimate ? ['Order No.', invoice.orderNumber] : ['Invoice No.', invoice.number ?? ''],
    ['Dated', invoiceDay(invoice.invoiceDate)],
    ['Delivery Note', details.deliveryNote],
    ['Mode/Terms of Payment', details.paymentTerms],
    ['Reference No. & Date.', details.reference],
    ['Other References', details.otherReferences],
    ['Buyer’s Order No.', details.buyerOrderNo],
    ['Dated', printedDay(details.buyerOrderDate)],
    ['Dispatch Doc No.', details.dispatchDocNo],
    ['Delivery Note Date', printedDay(details.deliveryNoteDate)],
    ['Dispatched through', details.dispatchedThrough],
    ['Destination', details.destination],
  ];

  return (
    <div className="tally-scroll">
      <article className="tally" aria-label={estimate ? `Estimate for order ${invoice.orderNumber}` : `Tax invoice ${invoice.number}`}>
        <h2 className="tally__title">{title}</h2>
        <div className="tally__box">
          <div className="tally__top">
            <div className="tally__parties">
              <section className="tally__cell tally__seller">
                {company.logo && <img className="tally__logo" src={company.logo} alt="" width={64} height={64} />}
                <div className="tally__party">
                  <strong className="tally__name">{legalName}</strong>
                  {settings?.tradeName && settings.tradeName.toLowerCase() !== legalName.toLowerCase() && <div>{settings.tradeName}</div>}
                  {(settings?.address || company.address) && <div className="tally__address">{settings?.address || company.address}</div>}
                  {sellerState && (
                    <div>
                      {sellerState}
                      {settings?.pincode ? ` - ${settings.pincode}` : ''}, India
                    </div>
                  )}
                  <dl className="tally__facts tally__facts--inline">
                    {sellerGstin && <Pair label="GSTIN/UIN" value={sellerGstin} />}
                    {sellerState && <Pair label="State Name" value={`${sellerState}, Code : ${sellerGstin.slice(0, 2)}`} />}
                    {phone && <Pair label="Contact" value={phone} />}
                    {email && <Pair label="E-Mail" value={email} />}
                  </dl>
                </div>
              </section>
              <Party
                title="Consignee (Ship to)"
                name={details.shipName || invoice.customerName}
                address={details.shipAddress || invoice.billingAddress}
                gstin={shipGstin || (details.shipName ? '' : invoice.customerGstin)}
                state={shipState}
                code={shipCode}
                contact={details.shipContact}
                phone={details.shipPhone}
                email={details.shipEmail}
              />
              <Party
                title="Buyer (Bill to)"
                name={invoice.customerName}
                address={invoice.billingAddress}
                gstin={invoice.customerGstin || ''}
                state={invoice.placeOfSupply}
                code={invoice.posCode}
                contact={details.buyerContact}
                phone={details.buyerPhone}
                email={details.buyerEmail}
              />
            </div>
            <div className="tally__refs">
              <dl className="tally__ref-grid">
                {refs.map(([label, value], index) => (
                  <div key={index} className="tally__ref">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <dl className="tally__ref tally__ref--wide">
                <dt>Terms of Delivery</dt>
                <dd className="tally__address">{details.deliveryTerms}</dd>
              </dl>
            </div>
          </div>

          <table className="tally__lines">
            <colgroup>
              <col style={{ width: '5%' }} />
              <col />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  Sl
                  <br />
                  No.
                </th>
                <th scope="col">Description of Goods</th>
                <th scope="col">HSN/SAC</th>
                <th scope="col">Quantity</th>
                <th scope="col">Rate</th>
                <th scope="col">per</th>
                <th scope="col">Disc. %</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={index}>
                  <td className="tally__c">{index + 1}</td>
                  <td>
                    <strong>{item.description}</strong>
                    {item.detail && <div className="tally__detail">{item.detail}</div>}
                  </td>
                  <td>{item.hsn}</td>
                  <td className="tally__n">
                    <strong>
                      {item.qty} {PRINT_UNIT[item.unit]}
                    </strong>
                  </td>
                  <td className="tally__n">{invoiceAmount(item.rate)}</td>
                  <td>{PRINT_UNIT[item.unit]}</td>
                  <td className="tally__n">{item.discountPct ? `${item.discountPct} %` : ''}</td>
                  <td className="tally__n">
                    <strong>{invoiceAmount(item.amount)}</strong>
                  </td>
                </tr>
              ))}
              <tr>
                {blanks(7)}
                <td className="tally__n tally__subtotal">{invoiceAmount(invoice.taxable)}</td>
              </tr>
              {taxRows.map((row) => (
                <tr key={row.label}>
                  <td />
                  <td className="tally__ledger">
                    <strong>{row.label}</strong>
                  </td>
                  <td />
                  <td />
                  <td className="tally__n">{row.rate} %</td>
                  <td />
                  <td />
                  <td className="tally__n">
                    <strong>{invoiceAmount(row.amount)}</strong>
                  </td>
                </tr>
              ))}
              {invoice.roundOff !== 0 && (
                <tr>
                  <td />
                  <td className="tally__ledger">
                    {invoice.roundOff < 0 && <span className="tally__less">Less :</span>}
                    <strong>Rounding Off</strong>
                  </td>
                  {blanks(5)}
                  <td className="tally__n">
                    <strong>
                      {invoice.roundOff < 0 ? '(-)' : ''}
                      {invoiceAmount(invoice.roundOff)}
                    </strong>
                  </td>
                </tr>
              )}
              <tr className="tally__fill" aria-hidden>
                {blanks(8)}
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className="tally__n">Total</td>
                <td />
                <td className="tally__n">
                  <strong>{totalQty}</strong>
                </td>
                {blanks(3)}
                <td className="tally__n tally__grand">₹ {invoiceAmount(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="tally__cell tally__words">
            <div className="tally__split">
              <span>Amount Chargeable (in words)</span>
              <em>E. &amp; O.E</em>
            </div>
            <strong>{rupeesInWords(invoice.total)}</strong>
            {previous !== null && previous !== undefined && (
              <dl className="tally__balance">
                <Pair label="Previous Balance :" value={<strong>{balance(previous)}</strong>} />
                <Pair label="Current Balance :" value={<strong>{balance(r2(previous + invoice.total))}</strong>} />
              </dl>
            )}
          </div>

          <table className="tally__hsn">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  HSN/SAC
                </th>
                <th scope="col" rowSpan={2}>
                  Taxable
                  <br />
                  Value
                </th>
                {invoice.interstate ? (
                  <th scope="colgroup" colSpan={2}>
                    IGST
                  </th>
                ) : (
                  <>
                    <th scope="colgroup" colSpan={2}>
                      CGST
                    </th>
                    <th scope="colgroup" colSpan={2}>
                      SGST/UTGST
                    </th>
                  </>
                )}
                <th scope="col" rowSpan={2}>
                  Total
                  <br />
                  Tax Amount
                </th>
              </tr>
              <tr>
                {(invoice.interstate ? ['IGST'] : ['CGST', 'SGST']).map((head) => (
                  <HeadPair key={head} />
                ))}
              </tr>
            </thead>
            <tbody>
              {hsnRows.map((row) => (
                <tr key={`${row.hsn}|${row.rate}`}>
                  <td>{row.hsn || '—'}</td>
                  <td className="tally__n">{invoiceAmount(row.taxable)}</td>
                  {invoice.interstate ? (
                    <>
                      <td className="tally__n">{row.rate}%</td>
                      <td className="tally__n">{invoiceAmount(row.heads.igst)}</td>
                    </>
                  ) : (
                    <>
                      <td className="tally__n">{row.rate / 2}%</td>
                      <td className="tally__n">{invoiceAmount(row.heads.cgst)}</td>
                      <td className="tally__n">{row.rate / 2}%</td>
                      <td className="tally__n">{invoiceAmount(row.heads.sgst)}</td>
                    </>
                  )}
                  <td className="tally__n">{invoiceAmount(row.tax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="tally__n">
                  Total
                </th>
                <td className="tally__n">{invoiceAmount(invoice.taxable)}</td>
                {invoice.interstate ? (
                  <>
                    <td />
                    <td className="tally__n">{invoiceAmount(invoice.igst)}</td>
                  </>
                ) : (
                  <>
                    <td />
                    <td className="tally__n">{invoiceAmount(invoice.cgst)}</td>
                    <td />
                    <td className="tally__n">{invoiceAmount(invoice.sgst)}</td>
                  </>
                )}
                <td className="tally__n">{invoiceAmount(tax)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="tally__end">
            <div className="tally__end-left">
              <p>
                Tax Amount (in words) : <strong>{rupeesInWords(tax)}</strong>
              </p>
              {invoice.notes && (
                <p className="tally__address">
                  <span className="tally__label">Remarks:</span> {invoice.notes}
                </p>
              )}
              <div className="tally__declaration">
                <span className="tally__label tally__label--rule">Declaration</span>
                <div className="tally__address">
                  {estimate ? 'This is an estimate, not a tax invoice. Rates and taxes are as on its date; the tax invoice follows.' : settings?.declaration}
                </div>
                {settings?.terms && <div className="tally__address">{settings.terms}</div>}
              </div>
            </div>
            <div className="tally__end-right">
              {settings && (settings.bankName || settings.bankAccount || settings.bankBranchIfsc) && (
                <div className="tally__bank">
                  <div>Company’s Bank Details</div>
                  <dl className="tally__facts">
                    {settings.bankName && <Pair label="Bank Name" value={<strong>{settings.bankName}</strong>} />}
                    {settings.bankAccount && <Pair label="A/c No." value={<strong>{settings.bankAccount}</strong>} />}
                    {settings.bankBranchIfsc && <Pair label="Branch & IFS Code" value={<strong>{settings.bankBranchIfsc}</strong>} />}
                  </dl>
                </div>
              )}
              <div className="tally__sign">
                <strong>for {legalName}</strong>
                <span>Authorised Signatory</span>
              </div>
            </div>
          </div>
        </div>
        {settings?.jurisdiction && <p className="tally__after">{settings.jurisdiction}</p>}
        <p className="tally__after">{estimate ? 'This is a Computer Generated Estimate' : 'This is a Computer Generated Invoice'}</p>
      </article>
    </div>
  );
}

/** Empty cells that keep the invoice's column lines running down the page. */
const blanks = (count: number) => Array.from({ length: count }, (_, index) => <td key={index} />);

const HeadPair = () => (
  <>
    <th scope="col">Rate</th>
    <th scope="col">Amount</th>
  </>
);
