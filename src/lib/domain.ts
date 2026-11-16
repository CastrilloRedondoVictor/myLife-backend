export const transactionTypes = ['INCOME', 'EXPENSE'] as const;
export const TransactionType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
} as const;
export type TransactionType = (typeof transactionTypes)[number];

export const transactionStatuses = ['PENDING', 'CONFIRMED'] as const;
export const TransactionStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
} as const;
export type TransactionStatus = (typeof transactionStatuses)[number];