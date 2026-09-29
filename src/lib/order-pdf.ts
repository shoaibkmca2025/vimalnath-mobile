import { formatINR } from '@/data/shop';
import { escapeHtml } from '@/lib/pdf-html';
import { orderLineTotal, type Order } from '@/providers/OrdersProvider';

/** Builds the printable HTML for an order — handed to expo-print to render as an A4 PDF. */
export function buildOrderHtml(order: Order): string {
  const placedOn = new Date(order.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const unpriced = order.lines.filter((line) => line.mrp === undefined).length;
  const rows = order.lines
    .map((line, index) => {
      const total = orderLineTotal(line);
      const detail = [line.option, line.optionCode && line.optionCode !== line.code ? line.optionCode : undefined, line.note].filter(Boolean).join(' · ');
      return `<tr>
        <td class="num">${index + 1}</td>
        <td><b>${escapeHtml(line.code)}</b><br />${escapeHtml(line.name)}${detail ? `<div class="detail">${escapeHtml(detail)}</div>` : ''}</td>
        <td class="right">${line.qty}</td>
        <td class="right">${line.mrp === undefined ? '—' : escapeHtml(formatINR(line.mrp))}</td>
        <td class="right strong">${total === undefined ? 'On request' : escapeHtml(formatINR(total))}</td>
      </tr>`;
    })
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { margin: 28px; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; color: #0b1f4d; }
          .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #0b1f4d; padding-bottom: 14px; margin-bottom: 18px; }
          .brand { font-size: 12px; letter-spacing: 1.5px; color: #5a6b8c; text-transform: uppercase; }
          .title { font-size: 24px; font-weight: 700; margin-top: 4px; }
          .meta { text-align: right; font-size: 12px; color: #5a6b8c; line-height: 1.6; }
          .meta b { color: #0b1f4d; }
          .party { margin-bottom: 16px; padding: 12px 14px; background: #f5f8ff; border-radius: 10px; font-size: 12px; line-height: 1.6; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; padding: 9px 8px; background: #2458e8; color: #ffffff; font-size: 10px; letter-spacing: 0.6px; text-transform: uppercase; }
          td { padding: 9px 8px; border-bottom: 1px solid #e1e8f7; vertical-align: top; }
          .num { width: 28px; color: #5a6b8c; }
          .right { text-align: right; white-space: nowrap; }
          th.right { text-align: right; }
          .strong { font-weight: 700; }
          .detail { margin-top: 3px; color: #5a6b8c; font-size: 11px; }
          .totals { margin-top: 14px; margin-left: auto; width: 60%; font-size: 13px; }
          .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
          .totals .grand { border-top: 2px solid #0b1f4d; font-size: 16px; font-weight: 700; }
          .note { margin-top: 16px; font-size: 11px; color: #5a6b8c; }
          .footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e1e8f7; font-size: 10px; color: #93a1bd; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">Vimalnath Sales Corporation</div>
            <div class="title">Purchase Order</div>
          </div>
          <div class="meta">
            <div><b>Order</b> ${escapeHtml(order.number)}</div>
            <div><b>Date</b> ${escapeHtml(placedOn)}</div>
            <div><b>Status</b> ${escapeHtml(order.status)}</div>
          </div>
        </div>

        <div class="party">
          <div><b>Customer / Site:</b> ${escapeHtml(order.customer)}</div>
          ${order.phone ? `<div><b>Phone:</b> ${escapeHtml(order.phone)}</div>` : ''}
          ${order.notes ? `<div><b>Notes:</b> ${escapeHtml(order.notes)}</div>` : ''}
        </div>

        <table>
          <thead><tr><th>#</th><th>Product</th><th class="right">Qty</th><th class="right">MRP</th><th class="right">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          <div class="grand"><span>Total (MRP)</span><span>${escapeHtml(formatINR(order.total))}</span></div>
        </div>
        ${unpriced ? `<div class="note">${unpriced} item${unpriced > 1 ? 's are' : ' is'} priced as per the Taiton catalogue and not included in the total.</div>` : ''}
        <div class="note">Prices are MRP as per the Taiton price list, Feb-2026.</div>

        <div class="footer">Vimalnath Sales Corporation · ${escapeHtml(order.number)} · Generated on ${escapeHtml(placedOn)}</div>
      </body>
    </html>
  `;
}
