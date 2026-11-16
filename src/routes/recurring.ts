import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { monthlyDatesThrough, todayInMadrid } from '../lib/date.js';
import { TransactionStatus, transactionTypes } from '../lib/domain.js';

export const recurringRouter = Router();
const ruleSchema = z.object({
  type: z.enum(transactionTypes),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  description: z.string().trim().min(1).max(160),
  categoryId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
}).refine((value) => !value.endDate || value.endDate >= value.startDate, { message: 'La fecha final debe ser posterior al inicio.', path: ['endDate'] });

recurringRouter.get('/', asyncHandler(async (_request, response) => {
  const rules = await prisma.recurringRule.findMany({ include: { category: true }, orderBy: [{ active: 'desc' }, { startDate: 'asc' }] });
  response.json(rules);
}));

recurringRouter.post('/', asyncHandler(async (request, response) => {
  const input = ruleSchema.parse(request.body);
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category || category.type !== input.type) throw new ApiError(400, 'La categoría no existe o no corresponde al tipo de regla.');
  const rule = await prisma.recurringRule.create({
    data: { ...input, scheduleDay: input.startDate.getUTCDate() },
    include: { category: true },
  });
  response.status(201).json(rule);
}));

recurringRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const { active } = z.object({ active: z.boolean() }).parse(request.body);
  const rule = await prisma.recurringRule.update({ where: { id }, data: { active }, include: { category: true } });
  response.json(rule);
}));

recurringRouter.delete('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  await prisma.recurringRule.delete({ where: { id } });
  response.status(204).end();
}));

recurringRouter.post('/generate', asyncHandler(async (_request, response) => {
  const today = todayInMadrid();
  const rules = await prisma.recurringRule.findMany({ where: { active: true, startDate: { lte: today } } });
  let created = 0;
  for (const rule of rules) {
    const dates = monthlyDatesThrough(rule.startDate, rule.scheduleDay, today)
      .filter((date) => !rule.endDate || date <= rule.endDate);
    for (const date of dates) {
      try {
        await prisma.financialEntry.create({
          data: {
            type: rule.type,
            status: TransactionStatus.PENDING,
            amount: rule.amount,
            description: rule.description,
            categoryId: rule.categoryId,
            date,
            isFixed: true,
            recurringRuleId: rule.id,
            scheduledFor: date,
          },
        });
        created += 1;
      } catch (error) {
        // The filtered SQL Server unique index makes repeated generation safe.
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error;
      }
    }
  }
  response.json({ created });
}));
