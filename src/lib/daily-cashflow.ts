export interface DailyCashflowInput {
  date: Date;
  type: string;
  status: string;
  amount: number;
  isFixed: boolean;
}

export interface DailyCashflowPoint {
  date: string;
  income: number;
  expense: number;
  fixedExpense: number;
  variableExpense: number;
}

export function aggregateDailyCashflow(entries: readonly DailyCashflowInput[]): DailyCashflowPoint[] {
  const totalsByDate = new Map<string, { incomeCents: number; expenseCents: number; fixedExpenseCents: number; variableExpenseCents: number }>();

  for (const entry of entries) {
    if (entry.status !== 'CONFIRMED' || (entry.type !== 'INCOME' && entry.type !== 'EXPENSE')) continue;
    const date = entry.date.toISOString().slice(0, 10);
    const totals = totalsByDate.get(date) ?? { incomeCents: 0, expenseCents: 0, fixedExpenseCents: 0, variableExpenseCents: 0 };
    const cents = Math.round(entry.amount * 100);
    if (entry.type === 'INCOME') totals.incomeCents += cents;
    else {
      totals.expenseCents += cents;
      if (entry.isFixed) totals.fixedExpenseCents += cents;
      else totals.variableExpenseCents += cents;
    }
    totalsByDate.set(date, totals);
  }

  return [...totalsByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, totals]) => ({
      date,
      income: totals.incomeCents / 100,
      expense: totals.expenseCents / 100,
      fixedExpense: totals.fixedExpenseCents / 100,
      variableExpense: totals.variableExpenseCents / 100,
    }));
}
