import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { allocateExpense, type AllocationInput, type AllocationMode } from '../lib/shared-expense.js';
import { centsToDecimal, reconcileSettledExpenseCorrection, syncPersonalMirror } from '../lib/shared-ledger.js';

export const sharedExpensesRouter = Router();
const MAX_TOTAL_CENTS = 999_999_999_999;
const sharedExpenseSchema = z.object({
  description: z.string().trim().min(1).max(160),
  totalCents: z.number().int().positive().max(MAX_TOTAL_CENTS),
  date: z.coerce.date(),
  categoryId: z.string().min(1).max(30),
  payerUserId: z.string().min(1).max(30).optional(),
  isFixed: z.boolean().default(false),
  splitMode: z.enum(['EQUAL', 'PERCENTAGE', 'EXACT']),
  participants: z.array(z.object({
    userId: z.string().min(1).max(30),
    shareBasis: z.number().int().min(1).max(10_000).optional(),
    amountCents: z.number().int().positive().max(MAX_TOTAL_CENTS).optional(),
  })).min(1).max(100),
});

function calculateAllocations(totalCents: number, mode: AllocationMode, participants: AllocationInput[]) {
  try {
    return allocateExpense(totalCents, mode, participants);
  } catch (error) {
    if (error instanceof RangeError) throw new ApiError(400, error.message);
    throw error;
  }
}

