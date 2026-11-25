/** Expenses and the money reports (server/src/expenses.ts, server/src/reports.ts). Figures come from the server. */

export type ExpenseCategory = 'rent' | 'electricity' | 'salary' | 'transport' | 'maintenance' | 'office' | 'marketing' | 'other';
export const EXPENSE_CATEGORY: Record<ExpenseCategory, string> = {
  rent: 'Rent',
  electricity: 'Electricity',
  salary: 'Salary',
  transport: 'Transportation',
  maintenance: 'Maintenance',
  office: 'Office expenses',
  marketing: 'Marketing',
  other: 'Other expenses',
};

export type Expense = {
  id: string;
  number: string;
  spentOn: string;
  category: ExpenseCategory;
  description: string;
  paidTo: string;
  amount: number;
  gst: number;
  gstin: string;
  method: 'cash' | 'upi' | 'bank' | 'cheque';
  reference: string;
  attachment: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string;
};

export const EXPENSE_STATUS: Record<Expense['status'], { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export type ProfitLoss = {
  from: string;
  to: string;
  sales: { orders: number; bills: number; gst: number; withoutInvoice: number; uncostedLines: number };
  returns: { count: number; value: number };
  netSales: number;
  openingStock: { value: number; unpriced: number };
  purchases: { count: number; value: number };
  purchaseReturns: { count: number; value: number };
  closingStock: { value: number; unpriced: number };
  costOfGoods: number;
  grossProfit: number;
  expenses: { category: ExpenseCategory; count: number; amount: number }[];
  expenseTotal: number;
  netProfit: number;
};

export type CashEntry = { day: string; kind: string; ref: string; party: string; method: string; in: number; out: number; link: string; balance: number };
export type Book = {
  book: 'cash' | 'bank';
  openingSet: { amount: number; asOf: string; by: string } | null;
  opening: number;
  in: number;
  out: number;
  closing: number;
  entries: CashEntry[];
};

export type StockMovement = { productId: string; option: string; name: string; code: string; unit: string; purchasePrice: number | null; opening: number; in: number; out: number; closing: number };

/** Approved expenses' totals by category, largest first. */
export function byCategory(expenses: Expense[]) {
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) if (expense.status === 'approved') totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  return [...totals].map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
}
