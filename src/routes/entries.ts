import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { TransactionStatus, transactionStatuses, transactionTypes } from '../lib/domain.js';
import { assertActiveCoLifeMembers, syncPersonalMirror } from '../lib/shared-ledger.js';

export const entriesRouter = Router();
const entrySchema = z.object({
  type: z.enum(transactionTypes),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  description: z.string().trim().min(1).max(160),
  date: z.coerce.date(),
  categoryId: z.string().min(1),
  status: z.enum(transactionStatuses).default(TransactionStatus.CONFIRMED),
});
const entryUpdateSchema = entrySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Indica al menos un campo para actualizar.',
});

entriesRouter.get('/', asyncHandler(async (request, response) => {
  const query = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    type: z.enum(transactionTypes).optional(),
    status: z.enum(transactionStatuses).optional(),
    categoryId: z.string().optional(),
    recurring: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(request.query);
  const where = {
    spaceId: request.space!.spaceId,
    voidedAt: null,
    date: query.from || query.to ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } : undefined,
    type: query.type,
    status: query.status,
    categoryId: query.categoryId,
    isFixed: query.recurring === undefined ? undefined : query.recurring === 'true',
  };
  const [data, total] = await prisma.$transaction([
    prisma.financialEntry.findMany({ where, include: { category: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.financialEntry.count({ where }),
  ]);
  response.json({ data, total, page: query.page, pageSize: query.pageSize });
}));

entriesRouter.post('/', asyncHandler(async (request, response) => {
  const input = entrySchema.parse(request.body);
  if (request.space!.spaceType === 'COLIFE') throw new ApiError(400, 'Registra los gastos compartidos con el formulario de CoLife.');
  const category = await prisma.category.findFirst({ where: { id: input.categoryId, spaceId: request.space!.spaceId } });
  if (!category || category.type !== input.type) throw new ApiError(400, 'La categoría no existe o no corresponde al tipo de movimiento.');
  const entry = await prisma.financialEntry.create({ data: { ...input, spaceId: request.space!.spaceId }, include: { category: true } });
  response.status(201).json(entry);
}));

entriesRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = entryUpdateSchema.parse(request.body);
  const existing = await prisma.financialEntry.findFirst({ where: { id, spaceId: request.space!.spaceId, voidedAt: null } });
  if (!existing) throw new ApiError(404, 'No se encontró el movimiento.');
  if (existing.derivedShareId) throw new ApiError(409, 'Esta cuota se sincroniza desde el gasto CoLife y no se puede editar aquí.');
  if (request.space!.spaceType === 'COLIFE') {
    if (existing.payerUserId) throw new ApiError(400, 'Edita los gastos compartidos desde CoLife.');
    throw new ApiError(409, 'Las ocurrencias recurrentes CoLife se confirman desde esta lista y no se editan aquí.');
  }
  const linkedReceipt = await prisma.shoppingReceipt.findUnique({ where: { financialEntryId: id }, select: { id: true } });
  if (linkedReceipt) throw new ApiError(409, 'Este movimiento pertenece a un ticket. Edita el importe desde la sección Compras.');

  if (input.categoryId || input.type) {
    const category = await prisma.category.findFirst({ where: { id: input.categoryId ?? existing.categoryId, spaceId: request.space!.spaceId } });
    if (!category || category.type !== (input.type ?? existing.type)) {
      throw new ApiError(400, 'La categoría no existe o no corresponde al tipo de movimiento.');
    }
  }

  const entry = await prisma.financialEntry.update({ where: { id }, data: input, include: { category: true } });
  response.json(entry);
}));

entriesRouter.patch('/:id/confirm', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const existing = await prisma.financialEntry.findFirst({ where: { id, spaceId: request.space!.spaceId, voidedAt: null } });
  if (!existing) throw new ApiError(404, 'No se encontró el movimiento.');
  if (existing.derivedShareId) throw new ApiError(409, 'Esta cuota se sincroniza desde el gasto CoLife.');
  if (request.space!.spaceType === 'COLIFE') {
    if (!existing.payerUserId) throw new ApiError(400, 'Este movimiento no tiene pagador CoLife y no se puede confirmar.');
    const entry = await prisma.$transaction(async (tx) => {
      const current = await tx.financialEntry.findFirst({
        where: { id, spaceId: request.space!.spaceId, voidedAt: null, payerUserId: { not: null } },
        include: { shares: { where: { isActive: true } } },
      });
      const groupSpace = await tx.space.findUnique({ where: { id: request.space!.spaceId } });
      if (!current || !groupSpace || current.shares.length === 0) throw new ApiError(409, 'La ocurrencia no tiene reparto; no se puede confirmar.');
      await assertActiveCoLifeMembers(tx, request.space!.spaceId, [current.payerUserId!, ...current.shares.map(({ userId }) => userId)]);
      const confirmed = await tx.financialEntry.update({ where: { id }, data: { status: TransactionStatus.CONFIRMED }, include: { category: true } });
      for (const share of current.shares) {
        await syncPersonalMirror(tx, {
          shareId: share.id,
          userId: share.userId,
          groupSpace,
          description: confirmed.description,
          date: confirmed.date,
          amountCents: Math.round(share.amount.toNumber() * 100),
          active: true,
        });
      }
      await tx.auditEvent.create({
        data: {
          spaceId: request.space!.spaceId,
          actorId: request.auth!.userId,
          entityType: 'SHARED_EXPENSE',
          entityId: id,
          action: 'CONFIRMED',
          details: JSON.stringify({ shares: current.shares.map(({ userId, amount }) => ({ userId, amount: amount.toString() })) }),
        },
      });
      return confirmed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.json(entry);
    return;
  }
  const entry = await prisma.financialEntry.update({
    where: { id },
    data: { status: TransactionStatus.CONFIRMED },
    include: { category: true },
  });
  response.json(entry);
}));

entriesRouter.delete('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const existing = await prisma.financialEntry.findFirst({ where: { id, spaceId: request.space!.spaceId, voidedAt: null } });
  if (!existing) throw new ApiError(404, 'No se encontró el movimiento.');
  if (existing.derivedShareId) throw new ApiError(409, 'Esta cuota se sincroniza desde el gasto CoLife.');
  if (request.space!.spaceType === 'COLIFE') throw new ApiError(400, 'Los gastos y las ocurrencias recurrentes CoLife no se eliminan desde movimientos.');
  const linkedReceipt = await prisma.shoppingReceipt.findFirst({ where: { financialEntryId: id, spaceId: request.space!.spaceId }, select: { id: true } });
  if (linkedReceipt) throw new ApiError(409, 'Este movimiento pertenece a un ticket. Elimínalo desde la sección Compras para mantener los datos sincronizados.');
  await prisma.financialEntry.delete({ where: { id } });
  response.status(204).end();
}));
