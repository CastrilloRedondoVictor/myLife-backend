import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { parseMonth } from '../lib/date.js';
import { TransactionType } from '../lib/domain.js';

export const budgetsRouter = Router();

budgetsRouter.get('/', asyncHandler(async (request, response) => {
  const month = parseMonth(typeof request.query.month === 'string' ? request.query.month : undefined);
  const budgets = await prisma.budget.findMany({ where: { month }, include: { category: true }, orderBy: { category: { name: 'asc' } } });
  const nextMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  const expenses = await prisma.financialEntry.groupBy({
    by: ['categoryId'],
    where: { type: TransactionType.EXPENSE, status: 'CONFIRMED', date: { gte: month, lt: nextMonth } },
    _sum: { amount: true },
  });
  const spentByCategory = new Map(expenses.map((item) => [item.categoryId, item._sum.amount?.toNumber() ?? 0]));
  response.json(budgets.map((budget) => ({ ...budget, spent: spentByCategory.get(budget.categoryId) ?? 0 })));
}));

budgetsRouter.put('/', asyncHandler(async (request, response) => {
  const input = z.object({
    categoryId: z.string().min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    limitAmount: z.coerce.number().finite().positive().max(9999999999.99),
  }).parse(request.body);
  const month = parseMonth(input.month);
  const category = await prisma.category.findUniqueOrThrow({ where: { id: input.categoryId } });
  if (category.type !== TransactionType.EXPENSE) throw new ApiError(400, 'El presupuesto solo puede asociarse a una categoría de gasto.');
  const budget = await prisma.budget.upsert({
    where: { categoryId_month: { categoryId: input.categoryId, month } },
    create: { categoryId: input.categoryId, month, limitAmount: input.limitAmount },
    update: { limitAmount: input.limitAmount },
    include: { category: true },
  });
  response.status(200).json(budget);
}));

budgetsRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = z.object({
    categoryId: z.string().min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    limitAmount: z.coerce.number().finite().positive().max(9999999999.99),
  }).parse(request.body);
  const month = parseMonth(input.month);
  const category = await prisma.category.findUniqueOrThrow({ where: { id: input.categoryId } });
  if (category.type !== TransactionType.EXPENSE) throw new ApiError(400, 'El presupuesto solo puede asociarse a una categoría de gasto.');
  const budget = await prisma.budget.update({
    where: { id },
    data: { ...input, month },
    include: { category: true },
  });
  response.json(budget);
}));

budgetsRouter.delete('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  await prisma.budget.delete({ where: { id } });
  response.status(204).end();
}));
