import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { parseMonth } from '../lib/date.js';
import { TransactionStatus, TransactionType, type TransactionType as TransactionTypeValue } from '../lib/domain.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', asyncHandler(async (request, response) => {
  const month = parseMonth(typeof request.query.month === 'string' ? request.query.month : undefined);
  const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const entries = await prisma.financialEntry.findMany({
    where: { date: { gte: month, lt: nextMonth } },
    include: { category: true },
    orderBy: { date: 'asc' },
  });
  const confirmed = entries.filter((entry) => entry.status === TransactionStatus.CONFIRMED);
  const total = (type: TransactionType, recurring: boolean) => confirmed
    .filter((entry) => entry.type === type && entry.isFixed === recurring)
    .reduce((sum, entry) => sum + entry.amount.toNumber(), 0);
  const balanceAggregate = await prisma.financialEntry.groupBy({
    by: ['type'],
    where: { status: TransactionStatus.CONFIRMED },
    _sum: { amount: true },
  });
  const incomeToDate = balanceAggregate.find((entry) => entry.type === TransactionType.INCOME)?._sum.amount?.toNumber() ?? 0;
  const expensesToDate = balanceAggregate.find((entry) => entry.type === TransactionType.EXPENSE)?._sum.amount?.toNumber() ?? 0;
  const byCategory = new Map<string, { categoryId: string; categoryName: string; color: string; type: TransactionTypeValue; fixed: number; variable: number }>();
  for (const entry of confirmed) {
    const existing = byCategory.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      categoryName: entry.category.name,
      color: entry.category.color,
      type: entry.type as TransactionTypeValue,
      fixed: 0,
      variable: 0,
    };
    const key = entry.isFixed ? 'fixed' : 'variable';
    existing[key] += entry.amount.toNumber();
    byCategory.set(entry.categoryId, existing);
  }
  response.json({
    month: month.toISOString().slice(0, 7),
    balance: incomeToDate - expensesToDate,
    monthSummary: {
      income: total(TransactionType.INCOME, true) + total(TransactionType.INCOME, false),
      expense: total(TransactionType.EXPENSE, true) + total(TransactionType.EXPENSE, false),
      fixedIncome: total(TransactionType.INCOME, true),
      variableIncome: total(TransactionType.INCOME, false),
      fixedExpense: total(TransactionType.EXPENSE, true),
      variableExpense: total(TransactionType.EXPENSE, false),
      pending: entries.filter((entry) => entry.status === TransactionStatus.PENDING).length,
    },
    categories: [...byCategory.values()],
    recentEntries: entries.slice(-8).reverse(),
  });
}));
