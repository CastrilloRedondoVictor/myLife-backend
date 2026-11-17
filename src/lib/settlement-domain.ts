export interface ExpenseLedgerRecord {
  totalCents: number;
  payerUserId: string;
  shares: Array<{ userId: string; amountCents: number }>;
}

export interface SettlementLedgerRecord {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export interface BalanceAdjustmentRecord {
  userId: string;
  amountCents: number;
}

export interface ExpenseContributionSnapshot {
  payerUserId: string | null;
  totalCents: number;
  shares: Array<{ userId: string; amountCents: number }>;
}

export interface BalanceRecord {
  userId: string;
  balanceCents: number;
}

export interface SuggestedTransfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export function calculateExpenseCorrectionAdjustments(
  previous: ExpenseContributionSnapshot,
  replacement: ExpenseContributionSnapshot | null,
): BalanceAdjustmentRecord[] {
  const contribution = (expense: ExpenseContributionSnapshot) => {
    const balances = new Map<string, number>();
    if (expense.payerUserId) balances.set(expense.payerUserId, expense.totalCents);
    for (const share of expense.shares) balances.set(share.userId, (balances.get(share.userId) ?? 0) - share.amountCents);
    return balances;
  };
  const before = contribution(previous);
  const after = replacement ? contribution(replacement) : new Map<string, number>();
  return [...new Set([...before.keys(), ...after.keys()])]
    .map((userId) => ({ userId, amountCents: (before.get(userId) ?? 0) - (after.get(userId) ?? 0) }))
    .filter(({ amountCents }) => amountCents !== 0)
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

export function calculateBalances(
  expenses: ExpenseLedgerRecord[],
  settlements: SettlementLedgerRecord[],
  adjustments: BalanceAdjustmentRecord[] = [],
): BalanceRecord[] {
  const balances = new Map<string, number>();
  const add = (userId: string, amountCents: number) => balances.set(userId, (balances.get(userId) ?? 0) + amountCents);

  for (const expense of expenses) {
    add(expense.payerUserId, expense.totalCents);
    for (const share of expense.shares) add(share.userId, -share.amountCents);
  }
  for (const settlement of settlements) {
    add(settlement.fromUserId, settlement.amountCents);
    add(settlement.toUserId, -settlement.amountCents);
  }
  for (const adjustment of adjustments) add(adjustment.userId, adjustment.amountCents);

  return [...balances.entries()]
    .map(([userId, balanceCents]) => ({ userId, balanceCents }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

export function suggestTransfers(balances: BalanceRecord[]): SuggestedTransfer[] {
  const debtors = balances
    .filter(({ balanceCents }) => balanceCents < 0)
    .map(({ userId, balanceCents }) => ({ userId, remaining: -balanceCents }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const creditors = balances
    .filter(({ balanceCents }) => balanceCents > 0)
    .map(({ userId, balanceCents }) => ({ userId, remaining: balanceCents }))
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const transfers: SuggestedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amountCents = Math.min(debtor.remaining, creditor.remaining);
    transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents });
    debtor.remaining -= amountCents;
    creditor.remaining -= amountCents;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }
  return transfers;
}