async function validateMembers(
  tx: Prisma.TransactionClient,
  spaceId: string,
  participantIds: string[],
  payerUserId: string,
) {
  const requiredIds = [...new Set([...participantIds, payerUserId])];
  const members = await tx.membership.findMany({
    where: { spaceId, userId: { in: requiredIds }, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (new Set(members.map(({ userId }) => userId)).size !== requiredIds.length) {
    throw new ApiError(400, 'El pagador y todos los participantes deben ser miembros activos del CoLife.');
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; actorId: string; entryId: string; action: string; details: unknown },
) {
  await tx.auditEvent.create({
    data: {
      spaceId: input.spaceId,
      actorId: input.actorId,
      entityType: 'SHARED_EXPENSE',
      entityId: input.entryId,
      action: input.action,
      details: JSON.stringify(input.details),
    },
  });
}

async function loadGroupExpense(spaceId: string, id: string) {
  return prisma.financialEntry.findFirst({
    where: { id, spaceId, type: 'EXPENSE', payerUserId: { not: null }, voidedAt: null },
    include: {
      category: true,
      payer: { select: { id: true, email: true, displayName: true } },
      shares: {
        where: { isActive: true },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: { userId: 'asc' },
      },
    },
  });
}

sharedExpensesRouter.get('/', asyncHandler(async (request, response) => {
  if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los gastos compartidos solo existen en CoLife.');
  const entries = await prisma.financialEntry.findMany({
    where: { spaceId: request.space!.spaceId, type: 'EXPENSE', payerUserId: { not: null }, voidedAt: null },
    include: {
      category: true,
      payer: { select: { id: true, email: true, displayName: true } },
      shares: {
        where: { isActive: true },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: { userId: 'asc' },
      },
      shoppingReceipt: { select: { id: true } },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  response.json(entries);
}));

sharedExpensesRouter.get('/:id', asyncHandler(async (request, response) => {
  if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los gastos compartidos solo existen en CoLife.');
  const { id } = z.object({ id: z.string().min(1).max(30) }).parse(request.params);
  const entry = await loadGroupExpense(request.space!.spaceId, id);
  if (!entry) throw new ApiError(404, 'No se encontró el gasto compartido.');
  response.json(entry);
}));

sharedExpensesRouter.post('/', asyncHandler(async (request, response) => {
  if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los gastos compartidos solo existen en CoLife.');
  const input = sharedExpenseSchema.parse(request.body);
  const spaceId = request.space!.spaceId;
  const payerUserId = input.payerUserId ?? request.auth!.userId;
  const allocations = calculateAllocations(input.totalCents, input.splitMode, input.participants);

  const created = await prisma.$transaction(async (tx) => {
    const groupSpace = await tx.space.findUnique({ where: { id: spaceId } });
    if (!groupSpace || groupSpace.type !== 'COLIFE') throw new ApiError(404, 'No se encontró el CoLife.');
    const category = await tx.category.findFirst({ where: { id: input.categoryId, spaceId, type: 'EXPENSE' } });
    if (!category) throw new ApiError(400, 'Elige una categoría de gasto válida para este CoLife.');
    await validateMembers(tx, spaceId, allocations.map(({ userId }) => userId), payerUserId);

    const entry = await tx.financialEntry.create({
      data: {
        spaceId,
        type: 'EXPENSE',
        status: 'CONFIRMED',
        amount: centsToDecimal(input.totalCents),
        description: input.description,
        date: input.date,
        isFixed: input.isFixed,
        categoryId: category.id,
        payerUserId,
      },
    });
    for (const allocation of allocations) {
      const share = await tx.expenseShare.create({
        data: {
          entryId: entry.id,
          userId: allocation.userId,
          amount: centsToDecimal(allocation.amountCents),
          allocationType: input.splitMode,
          shareBasis: allocation.shareBasis,
        },
      });
      await syncPersonalMirror(tx, {
        shareId: share.id,
        userId: allocation.userId,
        groupSpace,
        description: input.description,
        date: input.date,
        amountCents: allocation.amountCents,
        active: true,
      });
    }
    await writeAudit(tx, {
      spaceId,
      actorId: request.auth!.userId,
      entryId: entry.id,
      action: 'CREATED',
      details: {
        amountCents: input.totalCents,
        payerUserId,
        splitMode: input.splitMode,
        allocations,
      },
    });
    return entry.id;
  });
  const entry = await loadGroupExpense(spaceId, created);
  response.status(201).json(entry);
}));

sharedExpensesRouter.patch('/:id', asyncHandler(async (request, response) => {
  if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los gastos compartidos solo existen en CoLife.');
  const { id } = z.object({ id: z.string().min(1).max(30) }).parse(request.params);
  const input = sharedExpenseSchema.parse(request.body);
  const spaceId = request.space!.spaceId;
  const allocations = calculateAllocations(input.totalCents, input.splitMode, input.participants);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.financialEntry.findFirst({
      where: { id, spaceId, type: 'EXPENSE', payerUserId: { not: null }, voidedAt: null },
      include: { shares: true },
    });
    if (!existing) throw new ApiError(404, 'No se encontró el gasto compartido.');
    const payerUserId = input.payerUserId ?? existing.payerUserId!;
    const receipt = await tx.shoppingReceipt.findFirst({ where: { financialEntryId: id, spaceId }, select: { id: true } });
    if (receipt) throw new ApiError(409, 'Edita el importe y las líneas de este gasto desde el ticket de Compras.');
    const groupSpace = await tx.space.findUnique({ where: { id: spaceId } });
    if (!groupSpace) throw new ApiError(404, 'No se encontró el CoLife.');
    const category = await tx.category.findFirst({ where: { id: input.categoryId, spaceId, type: 'EXPENSE' } });
    if (!category) throw new ApiError(400, 'Elige una categoría de gasto válida para este CoLife.');
    await validateMembers(tx, spaceId, allocations.map(({ userId }) => userId), payerUserId);

    const oldSnapshot = {
      totalCents: Math.round(existing.amount.toNumber() * 100),
      payerUserId: existing.payerUserId,
      description: existing.description,
      shares: existing.shares.filter(({ isActive }) => isActive).map(({ userId, amount }) => ({ userId, amountCents: Math.round(amount.toNumber() * 100) })),
    };
    await tx.financialEntry.update({
      where: { id },
      data: {
        amount: centsToDecimal(input.totalCents),
        description: input.description,
        date: input.date,
        isFixed: input.isFixed,
        categoryId: category.id,
        payerUserId,
      },
    });

    const allocationByUser = new Map(allocations.map((allocation) => [allocation.userId, allocation]));
    for (const previous of existing.shares) {
      const allocation = allocationByUser.get(previous.userId);
      if (!allocation) {
        if (previous.isActive) {
          await tx.expenseShare.update({ where: { id: previous.id }, data: { isActive: false } });
          if (existing.status === 'CONFIRMED') await syncPersonalMirror(tx, {
            shareId: previous.id,
            userId: previous.userId,
            groupSpace,
            description: existing.description,
            date: existing.date,
            amountCents: Math.round(previous.amount.toNumber() * 100),
            active: false,
          });
        }
        continue;
      }
      await tx.expenseShare.update({
        where: { id: previous.id },
        data: {
          amount: centsToDecimal(allocation.amountCents),
          allocationType: input.splitMode,
          shareBasis: allocation.shareBasis,
          isActive: true,
        },
      });
      if (existing.status === 'CONFIRMED') await syncPersonalMirror(tx, {
        shareId: previous.id,
        userId: previous.userId,
        groupSpace,
        description: input.description,
        date: input.date,
        amountCents: allocation.amountCents,
        active: true,
      });
      allocationByUser.delete(previous.userId);
    }

    for (const allocation of allocationByUser.values()) {
      const share = await tx.expenseShare.create({
        data: {
          entryId: existing.id,
          userId: allocation.userId,
          amount: centsToDecimal(allocation.amountCents),
          allocationType: input.splitMode,
          shareBasis: allocation.shareBasis,
        },
      });
      if (existing.status === 'CONFIRMED') await syncPersonalMirror(tx, {
        shareId: share.id,
        userId: allocation.userId,
        groupSpace,
        description: input.description,
        date: input.date,
        amountCents: allocation.amountCents,
        active: true,
      });
    }

    const settlementCount = await tx.settlement.count({ where: { spaceId, createdAt: { gte: existing.createdAt } } });
    const reconciliationAdjustments = settlementCount && existing.status === 'CONFIRMED'
      ? await reconcileSettledExpenseCorrection(tx, {
        spaceId,
        entryId: id,
        previous: oldSnapshot,
        replacement: {
          payerUserId,
          totalCents: input.totalCents,
          shares: allocations.map(({ userId, amountCents }) => ({ userId, amountCents })),
        },
      })
      : [];
    await writeAudit(tx, {
      spaceId,
      actorId: request.auth!.userId,
      entryId: id,
      action: settlementCount > 0 ? 'CORRECTED_AFTER_SETTLEMENT' : 'UPDATED',
      details: {
        previous: oldSnapshot,
        current: { totalCents: input.totalCents, payerUserId, splitMode: input.splitMode, allocations },
        historicalSettlementsPreserved: settlementCount,
        reconciliationAdjustments,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const entry = await loadGroupExpense(spaceId, id);
  response.json(entry);
}));

sharedExpensesRouter.delete('/:id', asyncHandler(async (request, response) => {
  if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los gastos compartidos solo existen en CoLife.');
  const { id } = z.object({ id: z.string().min(1).max(30) }).parse(request.params);
  const spaceId = request.space!.spaceId;
  await prisma.$transaction(async (tx) => {
    const entry = await tx.financialEntry.findFirst({
      where: { id, spaceId, type: 'EXPENSE', payerUserId: { not: null }, voidedAt: null },
      include: { shares: true },
    });
    if (!entry) throw new ApiError(404, 'No se encontró el gasto compartido.');
    const receipt = await tx.shoppingReceipt.findFirst({ where: { financialEntryId: id, spaceId }, select: { id: true } });
    if (receipt) throw new ApiError(409, 'Elimina este gasto desde Compras para conservar la integridad del ticket.');
    const groupSpace = await tx.space.findUnique({ where: { id: spaceId } });
    if (!groupSpace) throw new ApiError(404, 'No se encontró el CoLife.');
    const settlementCount = await tx.settlement.count({ where: { spaceId, createdAt: { gte: entry.createdAt } } });
    const reconciliationAdjustments = settlementCount && entry.status === 'CONFIRMED'
      ? await reconcileSettledExpenseCorrection(tx, {
        spaceId,
        entryId: id,
        previous: {
          payerUserId: entry.payerUserId,
          totalCents: Math.round(entry.amount.toNumber() * 100),
          shares: entry.shares.filter(({ isActive }) => isActive).map(({ userId, amount }) => ({ userId, amountCents: Math.round(amount.toNumber() * 100) })),
        },
        replacement: null,
      })
      : [];
    await tx.financialEntry.update({ where: { id }, data: { voidedAt: new Date() } });
    for (const share of entry.shares.filter(({ isActive }) => isActive)) {
      await tx.expenseShare.update({ where: { id: share.id }, data: { isActive: false } });
      if (entry.status === 'CONFIRMED') await syncPersonalMirror(tx, {
        shareId: share.id,
        userId: share.userId,
        groupSpace,
        description: entry.description,
        date: entry.date,
        amountCents: Math.round(share.amount.toNumber() * 100),
        active: false,
      });
    }
    await writeAudit(tx, {
      spaceId,
      actorId: request.auth!.userId,
      entryId: id,
      action: 'REVERSED',
      details: {
        totalCents: Math.round(entry.amount.toNumber() * 100),
        payerUserId: entry.payerUserId,
        shares: entry.shares.filter(({ isActive }) => isActive).map(({ userId, amount }) => ({ userId, amountCents: Math.round(amount.toNumber() * 100) })),
        paymentsRemainImmutable: true,
        reconciliationAdjustments,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(204).end();
}));
