import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { r2 } from './gst.ts';
import { Day, Rupees } from './purchases.ts';
import { only, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 4 (docs/ERP-ROADMAP.md): the reports that need every record at once, worked out here from the ledgers.
 * Days are India's: a day runs from midnight to midnight in Asia/Kolkata.
 */

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day.').refine((day) => !Number.isNaN(Date.parse(day)), 'Pick a day.');
const Period = z.object({ from: Date_, to: Date_ }).refine((range) => range.from <= range.to, { message: 'The start must be on or before the end.', path: ['from'] });

/** Received money and paid money move a book: cash for cash, the bank for everything else (UPI, transfers, cheques). */
export type CashEntry = { day: string; kind: string; ref: string; party: string; method: string; in: number; out: number; link: string };

export function reportRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'accountant'));

  const start = (day: string) => sql`(${day}::date::timestamp at time zone 'Asia/Kolkata')`;
  const after = (day: string) => sql`((${day}::date + 1)::timestamp at time zone 'Asia/Kolkata')`;

  /** What the stock for sale (and goods back from customers awaiting a check) was worth at a moment, at today's purchase prices. */
  const stockValue = async (moment: ReturnType<typeof start>) => {
    const [row] = await sql`
      select coalesce(sum(greatest(0, s.quantity + s.held - coalesce(m.later, 0)) * coalesce(s.purchase_price, 0)), 0)::float8 as value,
        (count(*) filter (where s.purchase_price is null and s.quantity + s.held - coalesce(m.later, 0) > 0))::int as unpriced
      from stock_items s
      left join (
        select product_id, option_label, sum(change) as later from stock_moves where bucket in ('available', 'held') and at >= ${moment} group by 1, 2
      ) m on m.product_id = s.product_id and m.option_label = s.option_label`;
    return { value: r2(row!.value), unpriced: row!.unpriced as number };
  };

  /**
   * Trading and profit and loss, the way Tally lays it out: sales less returns, against opening stock plus purchases
   * less closing stock, gives the gross profit; less expenses, the net profit. Amounts are before GST.
   */
  routes.get('/profit-loss', async (c) => {
    const { from, to } = parse(Period, c.req.query());
    const [sales, returns, purchases, purchaseReturns, expenses, opening, closing] = await Promise.all([
      // Orders delivered in the period. A posted tax invoice's GST comes off; an order without one counts as billed.
      sql`
        with delivered as (
          select o.id, coalesce(o.bill_amount, o.total) as bill
          from orders o
          join lateral (select max(e.at) as at from order_events e where e.order_id = o.id and e.status = 'delivered') d on true
          where o.status = 'delivered' and d.at >= ${start(from)} and d.at < ${after(to)}
        )
        select (select count(*) from delivered)::int as orders,
          coalesce((select sum(bill) from delivered), 0)::float8 as bills,
          coalesce((select sum(i.cgst + i.sgst + i.igst) from delivered d join sales_invoices i on i.order_id = d.id and i.status = 'posted' and i.return_id is null), 0)::float8 as gst,
          (select count(*) from delivered d where not exists (select 1 from sales_invoices i where i.order_id = d.id and i.status = 'posted' and i.return_id is null))::int as "withoutInvoice",
          (select count(*) from delivered d join order_lines l on l.order_id = d.id
            left join stock_items s on s.product_id = l.product_id and s.option_label = coalesce(l.option, '')
            where s.product_id is null or s.purchase_price is null)::int as "uncostedLines"`,
      // Goods back from customers in the period, less the goods given in exchange and the charges kept.
      sql`
        select count(*)::int as count,
          coalesce(sum(
            coalesce(cn.total - cn.cgst - cn.sgst - cn.igst, r.return_value)
            - coalesce(ri.total - ri.cgst - ri.sgst - ri.igst, r.replacement_value)
            - r.charges), 0)::float8 as value
        from sales_returns r
        join lateral (select min(ev.at) as at from return_events ev where ev.return_id = r.id and ev.kind = 'received') g on true
        left join sales_credit_notes cn on cn.return_id = r.id and cn.status = 'posted'
        left join sales_invoices ri on ri.return_id = r.id and ri.status = 'posted'
        where r.status <> 'cancelled' and g.at >= ${start(from)} and g.at < ${after(to)}`,
      // Bills received, before GST; GST that can't be claimed back is a cost too.
      sql`
        select count(*)::int as count, coalesce(sum(total - tax + case when itc_status = 'ineligible' then tax else 0 end), 0)::float8 as value
        from purchases where status = 'received' and bill_date between ${from}::date and ${to}::date`,
      sql`
        select count(*)::int as count, coalesce(sum(taxable), 0)::float8 as value
        from supplier_returns where status in ('dispatched', 'supplier_received', 'credited', 'settled', 'closed') and return_date between ${from}::date and ${to}::date`,
      sql`
        select category, count(*)::int as count, sum(amount)::float8 as amount
        from expenses where status = 'approved' and spent_on between ${from}::date and ${to}::date group by category order by amount desc`,
      stockValue(start(from)),
      stockValue(after(to)),
    ]);
    // Counter bills posted in the period, as their own sales; their goods left stock as they were billed.
    const [counter] = await sql`
      select count(*)::int as count, coalesce(sum(total), 0)::float8 as total, coalesce(sum(cgst + sgst + igst), 0)::float8 as gst
      from sales_invoices where order_id is null and return_id is null and status = 'posted' and invoice_date between ${from}::date and ${to}::date`;
    const delivered = sales[0]! as unknown as { orders: number; bills: number; gst: number; withoutInvoice: number; uncostedLines: number };
    const s = { ...delivered, bills: delivered.bills + (counter!.total as number), gst: delivered.gst + (counter!.gst as number) };
    const netSales = r2(s.bills - s.gst - returns[0]!.value);
    const netPurchases = r2(purchases[0]!.value - purchaseReturns[0]!.value);
    const costOfGoods = r2(opening.value + netPurchases - closing.value);
    const grossProfit = r2(netSales - costOfGoods);
    // shortcut: an expense counts with its GST, as none of it is claimed back as input tax credit here.
    const expenseTotal = r2(expenses.reduce((total, row) => total + row.amount, 0));
    return c.json({
      from,
      to,
      sales: { orders: s.orders, counterBills: counter!.count, bills: r2(s.bills), gst: r2(s.gst), withoutInvoice: s.withoutInvoice, uncostedLines: s.uncostedLines },
      returns: { count: returns[0]!.count, value: r2(returns[0]!.value) },
      netSales,
      openingStock: opening,
      purchases: { count: purchases[0]!.count, value: r2(purchases[0]!.value) },
      purchaseReturns: { count: purchaseReturns[0]!.count, value: r2(purchaseReturns[0]!.value) },
      closingStock: closing,
      costOfGoods,
      grossProfit,
      expenses: expenses.map((row) => ({ category: row.category, count: row.count, amount: r2(row.amount) })),
      expenseTotal,
      netProfit: r2(grossProfit - expenseTotal),
    });
  });

  /** Every rupee in and out of cash and the bank, with each book's balance from its opening. */
  routes.get('/cash-book', async (c) => {
    const { from, to } = parse(Period, c.req.query());
    const [openings, entries] = await Promise.all([
      sql`select book, amount::float8 as amount, to_char(as_of, 'YYYY-MM-DD') as "asOf", updated_by as "updatedBy" from book_openings`,
      sql<CashEntry[]>`
        select to_char(day, 'YYYY-MM-DD') as day, kind, ref, party, method, "in"::float8 as "in", "out"::float8 as "out", link from (
          select p.paid_on as day, 'Customer payment' as kind, o.number as ref, o.customer as party, p.method, p.amount::numeric as "in", 0::numeric as "out", '/orders/' || o.id as link, 1 as sort, p.id as id
          from order_payments p join orders o on o.id = p.order_id where p.method in ('cash', 'upi', 'bank', 'cheque')
          union all
          select p.paid_on, 'Bill payment', coalesce(i.number, 'Advance'), i.customer_name, case p.method when 'card' then 'bank' else p.method end,
            p.amount, 0, '/billing/' || i.id, 1, p.id
          from invoice_payments p join sales_invoices i on i.id = p.invoice_id where p.voided_at is null
          union all
          select coalesce(t.paid_on, (t.completed_at at time zone 'Asia/Kolkata')::date), case t.direction when 'out' then 'Refund to customer' else 'Paid by customer (exchange)' end,
            r.number, r.customer_name, case t.method when 'original' then 'bank' else t.method end,
            case t.direction when 'in' then t.amount else 0 end, case t.direction when 'out' then t.amount else 0 end, '/returns/' || r.id, 2, t.id
          from refund_transactions t join sales_returns r on r.id = t.return_id
          where t.status = 'completed' and t.method in ('cash', 'upi', 'bank', 'cheque', 'original')
          union all
          select sp.paid_on, 'Supplier payment', coalesce(pu.number, 'On account'), s.name, sp.method, 0, sp.amount, '/suppliers/' || s.id, 3, sp.id
          from supplier_payments sp join suppliers s on s.id = sp.supplier_id left join purchases pu on pu.id = sp.purchase_id
          union all
          select sr.refunded_on, 'Refund from supplier', sr.number, s.name, sr.refund_method, sr.refund_amount, 0, '/supplier-returns/' || sr.id, 4, sr.id
          from supplier_returns sr join suppliers s on s.id = sr.supplier_id
          where sr.settlement = 'refund' and sr.refunded_on is not null and sr.refund_amount > 0 and sr.status <> 'cancelled'
          union all
          select e.spent_on, 'Expense', e.number, coalesce(nullif(e.paid_to, ''), e.description), e.method, 0, e.amount, '/expenses', 5, e.id
          from expenses e where e.status = 'approved'
          union all
          select g.paid_on, 'GST paid', coalesce(nullif(g.challan, ''), g.period), 'GST', 'bank', 0, g.cgst + g.sgst + g.igst + g.cess + g.interest + g.penalty, '/gst/payments', 6, g.id
          from gst_payments g
        ) entries
        where day <= ${to}::date
        order by day, sort, id`,
    ]);
    const books = (['cash', 'bank'] as const).map((book) => {
      const set = openings.find((row) => row.book === book);
      const since = set?.asOf ?? '0000-01-01';
      const mine = entries.filter((entry) => (entry.method === 'cash') === (book === 'cash') && entry.day >= since);
      let balance = r2((set?.amount ?? 0) + mine.filter((entry) => entry.day < from).reduce((total, entry) => total + entry.in - entry.out, 0));
      const opening = balance;
      const rows = mine
        .filter((entry) => entry.day >= from)
        .map((entry) => {
          balance = r2(balance + entry.in - entry.out);
          return { ...entry, balance };
        });
      return {
        book,
        openingSet: set ? { amount: set.amount, asOf: set.asOf, by: set.updatedBy } : null,
        opening,
        in: r2(rows.reduce((total, row) => total + row.in, 0)),
        out: r2(rows.reduce((total, row) => total + row.out, 0)),
        closing: balance,
        entries: rows,
      };
    });
    return c.json({ from, to, books });
  });

  /** What each book held on the day the books start (Owners). */
  routes.put(
    '/book-openings',
    only('owner'),
    jsonBody(z.object({ book: z.enum(['cash', 'bank']), amount: Rupees('opening balance'), asOf: Day('day the books start') })),
    async (c) => {
      const { book, amount, asOf } = c.req.valid('json');
      await sql`
        insert into book_openings (book, amount, as_of, updated_by) values (${book}, ${amount}, ${asOf}, ${c.get('staff').name})
        on conflict (book) do update set amount = excluded.amount, as_of = excluded.as_of, updated_by = excluded.updated_by, updated_at = now()`;
      return c.body(null, 204);
    },
  );

  /** Each item's stock for sale at the start and end of the period, and what came in and went out in between. */
  routes.get('/stock-movement', async (c) => {
    const { from, to } = parse(Period, c.req.query());
    return c.json(
      await sql`
        select s.product_id as "productId", s.option_label as option, p.name, p.code, s.unit, s.purchase_price::float8 as "purchasePrice",
          (s.quantity - coalesce(sum(m.change), 0))::float8 as opening,
          coalesce(sum(m.change) filter (where m.at < ${after(to)} and m.change > 0), 0)::float8 as "in",
          (-coalesce(sum(m.change) filter (where m.at < ${after(to)} and m.change < 0), 0))::float8 as "out",
          (s.quantity - coalesce(sum(m.change) filter (where m.at >= ${after(to)}), 0))::float8 as closing
        from stock_items s join products p on p.id = s.product_id
        left join stock_moves m on m.product_id = s.product_id and m.option_label = s.option_label and m.bucket = 'available' and m.at >= ${start(from)}
        group by s.product_id, s.option_label, p.name, p.code, s.unit, s.quantity, s.purchase_price
        order by p.name, s.option_label`,
    );
  });

  return routes;
}
