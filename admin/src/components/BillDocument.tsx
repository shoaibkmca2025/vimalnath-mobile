import type { CSSProperties } from 'react';

import { InvoiceDocument, type Company } from '@/components/InvoiceDocument';
import { discountsOf } from '@/data/billing';
import { invoiceAmount, invoiceDay, invoiceHsnTable, invoiceTaxRows, printUnit } from '@/data/gst';
import { codeOfState, stateOfGstin } from '@/data/india';
import { r2 } from '@/data/purchases';
import type { BillingSettings, InvoiceItem, SalesInvoice } from '@/data/types';
import { rupeesInWords } from '@/lib/words';

type Props = {
  invoice: SalesInvoice;
  settings: BillingSettings;
  company: Company;
  /** A quotation printed as one: its validity instead of payments. */
  quote?: { validUntil?: string };
  /** Overrides Invoice Settings, e.g. to preview another template. */
  template?: BillingSettings['template'];
  paper?: BillingSettings['paperSize'];
};

/** What CSS @page wants for each paper size. */
export const PAGE_SIZE: Record<BillingSettings['paperSize'], string> = { A4: 'A4 portrait', A5: 'A5 portrait', thermal: '80mm auto' };
export const PAGE_MARGIN: Record<BillingSettings['paperSize'], string> = { A4: '10mm', A5: '7mm', thermal: '3mm' };

/**
 * A counter bill (or quotation) in the template chosen under Invoice Settings: classic is the shop's Tally layout;
 * modern and compact are lighter, in the theme colour; thermal paper always gets the till-roll receipt.
 */
export function BillDocument({ invoice, settings, company, quote, template = settings.template, paper = settings.paperSize }: Props) {
  const look = { heading: settings.heading, footer: settings.footer, logo: settings.logo, signature: settings.signature };
  if (paper === 'thermal') return <ThermalBill invoice={invoice} settings={settings} company={company} quote={quote} />;
  if (template === 'classic')
    return (
      <div className={`bill-paper bill-paper--${paper}`}>
        <InvoiceDocument invoice={invoice} settings={settings} company={company} look={look} quote={quote} />
      </div>
    );
  return <ModernBill invoice={invoice} settings={settings} company={company} quote={quote} compact={template === 'compact'} paper={paper} />;
}

const titleOf = (invoice: SalesInvoice, settings: BillingSettings, quote?: Props['quote']) => {
  const heading = settings.heading || (settings.registrationType === 'composition' ? 'BILL OF SUPPLY' : 'TAX INVOICE');
  if (quote) return 'QUOTATION';
  if (invoice.status === 'cancelled') return `${heading} (CANCELLED)`;
  return invoice.status === 'draft' ? `${heading} (DRAFT)` : heading;
};

/** Discount on a line, as printed: "10% + ₹5". */
const discountText = (item: InvoiceItem) => [item.discountPct ? `${item.discountPct}%` : '', item.discountAmount ? `₹${invoiceAmount(item.discountAmount)}` : ''].filter(Boolean).join(' + ');

