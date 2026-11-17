import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { monthlyDatesThrough, todayInMadrid } from '../lib/date.js';
import { TransactionStatus, transactionTypes } from '../lib/domain.js';
import { allocateExpense, type AllocationInput, type AllocationMode } from '../lib/shared-expense.js';
import { assertActiveCoLifeMembers, centsToDecimal } from '../lib/shared-ledger.js';

export const recurringRouter = Router();
const ruleSchema = z.object({
  type: z.enum(transactionTypes),
  amount: z.coerce.number().finite().positive().max(9999999999.99)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, 'El importe no puede tener más de dos decimales.')
    .refine((value) => Math.round(value * 100) > 0, 'El importe debe ser al menos un céntimo.'),
  description: z.string().trim().min(1).max(160),
  categoryId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  splitMode: z.enum(['EQUAL', 'PERCENTAGE', 'EXACT']).optional(),
  participants: z.array(z.object({
    userId: z.string().min(1).max(30),
    shareBasis: z.number().int().min(1).max(10_000).optional(),
    amountCents: z.number().int().positive().max(999_999_999_999).optional(),
  })).min(1).max(100).optional(),
}).refine((value) => !value.endDate || value.endDate >= value.startDate, { message: 'La fecha final debe ser posterior al inicio.', path: ['endDate'] })
  .refine((value) => (value.splitMode === undefined) === (value.participants === undefined), { message: 'El tipo de reparto y los participantes deben enviarse juntos.' });

recurringRouter.get('/', asyncHandler(async (request, response) => {
  const rules = await prisma.recurringRule.findMany({ where: { spaceId: request.space!.spaceId, deletedAt: null }, include: { category: true, shares: { include: { user: { select: { id: true, displayName: true, email: true } } } } }, orderBy: [{ active: 'desc' }, { startDate: 'asc' }] });
  response.json(rules);
}));

recurringRouter.post('/', asyncHandler(async (request, response) => {
  const input = ruleSchema.parse(request.body);
  const spaceId = request.space!.spaceId;
  const isCoLife = request.space!.spaceType === 'COLIFE';
  if (isCoLife && (input.type !== 'EXPENSE' || !input.splitMode || !input.participants)) {
    throw new ApiError(400, 'Una regla CoLife debe ser un gasto e incluir pagador y reparto.');
  }
  if (!isCoLife && input.splitMode) throw new ApiError(400, 'Los repartos solo se usan en reglas CoLife.');
  let allocations: ReturnType<typeof allocateExpense> = [];
  const amountCents = Math.round(input.amount * 100);
  if (isCoLife) {
    try {
      allocations = allocateExpense(amountCents, input.splitMode as AllocationMode, input.participants as AllocationInput[]);
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400, error.message);
      throw error;
    }
  }
  const rule = await prisma.$transaction(async (tx) => {
    const category = await tx.category.findFirst({ where: { id: input.categoryId, spaceId, type: input.type } });
    if (!category) throw new ApiError(400, 'La categoría no existe en este espacio o no corresponde al tipo de regla.');
    if (isCoLife) {
      const requiredIds = [...new Set([request.auth!.userId, ...allocations.map(({ userId }) => userId)])];
      await assertActiveCoLifeMembers(tx, spaceId, requiredIds);
    }
    const created = await tx.recurringRule.create({
      data: {
        type: input.type,
        amount: centsToDecimal(amountCents),
        description: input.description,
        categoryId: input.categoryId,
        startDate: input.startDate,
        endDate: input.endDate,
        scheduleDay: input.startDate.getUTCDate(),
        spaceId,
        payerUserId: isCoLife ? request.auth!.userId : null,
        splitMode: isCoLife ? input.splitMode : null,
      },
    });
    if (isCoLife) {
      await tx.recurringShare.createMany({
        data: allocations.map((allocation) => ({
          ruleId: created.id,
          userId: allocation.userId,
          allocationType: input.splitMode!,
          shareBasis: allocation.shareBasis,
          exactAmount: input.splitMode === 'EXACT' ? centsToDecimal(allocation.amountCents) : null,
        })),
      });
      await tx.auditEvent.create({
        data: {
          spaceId,
          actorId: request.auth!.userId,
          entityType: 'RECURRING_RULE',
          entityId: created.id,
          action: 'CREATED',
          details: JSON.stringify({ type: created.type, amount: created.amount.toString(), payerUserId: request.auth!.userId, splitMode: input.splitMode, allocations }),
        },
      });
    }
    return tx.recurringRule.findUniqueOrThrow({ where: { id: created.id }, include: { category: true, shares: true } });
  });
  response.status(201).json(rule);
}));

recurringRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const { active } = z.object({ active: z.boolean() }).parse(request.body);
  const existing = await prisma.recurringRule.findFirst({ where: { id, spaceId: request.space!.spaceId, deletedAt: null }, include: { shares: true } });
  if (!existing) throw new ApiError(404, 'No se encontró la regla recurrente.');
  const rule = await prisma.$transaction(async (tx) => {
    if (active && request.space!.spaceType === 'COLIFE') {
      if (!existing.payerUserId) throw new ApiError(409, 'La regla CoLife no tiene pagador configurado.');
      await assertActiveCoLifeMembers(tx, request.space!.spaceId, [existing.payerUserId, ...existing.shares.map(({ userId }) => userId)]);
    }
    const updated = await tx.recurringRule.update({ where: { id }, data: { active }, include: { category: true } });
    if (request.space!.spaceType === 'COLIFE') {
      await tx.auditEvent.create({
        data: {
          spaceId: request.space!.spaceId,
          actorId: request.auth!.userId,
          entityType: 'RECURRING_RULE',
          entityId: id,
          action: active ? 'ACTIVATED' : 'DEACTIVATED',
          details: JSON.stringify({ active, description: existing.description }),
        },
      });
    }
    return updated;
  });
  response.json(rule);
}));

recurringRouter.delete('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const existing = await prisma.recurringRule.findFirst({ where: { id, spaceId: request.space!.spaceId, deletedAt: null } });
  if (!existing) throw new ApiError(404, 'No se encontró la regla recurrente.');
  await prisma.$transaction(async (tx) => {
    await tx.recurringRule.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    if (request.space!.spaceType === 'COLIFE') {
      await tx.auditEvent.create({
        data: {
          spaceId: request.space!.spaceId,
          actorId: request.auth!.userId,
          entityType: 'RECURRING_RULE',
          entityId: id,
          action: 'DELETED',
          details: JSON.stringify({ description: existing.description }),
        },
      });
    }
  });
  response.status(204).end();
}));

recurringRouter.post('/generate', asyncHandler(async (request, response) => {
  const today = todayInMadrid();
  const rules = await prisma.recurringRule.findMany({
    where: { spaceId: request.space!.spaceId, active: true, deletedAt: null, startDate: { lte: today } },
    include: { shares: true },
  });
  let created = 0;
  for (const rule of rules) {
    const dates = monthlyDatesThrough(rule.startDate, rule.scheduleDay, today)
      .filter((date) => !rule.endDate || date <= rule.endDate);
    for (const date of dates) {
      try {
        await prisma.$transaction(async (tx) => {
          const entry = await tx.financialEntry.create({
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
              spaceId: request.space!.spaceId,
              payerUserId: rule.payerUserId,
            },
          });
          if (request.space!.spaceType === 'COLIFE') {
            if (!rule.splitMode || !rule.payerUserId || rule.shares.length === 0) {
              throw new ApiError(409, 'La regla CoLife no tiene un reparto válido; no se generó la ocurrencia.');
            }
            const allocationInput: AllocationInput[] = rule.shares.map((share) => ({
              userId: share.userId,
              ...(rule.splitMode === 'PERCENTAGE' ? { shareBasis: share.shareBasis ?? undefined } : {}),
              ...(rule.splitMode === 'EXACT' ? { amountCents: Math.round(Number(share.exactAmount) * 100) } : {}),
            }));
            const allocations = allocateExpense(Math.round(rule.amount.toNumber() * 100), rule.splitMode as AllocationMode, allocationInput);
            await tx.expenseShare.createMany({
              data: allocations.map((allocation) => ({
                entryId: entry.id,
                userId: allocation.userId,
                amount: centsToDecimal(allocation.amountCents),
                allocationType: rule.splitMode!,
                shareBasis: allocation.shareBasis,
              })),
            });
            await tx.auditEvent.create({
              data: {
                spaceId: request.space!.spaceId,
                actorId: request.auth!.userId,
                entityType: 'SHARED_EXPENSE',
                entityId: entry.id,
                action: 'OCCURRENCE_GENERATED',
                details: JSON.stringify({ ruleId: rule.id, scheduledFor: date.toISOString(), status: TransactionStatus.PENDING }),
              },
            });
          }
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