function ModernBill({ invoice, settings, company, quote, compact, paper }: Omit<Props, 'template'> & { compact: boolean; paper: BillingSettings['paperSize'] }) {
  const legalName = settings.legalName || company.companyName;
  const logo = settings.logo || company.logo;
  const sellerGstin = invoice.sellerGstin ?? settings.gstin;
  const sellerState = stateOfGstin(sellerGstin);
  const goods = invoice.items.filter((item) => item.lineType !== 'charge');
  const charges = invoice.items.filter((item) => item.lineType === 'charge');
  const discounts = discountsOf(invoice);
  const inclusive = Boolean(invoice.pricesIncludeGst);
  const gross = r2(goods.reduce((sum, item) => sum + item.qty * (inclusive ? item.rate / (1 + item.gstRate / 100) : item.rate), 0));
  const lineDiscounts = r2(goods.reduce((sum, item) => sum + (inclusive ? item.qty * (item.rate / (1 + item.gstRate / 100)) : item.qty * item.rate) - item.amount, 0));
  const tax = r2(invoice.cgst + invoice.sgst + invoice.igst);
  const counter = invoice.source === 'counter' && !quote;
  const paid = counter && invoice.status !== 'cancelled' ? (invoice.paid ?? 0) : 0;
  const due = Math.max(0, r2(invoice.total - paid));
  const taxRows = invoiceTaxRows(invoice.items, invoice.interstate);
  const hsnRows = invoiceHsnTable(invoice.items);
  const style = { '--bill-accent': settings.themeColor || '#1d4ed8' } as CSSProperties;
  const phone = settings.phone || company.phone;
  const email = settings.email || company.email;

  return (
    <div className="tally-scroll">
      <article className={`bill bill-paper bill-paper--${paper}${compact ? ' bill--compact' : ''}${invoice.status === 'cancelled' ? ' bill--void' : ''}`} style={style} aria-label={`${quote ? 'Quotation' : 'Invoice'} ${invoice.number ?? '(draft)'}`}>
        <header className="bill__head">
          <div className="bill__seller">
            {logo && <img className="bill__logo" src={logo} alt="" width={56} height={56} />}
            <div>
              <strong className="bill__shop">{legalName}</strong>
              {settings.tradeName && settings.tradeName.toLowerCase() !== legalName.toLowerCase() && <div>{settings.tradeName}</div>}
              <div className="bill__muted">
                {[settings.address || company.address, sellerState && `${sellerState}${settings.pincode ? ` - ${settings.pincode}` : ''}`].filter(Boolean).join(', ')}
              </div>
              <div className="bill__muted">{[sellerGstin && `GSTIN ${sellerGstin}`, phone, email].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div className="bill__doc">
            <h2 className="bill__title">{titleOf(invoice, settings, quote)}</h2>
            <dl className="bill__facts">
              <dt>{quote ? 'Quotation No.' : 'Invoice No.'}</dt>
              <dd>{invoice.number ?? 'Draft'}</dd>
              <dt>Date</dt>
              <dd>{invoiceDay(invoice.invoiceDate)}</dd>
              {quote?.validUntil && (
                <>
                  <dt>Valid until</dt>
                  <dd>{invoiceDay(quote.validUntil)}</dd>
                </>
              )}
              {counter && invoice.dueDate && (
                <>
                  <dt>Due date</dt>
                  <dd>{invoiceDay(invoice.dueDate)}</dd>
                </>
              )}
              {invoice.quotationNumber && (
                <>
                  <dt>Quotation</dt>
                  <dd>{invoice.quotationNumber}</dd>
                </>
              )}
            </dl>
          </div>
        </header>

        <section className="bill__parties">
          <div>
            <div className="bill__label">Bill to</div>
            <strong>{invoice.customerName}</strong>
            {invoice.billingAddress && <div className="bill__muted bill__pre">{invoice.billingAddress}</div>}
            <div className="bill__muted">{[invoice.customerPhone, invoice.customerGstin && `GSTIN ${invoice.customerGstin}`].filter(Boolean).join(' · ')}</div>
          </div>
          <div>
            <div className="bill__label">Place of supply</div>
            <strong>
              {invoice.placeOfSupply}
              {invoice.placeOfSupply ? ` (${invoice.posCode || codeOfState(invoice.placeOfSupply)})` : ''}
            </strong>
            <div className="bill__muted">{invoice.interstate ? 'IGST: another state' : 'CGST + SGST: same state'}</div>
            {inclusive && <div className="bill__muted">Rates include GST</div>}
          </div>
        </section>

        <table className="bill__lines">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">HSN</th>
              <th scope="col" className="bill__n">
                Qty
              </th>
              <th scope="col" className="bill__n">
                Rate
              </th>
              <th scope="col" className="bill__n">
                Discount
              </th>
              <th scope="col" className="bill__n">
                Taxable
              </th>
              <th scope="col" className="bill__n">
                GST
              </th>
              <th scope="col" className="bill__n">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => {
              const measured = discounts.lines[index];
              const charge = item.lineType === 'charge';
              return (
                <tr key={index} className={charge ? 'bill__charge' : undefined}>
                  <td>{charge ? '' : goods.indexOf(item) + 1}</td>
                  <td>
                    <strong>{item.description}</strong>
                    {item.detail && <div className="bill__muted">{item.detail}</div>}
                    {!compact && (item.sku || item.categoryLabel) && <div className="bill__muted">{[item.sku && `SKU ${item.sku}`, item.categoryLabel].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td>{item.hsn}</td>
                  <td className="bill__n">{charge ? '' : `${item.qty} ${printUnit(item.unit)}`}</td>
                  <td className="bill__n">{charge ? '' : invoiceAmount(item.rate)}</td>
                  <td className="bill__n">
                    {measured && measured.value > 0 ? (
                      <>
                        {discountText(item) || 'Bill'}
                        <div className="bill__muted">−{invoiceAmount(measured.value)}</div>
                      </>
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="bill__n">{invoiceAmount(item.taxable)}</td>
                  <td className="bill__n">
                    {item.gstRate}%<div className="bill__muted">{invoiceAmount(r2(item.cgst + item.sgst + item.igst))}</div>
                  </td>
                  <td className="bill__n">
                    <strong>{invoiceAmount(r2(item.taxable + item.cgst + item.sgst + item.igst))}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="bill__foot">
          <div className="bill__notes">
            <p>
              <span className="bill__label">Amount in words</span>
              <br />
              <strong>{rupeesInWords(invoice.total)}</strong>
            </p>
            {!compact && hsnRows.length > 0 && (
              <table className="bill__hsn">
                <thead>
                  <tr>
                    <th scope="col">HSN/SAC</th>
                    <th scope="col" className="bill__n">
                      Taxable
                    </th>
                    <th scope="col" className="bill__n">
                      Rate
                    </th>
                    <th scope="col" className="bill__n">
                      Tax
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hsnRows.map((row) => (
                    <tr key={`${row.hsn}|${row.rate}`}>
                      <td>{row.hsn || '—'}</td>
                      <td className="bill__n">{invoiceAmount(row.taxable)}</td>
                      <td className="bill__n">{row.rate}%</td>
                      <td className="bill__n">{invoiceAmount(row.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {invoice.notes && (
              <p className="bill__pre">
                <span className="bill__label">Notes</span>
                <br />
                {invoice.notes}
              </p>
            )}
            {(settings.bankName || settings.bankAccount) && !quote && (
              <p>
                <span className="bill__label">Bank details</span>
                <br />
                {[settings.bankName, settings.bankAccount && `A/c ${settings.bankAccount}`, settings.bankBranchIfsc].filter(Boolean).join(' · ')}
              </p>
            )}
            {(quote || settings.terms || settings.declaration) && (
              <p className="bill__muted bill__pre">
                {quote ? `This is a quotation, not a tax invoice. Rates and taxes are as on its date${quote.validUntil ? `, valid until ${invoiceDay(quote.validUntil)}` : ''}.` : [settings.terms, settings.declaration].filter(Boolean).join('\n')}
              </p>
            )}
          </div>
          <div className="bill__totals">
            <dl>
              <dt>Items</dt>
              <dd>{invoiceAmount(gross)}</dd>
              {lineDiscounts > 0.004 && (
                <>
                  <dt>Item discounts</dt>
                  <dd>−{invoiceAmount(lineDiscounts)}</dd>
                </>
              )}
              {(invoice.billDiscount ?? 0) > 0 && (
                <>
                  <dt>Bill discount{invoice.billDiscountPct ? ` (${invoice.billDiscountPct}%)` : ''}</dt>
                  <dd>−{invoiceAmount(invoice.billDiscount ?? 0)}</dd>
                </>
              )}
              {charges.map((item, index) => (
                <FragmentPair key={index} label={item.description} value={invoiceAmount(item.amount)} />
              ))}
              <dt>Taxable value</dt>
              <dd>{invoiceAmount(invoice.taxable)}</dd>
              {taxRows.map((row) => (
                <FragmentPair key={row.label} label={row.label} value={invoiceAmount(row.amount)} />
              ))}
              {invoice.roundOff !== 0 && <FragmentPair label="Round off" value={`${invoice.roundOff < 0 ? '−' : ''}${invoiceAmount(invoice.roundOff)}`} />}
              <dt className="bill__grand">Grand total</dt>
              <dd className="bill__grand">₹{invoiceAmount(invoice.total)}</dd>
              {discounts.total > 0 && <FragmentPair label="You saved" value={`₹${invoiceAmount(discounts.total)}`} />}
              {paid > 0 && <FragmentPair label="Received" value={invoiceAmount(paid)} />}
              {counter && invoice.status === 'posted' && <FragmentPair label="Balance due" value={invoiceAmount(due)} strong />}
              {invoice.previousBalance !== undefined && invoice.previousBalance !== null && !quote && (
                <FragmentPair label="Previous balance" value={invoiceAmount(invoice.previousBalance)} />
              )}
            </dl>
            <p className="bill__muted">Tax: {rupeesInWords(tax)}</p>
          </div>
        </div>

        <footer className="bill__end">
          <div className="bill__muted">{settings.jurisdiction}</div>
          <div className="bill__sign">
            <span>for {legalName}</span>
            {settings.signature ? <img src={settings.signature} alt="" height={44} /> : <span className="bill__sign-space" />}
            <span className="bill__muted">Authorised Signatory</span>
          </div>
        </footer>
        {settings.footer && <p className="bill__footer">{settings.footer}</p>}
      </article>
    </div>
  );
}

const FragmentPair = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <>
    <dt className={strong ? 'bill__strong' : undefined}>{label}</dt>
    <dd className={strong ? 'bill__strong' : undefined}>{value}</dd>
  </>
);

/** An 80 mm till-roll receipt: the same bill, one column. */
function ThermalBill({ invoice, settings, company, quote }: Omit<Props, 'template' | 'paper'>) {
  const legalName = settings.legalName || company.companyName;
  const discounts = discountsOf(invoice);
  const taxRows = invoiceTaxRows(invoice.items, invoice.interstate);
  const counter = invoice.source === 'counter' && !quote;
  const paid = counter && invoice.status !== 'cancelled' ? (invoice.paid ?? 0) : 0;
  return (
    <article className="receipt bill-paper bill-paper--thermal" aria-label={`${quote ? 'Quotation' : 'Invoice'} ${invoice.number ?? '(draft)'}`}>
      <header className="receipt__head">
        <strong>{legalName}</strong>
        {(settings.address || company.address) && <div>{settings.address || company.address}</div>}
        {settings.gstin && <div>GSTIN {settings.gstin}</div>}
        {(settings.phone || company.phone) && <div>{settings.phone || company.phone}</div>}
        <div className="receipt__title">{titleOf(invoice, settings, quote)}</div>
      </header>
      <dl className="receipt__pairs">
        <dt>No.</dt>
        <dd>{invoice.number ?? 'Draft'}</dd>
        <dt>Date</dt>
        <dd>{invoiceDay(invoice.invoiceDate)}</dd>
        <dt>To</dt>
        <dd>{invoice.customerName}</dd>
        {invoice.customerGstin && (
          <>
            <dt>GSTIN</dt>
            <dd>{invoice.customerGstin}</dd>
          </>
        )}
      </dl>
      <ol className="receipt__lines">
        {invoice.items.map((item, index) => (
          <li key={index}>
            <div className="receipt__item">{item.description}</div>
            <div className="receipt__row">
              <span>{item.lineType === 'charge' ? `HSN ${item.hsn}` : `${item.qty} ${printUnit(item.unit)} × ${invoiceAmount(item.rate)}`}</span>
              <span>{invoiceAmount(item.amount)}</span>
            </div>
            {(discounts.lines[index]?.value ?? 0) > 0 && (
              <div className="receipt__row receipt__muted">
                <span>Discount {discountText(item)}</span>
                <span>−{invoiceAmount(discounts.lines[index]!.value)}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
      <dl className="receipt__pairs receipt__totals">
        {(invoice.billDiscount ?? 0) > 0 && (
          <>
            <dt>Bill discount</dt>
            <dd>−{invoiceAmount(invoice.billDiscount ?? 0)}</dd>
          </>
        )}
        <dt>Taxable</dt>
        <dd>{invoiceAmount(invoice.taxable)}</dd>
        {taxRows.map((row) => (
          <FragmentPair key={row.label} label={row.label} value={invoiceAmount(row.amount)} />
        ))}
        {invoice.roundOff !== 0 && <FragmentPair label="Round off" value={`${invoice.roundOff < 0 ? '−' : ''}${invoiceAmount(invoice.roundOff)}`} />}
        <dt className="receipt__grand">TOTAL</dt>
        <dd className="receipt__grand">₹{invoiceAmount(invoice.total)}</dd>
        {discounts.total > 0 && <FragmentPair label="You saved" value={invoiceAmount(discounts.total)} />}
        {paid > 0 && <FragmentPair label="Received" value={invoiceAmount(paid)} />}
        {counter && invoice.status === 'posted' && <FragmentPair label="Balance" value={invoiceAmount(Math.max(0, r2(invoice.total - paid)))} />}
      </dl>
      {invoice.notes && <p className="receipt__note">{invoice.notes}</p>}
      <p className="receipt__note">{settings.footer || 'Thank you!'}</p>
    </article>
  );
}
