import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { TransactionStatus, TransactionType } from '../lib/domain.js';
import { dimensionForUnit, moneyToCents, normalizeShoppingName, pricePerStandard, shoppingUnits, toBaseQuantity, type ShoppingDimension, type ShoppingUnit } from '../lib/shopping-domain.js';
import { allocateExpense, type AllocationInput, type AllocationMode } from '../lib/shared-expense.js';
import { assertActiveCoLifeMembers, centsToDecimal, reconcileSettledExpenseCorrection, syncExpenseShares, syncPersonalMirror } from '../lib/shared-ledger.js';

export const shoppingRouter = Router();
const dimensions = ['WEIGHT', 'VOLUME', 'COUNT'] as const;
const money = z.coerce.number().finite().max(9999999999.99).refine((value) => Number.isInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'El importe admite como máximo dos decimales.');
const productNameSchema = z.string().trim().min(1).max(100);
const receiptItemSchema = z.object({
  productId: z.string().min(1),
  brand: z.string().trim().max(80).optional().nullable(),
  packageLabel: z.string().trim().max(100).optional().nullable(),
  unitsPurchased: z.coerce.number().int().positive().max(999999).default(1),
  quantity: z.coerce.number().finite().positive().max(999999),
  unit: z.enum(shoppingUnits),
  amount: money.refine((value) => value > 0, 'El precio debe ser mayor que cero.'),
}).refine((value) => Number.isInteger(value.quantity) || value.unit !== 'unit', 'La cantidad por unidad debe ser un número entero.')
  .refine((value) => Number.isFinite(toBaseQuantity(value.quantity, value.unit, value.unitsPurchased)) && toBaseQuantity(value.quantity, value.unit, value.unitsPurchased) <= 999999999.999, 'La cantidad total supera el límite admitido.');
const receiptSchema = z.object({
  supermarketName: z.string().trim().min(1).max(80),
  categoryId: z.string().min(1),
  date: z.coerce.date(),
  adjustment: money.default(0),
  splitMode: z.enum(['EQUAL', 'PERCENTAGE', 'EXACT']).optional(),
  participants: z.array(z.object({
    userId: z.string().min(1).max(30),
    shareBasis: z.number().int().min(1).max(10_000).optional(),
    amountCents: z.number().int().positive().max(999_999_999_999).optional(),
  })).min(1).max(100).optional(),
  items: z.array(receiptItemSchema).min(1).max(150),
}).refine((value) => (value.splitMode === undefined) === (value.participants === undefined), { message: 'El tipo de reparto y los participantes deben enviarse juntos.' });

function variantKeys(brand?: string | null, packageLabel?: string | null) {
  const normalizedBrand = brand ? normalizeShoppingName(brand) : '';
  const normalizedPackage = packageLabel ? normalizeShoppingName(packageLabel) : '';
  return {
    brand: brand?.trim() || null,
    normalizedBrand,
    packageLabel: packageLabel?.trim() || null,
    normalizedPackage,
  };
}

async function getOrCreateSupermarket(tx: Prisma.TransactionClient, name: string, spaceId: string) {
  const normalizedName = normalizeShoppingName(name);
  const existing = await tx.supermarket.findUnique({ where: { spaceId_normalizedName: { spaceId, normalizedName } } });
  if (existing) {
    return existing.active ? existing : tx.supermarket.update({ where: { id: existing.id }, data: { active: true } });
  }
  return tx.supermarket.create({ data: { name: name.trim(), normalizedName, spaceId } });
}

async function replaceReceiptItems(tx: Prisma.TransactionClient, receiptId: string, spaceId: string, items: z.infer<typeof receiptItemSchema>[]) {
  const dimensionsByProduct = new Map<string, string>();
  const rows: Array<{ spaceId: string; productId: string; variantId: string; unit: ShoppingUnit; unitsPurchased: number; quantityBase: number; amount: number }> = [];
  let linesCents = 0;

  for (const item of items) {
    const dimension = dimensionForUnit(item.unit);
    const previousDimension = dimensionsByProduct.get(item.productId);
    if (previousDimension && previousDimension !== dimension) {
      throw new ApiError(400, 'Un producto no puede mezclar peso, volumen y unidades. Crea productos distintos para medidas incompatibles.');
    }
    dimensionsByProduct.set(item.productId, dimension);

    const product = await tx.shoppingProduct.findFirst({ where: { id: item.productId, spaceId } });
    if (!product || !product.active) throw new ApiError(400, 'Uno de los productos no existe o está archivado.');
    if (product.dimension && product.dimension !== dimension) {
      throw new ApiError(400, `La unidad no coincide con la dimensión guardada para «${product.name}».`);
    }
    if (!product.dimension) {
      await tx.shoppingProduct.update({ where: { id: product.id }, data: { dimension } });
    }

    const keys = variantKeys(item.brand, item.packageLabel);
    const variant = await tx.shoppingVariant.upsert({
      where: { spaceId_productId_normalizedBrand_normalizedPackage: { spaceId, productId: product.id, normalizedBrand: keys.normalizedBrand, normalizedPackage: keys.normalizedPackage } },
      create: { spaceId, productId: product.id, ...keys },
      update: { active: true, brand: keys.brand, packageLabel: keys.packageLabel },
    });
    rows.push({ spaceId, productId: product.id, variantId: variant.id, unit: item.unit, unitsPurchased: item.unitsPurchased, quantityBase: toBaseQuantity(item.quantity, item.unit, item.unitsPurchased), amount: item.amount });
    linesCents += moneyToCents(item.amount);
  }

  await tx.shoppingReceiptItem.createMany({ data: rows.map((row) => ({ ...row, receiptId })) });
  return linesCents;
}

shoppingRouter.get('/supermarkets', asyncHandler(async (request, response) => {
  const { includeArchived } = z.object({ includeArchived: z.enum(['true', 'false']).default('false') }).parse(request.query);
  const supermarkets = await prisma.supermarket.findMany({ where: { spaceId: request.space!.spaceId, ...(includeArchived === 'true' ? {} : { active: true }) }, orderBy: { name: 'asc' } });
  response.json(supermarkets);
}));

shoppingRouter.post('/supermarkets', asyncHandler(async (request, response) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(request.body);
  const normalizedName = normalizeShoppingName(name);
  const spaceId = request.space!.spaceId;
  const existing = await prisma.supermarket.findUnique({ where: { spaceId_normalizedName: { spaceId, normalizedName } } });
  if (existing) {
    const supermarket = existing.active ? existing : await prisma.supermarket.update({ where: { id: existing.id }, data: { active: true } });
    response.json(supermarket);
    return;
  }
  const supermarket = await prisma.supermarket.create({ data: { name, normalizedName, spaceId } });
  response.status(201).json(supermarket);
}));

shoppingRouter.patch('/supermarkets/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() })
    .refine((value) => Object.keys(value).length > 0).parse(request.body);
  const existing = await prisma.supermarket.findFirst({ where: { id, spaceId: request.space!.spaceId } });
  if (!existing) throw new ApiError(404, 'No se encontró el supermercado.');
  if (input.name) {
    const duplicate = await prisma.supermarket.findUnique({ where: { spaceId_normalizedName: { spaceId: request.space!.spaceId, normalizedName: normalizeShoppingName(input.name) } } });
    if (duplicate && duplicate.id !== id) throw new ApiError(409, `Ya existe el supermercado «${duplicate.name}».`);
  }
  const supermarket = await prisma.supermarket.update({
    where: { id },
    data: { ...input, ...(input.name ? { normalizedName: normalizeShoppingName(input.name) } : {}) },
  });
  response.json(supermarket);
}));

shoppingRouter.get('/products', asyncHandler(async (request, response) => {
  const query = z.object({ q: z.string().trim().max(100).optional(), includeArchived: z.enum(['true', 'false']).default('false') }).parse(request.query);
  const normalizedQuery = query.q ? normalizeShoppingName(query.q) : '';
  const products = await prisma.shoppingProduct.findMany({
    where: { spaceId: request.space!.spaceId, ...(query.includeArchived === 'true' ? {} : { active: true }), ...(normalizedQuery ? { normalizedName: { contains: normalizedQuery } } : {}) },
    include: {
      variants: {
        where: { spaceId: request.space!.spaceId, active: true },
        orderBy: { brand: 'asc' },
        include: {
          receiptItems: {
            where: { spaceId: request.space!.spaceId, receipt: { voidedAt: null } },
            orderBy: [{ receipt: { date: 'desc' } }, { createdAt: 'desc' }],
            take: 1,
            select: { unit: true, unitsPurchased: true, quantityBase: true, amount: true, receipt: { select: { date: true } } },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: 50,
  });
  response.json(products.map(({ variants, ...product }) => ({
    ...product,
    variants: variants.map(({ receiptItems, ...variant }) => {
      const lastPurchase = receiptItems[0];
      return {
        ...variant,
        latestPurchase: lastPurchase ? {
          unit: lastPurchase.unit,
          unitsPurchased: lastPurchase.unitsPurchased,
          quantityBase: lastPurchase.quantityBase.toNumber(),
          amount: lastPurchase.amount.toNumber(),
          date: lastPurchase.receipt.date,
        } : null,
      };
    }),
  })));
}));

shoppingRouter.post('/products', asyncHandler(async (request, response) => {
  const input = z.object({ name: productNameSchema, dimension: z.enum(dimensions).optional() }).parse(request.body);
  const normalizedName = normalizeShoppingName(input.name);
  const spaceId = request.space!.spaceId;
  const existing = await prisma.shoppingProduct.findUnique({ where: { spaceId_normalizedName: { spaceId, normalizedName } } });
  if (existing) throw new ApiError(409, `Ya existe «${existing.name}». Selecciónalo para reutilizarlo.`);
  const product = await prisma.shoppingProduct.create({ data: { name: input.name, normalizedName, dimension: input.dimension, spaceId } });
  response.status(201).json(product);
}));

shoppingRouter.patch('/products/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = z.object({ name: productNameSchema.optional(), active: z.boolean().optional() })
    .refine((value) => Object.keys(value).length > 0).parse(request.body);
  const existing = await prisma.shoppingProduct.findFirst({ where: { id, spaceId: request.space!.spaceId } });
  if (!existing) throw new ApiError(404, 'No se encontró el producto.');
  if (input.name) {
    const duplicate = await prisma.shoppingProduct.findUnique({ where: { spaceId_normalizedName: { spaceId: request.space!.spaceId, normalizedName: normalizeShoppingName(input.name) } } });
    if (duplicate && duplicate.id !== id) throw new ApiError(409, `Ya existe el producto «${duplicate.name}».`);
  }
  const product = await prisma.shoppingProduct.update({
    where: { id },
    data: { ...input, ...(input.name ? { normalizedName: normalizeShoppingName(input.name) } : {}) },
  });
  response.json(product);
}));

shoppingRouter.get('/list', asyncHandler(async (request, response) => {
  const items = await prisma.shoppingListItem.findMany({
    where: { spaceId: request.space!.spaceId },
    include: { product: { include: { variants: { where: { active: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  response.json(items);
}));

shoppingRouter.post('/list', asyncHandler(async (request, response) => {
  const input = z.object({ productId: z.string().min(1), note: z.string().trim().max(160).optional().nullable() }).parse(request.body);
  const spaceId = request.space!.spaceId;
  const product = await prisma.shoppingProduct.findFirst({ where: { id: input.productId, spaceId } });
  if (!product || !product.active) throw new ApiError(404, 'No se encontró el producto activo.');
  const item = await prisma.shoppingListItem.upsert({
    where: { productId: input.productId },
    create: { ...input, spaceId },
    update: { note: input.note || null },
    include: { product: true },
  });
  response.status(201).json(item);
}));

shoppingRouter.patch('/list/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const { note } = z.object({ note: z.string().trim().max(160).nullable() }).parse(request.body);
  const existing = await prisma.shoppingListItem.findFirst({ where: { id, spaceId: request.space!.spaceId } });
  if (!existing) throw new ApiError(404, 'No se encontró el elemento de la lista.');
  const item = await prisma.shoppingListItem.update({ where: { id }, data: { note: note || null }, include: { product: true } });
  response.json(item);
}));

shoppingRouter.delete('/list/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const existing = await prisma.shoppingListItem.findFirst({ where: { id, spaceId: request.space!.spaceId } });
  if (!existing) throw new ApiError(404, 'No se encontró el elemento de la lista.');
  await prisma.shoppingListItem.delete({ where: { id } });
  response.status(204).end();
}));

shoppingRouter.get('/receipts', asyncHandler(async (request, response) => {
  const receipts = await prisma.shoppingReceipt.findMany({
    where: { spaceId: request.space!.spaceId, voidedAt: null },
    include: {
      supermarket: true,
      financialEntry: { include: { category: true, shares: { where: { isActive: true }, include: { user: { select: { id: true, email: true, displayName: true } } } } } },
      items: { include: { product: true, variant: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  response.json(receipts);
}));

shoppingRouter.post('/receipts', asyncHandler(async (request, response) => {
  const input = receiptSchema.parse(request.body);
  const spaceId = request.space!.spaceId;
  const isCoLife = request.space!.spaceType === 'COLIFE';
  const lineCents = input.items.reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const totalCents = lineCents + moneyToCents(input.adjustment);
  if (totalCents <= 0 || totalCents > 999999999999) throw new ApiError(400, 'El total del ticket debe ser mayor que cero y estar dentro del límite admitido.');
  if (isCoLife && (!input.splitMode || !input.participants)) throw new ApiError(400, 'Un ticket CoLife necesita pagador y participantes del reparto.');
  if (!isCoLife && input.splitMode) throw new ApiError(400, 'El reparto solo está disponible en tickets CoLife.');
  if (isCoLife && input.splitMode !== 'EQUAL') throw new ApiError(400, 'Los tickets CoLife admiten actualmente reparto igualitario.');
  let allocations: ReturnType<typeof allocateExpense> = [];
  if (isCoLife) {
    try {
      allocations = allocateExpense(totalCents, input.splitMode as AllocationMode, input.participants as AllocationInput[]);
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400, error.message);
      throw error;
    }
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const groupSpace = isCoLife ? await tx.space.findUnique({ where: { id: spaceId } }) : null;
    if (isCoLife && !groupSpace) throw new ApiError(404, 'No se encontró el CoLife.');
    const category = await tx.category.findFirst({ where: { id: input.categoryId, spaceId } });
    if (!category || category.type !== TransactionType.EXPENSE) throw new ApiError(400, 'Elige una categoría de gasto válida.');
    if (isCoLife) await assertActiveCoLifeMembers(tx, spaceId, [request.auth!.userId, ...allocations.map(({ userId }) => userId)]);
    const supermarket = await getOrCreateSupermarket(tx, input.supermarketName, spaceId);
    const financialEntry = await tx.financialEntry.create({
      data: {
        type: TransactionType.EXPENSE,
        status: TransactionStatus.CONFIRMED,
        amount: centsToDecimal(totalCents),
        description: `Compra ${supermarket.name}`.slice(0, 160),
        date: input.date,
        categoryId: category.id,
        spaceId,
        payerUserId: isCoLife ? request.auth!.userId : null,
      },
    });
    const created = await tx.shoppingReceipt.create({
      data: {
        spaceId,
        supermarketId: supermarket.id,
        financialEntryId: financialEntry.id,
        date: input.date,
        adjustment: input.adjustment,
        totalAmount: totalCents / 100,
      },
    });
    const actualLineCents = await replaceReceiptItems(tx, created.id, spaceId, input.items);
    if (actualLineCents !== lineCents) throw new ApiError(400, 'No se pudieron validar los importes de las líneas.');
    if (isCoLife && groupSpace) {
      await syncExpenseShares(tx, {
        entryId: financialEntry.id,
        groupSpace,
        mode: input.splitMode as AllocationMode,
        description: financialEntry.description,
        date: financialEntry.date,
        allocations,
      });
      await tx.auditEvent.create({
        data: {
          spaceId,
          actorId: request.auth!.userId,
          entityType: 'SHARED_EXPENSE',
          entityId: financialEntry.id,
          action: 'CREATED_FROM_RECEIPT',
          details: JSON.stringify({ receiptId: created.id, totalCents, payerUserId: request.auth!.userId, splitMode: input.splitMode, allocations }),
        },
      });
    }
    return tx.shoppingReceipt.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        supermarket: true,
        financialEntry: {
          include: {
            category: true,
            shares: {
              where: { isActive: true },
              include: { user: { select: { id: true, email: true, displayName: true } } },
            },
          },
        },
        items: { include: { product: true, variant: true } },
      },
    });
  });
  response.status(201).json(receipt);
}));

shoppingRouter.patch('/receipts/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = receiptSchema.parse(request.body);
  const isCoLife = request.space!.spaceType === 'COLIFE';
  const lineCents = input.items.reduce((sum, item) => sum + moneyToCents(item.amount), 0);
  const totalCents = lineCents + moneyToCents(input.adjustment);
  if (totalCents <= 0 || totalCents > 999999999999) throw new ApiError(400, 'El total del ticket debe ser mayor que cero y estar dentro del límite admitido.');
  if (isCoLife && (!input.splitMode || !input.participants)) throw new ApiError(400, 'Un ticket CoLife necesita pagador y participantes del reparto.');
  if (!isCoLife && input.splitMode) throw new ApiError(400, 'El reparto solo está disponible en tickets CoLife.');
  if (isCoLife && input.splitMode !== 'EQUAL') throw new ApiError(400, 'Los tickets CoLife admiten actualmente reparto igualitario.');
  let allocations: ReturnType<typeof allocateExpense> = [];
  if (isCoLife) {
    try {
      allocations = allocateExpense(totalCents, input.splitMode as AllocationMode, input.participants as AllocationInput[]);
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400, error.message);
      throw error;
    }
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const spaceId = request.space!.spaceId;
    const existing = await tx.shoppingReceipt.findFirst({ where: { id, spaceId, voidedAt: null } });
    if (!existing) throw new ApiError(404, 'No se encontró el ticket.');
    const existingEntry = await tx.financialEntry.findFirst({ where: { id: existing.financialEntryId, spaceId, voidedAt: null }, include: { shares: true } });
    if (!existingEntry) throw new ApiError(404, 'No se encontró el gasto enlazado al ticket.');
    const groupSpace = isCoLife ? await tx.space.findUnique({ where: { id: spaceId } }) : null;
    if (isCoLife && !groupSpace) throw new ApiError(404, 'No se encontró el CoLife.');
    const category = await tx.category.findFirst({ where: { id: input.categoryId, spaceId } });
    if (!category || category.type !== TransactionType.EXPENSE) throw new ApiError(400, 'Elige una categoría de gasto válida.');
    if (isCoLife) await assertActiveCoLifeMembers(tx, spaceId, [existingEntry.payerUserId ?? request.auth!.userId, ...allocations.map(({ userId }) => userId)]);
    const supermarket = await getOrCreateSupermarket(tx, input.supermarketName, spaceId);
    await tx.financialEntry.update({
      where: { id: existing.financialEntryId, spaceId },
      data: { amount: centsToDecimal(totalCents), description: `Compra ${supermarket.name}`.slice(0, 160), date: input.date, categoryId: category.id },
    });
    await tx.shoppingReceiptItem.deleteMany({ where: { receiptId: id, spaceId } });
    await tx.shoppingReceipt.update({ where: { id }, data: { supermarketId: supermarket.id, date: input.date, adjustment: input.adjustment, totalAmount: totalCents / 100 } });
    const actualLineCents = await replaceReceiptItems(tx, id, spaceId, input.items);
    if (actualLineCents !== lineCents) throw new ApiError(400, 'No se pudieron validar los importes de las líneas.');
    if (isCoLife && groupSpace) {
      await syncExpenseShares(tx, {
        entryId: existingEntry.id,
        groupSpace,
        mode: input.splitMode as AllocationMode,
        description: `Compra ${supermarket.name}`.slice(0, 160),
        date: input.date,
        allocations,
      });
      const settlementCount = await tx.settlement.count({ where: { spaceId, createdAt: { gte: existingEntry.createdAt } } });
      const reconciliationAdjustments = settlementCount && existingEntry.status === 'CONFIRMED'
        ? await reconcileSettledExpenseCorrection(tx, {
          spaceId,
          entryId: existingEntry.id,
          previous: {
            payerUserId: existingEntry.payerUserId,
            totalCents: moneyToCents(existingEntry.amount.toNumber()),
            shares: existingEntry.shares.filter(({ isActive }) => isActive).map(({ userId, amount }) => ({ userId, amountCents: moneyToCents(amount.toNumber()) })),
          },
          replacement: {
            payerUserId: existingEntry.payerUserId,
            totalCents,
            shares: allocations.map(({ userId, amountCents }) => ({ userId, amountCents })),
          },
        })
        : [];
      await tx.auditEvent.create({
        data: {
          spaceId,
          actorId: request.auth!.userId,
          entityType: 'SHARED_EXPENSE',
          entityId: existingEntry.id,
          action: settlementCount ? 'CORRECTED_AFTER_SETTLEMENT' : 'UPDATED_FROM_RECEIPT',
          details: JSON.stringify({ receiptId: id, totalCents, splitMode: input.splitMode, allocations, historicalSettlementsPreserved: settlementCount, reconciliationAdjustments }),
        },
      });
    }
    return tx.shoppingReceipt.findUniqueOrThrow({
      where: { id },
      include: {
        supermarket: true,
        financialEntry: {
          include: {
            category: true,
            shares: {
              where: { isActive: true },
              include: { user: { select: { id: true, email: true, displayName: true } } },
            },
          },
        },
        items: { include: { product: true, variant: true } },
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.json(receipt);
}));

shoppingRouter.delete('/receipts/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  await prisma.$transaction(async (tx) => {
    const spaceId = request.space!.spaceId;
    const receipt = await tx.shoppingReceipt.findFirst({ where: { id, spaceId, voidedAt: null } });
    if (!receipt) throw new ApiError(404, 'No se encontró el ticket.');
    if (request.space!.spaceType === 'COLIFE') {
      const [entry, groupSpace] = await Promise.all([
        tx.financialEntry.findFirst({ where: { id: receipt.financialEntryId, spaceId, voidedAt: null }, include: { shares: true } }),
        tx.space.findUnique({ where: { id: spaceId } }),
      ]);
      if (!entry || !groupSpace) throw new ApiError(404, 'No se encontró el gasto compartido enlazado.');
      const settlementCount = await tx.settlement.count({ where: { spaceId, createdAt: { gte: entry.createdAt } } });
      const reconciliationAdjustments = settlementCount && entry.status === 'CONFIRMED'
        ? await reconcileSettledExpenseCorrection(tx, {
          spaceId,
          entryId: entry.id,
          previous: {
            payerUserId: entry.payerUserId,
            totalCents: moneyToCents(entry.amount.toNumber()),
            shares: entry.shares.filter(({ isActive }) => isActive).map(({ userId, amount }) => ({ userId, amountCents: moneyToCents(amount.toNumber()) })),
          },
          replacement: null,
        })
        : [];
      await tx.financialEntry.update({ where: { id: entry.id }, data: { voidedAt: new Date() } });
      await tx.shoppingReceipt.update({ where: { id }, data: { voidedAt: new Date() } });
      for (const share of entry.shares.filter(({ isActive }) => isActive)) {
        await tx.expenseShare.update({ where: { id: share.id }, data: { isActive: false } });
        await syncPersonalMirror(tx, {
          shareId: share.id,
          userId: share.userId,
          groupSpace,
          description: entry.description,
          date: entry.date,
          amountCents: moneyToCents(share.amount.toNumber()),
          active: false,
        });
      }
      await tx.auditEvent.create({
        data: {
          spaceId,
          actorId: request.auth!.userId,
          entityType: 'SHARED_EXPENSE',
          entityId: entry.id,
          action: 'REVERSED_FROM_RECEIPT',
          details: JSON.stringify({ receiptId: id, amount: entry.amount.toString(), historicalPaymentsPreserved: true, reconciliationAdjustments }),
        },
      });
      return;
    }
    await tx.shoppingReceiptItem.deleteMany({ where: { receiptId: id, spaceId } });
    await tx.shoppingReceipt.delete({ where: { id } });
    await tx.financialEntry.delete({ where: { id: receipt.financialEntryId, spaceId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(204).end();
}));

shoppingRouter.get('/compare/:productId', asyncHandler(async (request, response) => {
  const { productId } = z.object({ productId: z.string().min(1) }).parse(request.params);
  const spaceId = request.space!.spaceId;
  const product = await prisma.shoppingProduct.findFirst({ where: { id: productId, spaceId } });
  if (!product) throw new ApiError(404, 'No se encontró el producto.');
  const dimension = product.dimension;
  if (!dimension) {
    response.json({ product, unit: null, recommendations: [], history: [] });
    return;
  }
  if (!dimensions.includes(dimension as typeof dimensions[number])) throw new ApiError(409, 'El producto tiene una dimensión no válida.');
  const comparableDimension = dimension as ShoppingDimension;
  const observations = await prisma.shoppingReceiptItem.findMany({
    where: { spaceId, productId, receipt: { spaceId, voidedAt: null, supermarket: { active: true, spaceId } } },
    include: { receipt: { include: { supermarket: true } }, variant: true },
    orderBy: [{ receipt: { date: 'desc' } }, { createdAt: 'desc' }],
  });
  const latestByVariantStore = new Map<string, (typeof observations)[number]>();
  for (const observation of observations) {
    const key = `${observation.receipt.supermarketId}:${observation.variantId}`;
    if (!latestByVariantStore.has(key)) latestByVariantStore.set(key, observation);
  }
  const perStore = new Map<string, { supermarketId: string; supermarketName: string; observation: (typeof observations)[number]; pricePerStandard: number }>();
  for (const observation of latestByVariantStore.values()) {
    const quantity = observation.quantityBase.toNumber();
    const amount = observation.amount.toNumber();
    const unitPrice = pricePerStandard(amount, quantity, comparableDimension);
    const current = perStore.get(observation.receipt.supermarketId);
    if (!current || unitPrice < current.pricePerStandard) {
      perStore.set(observation.receipt.supermarketId, {
        supermarketId: observation.receipt.supermarketId,
        supermarketName: observation.receipt.supermarket.name,
        observation,
        pricePerStandard: unitPrice,
      });
    }
  }
  const recommendations = [...perStore.values()].map(({ supermarketId, supermarketName, observation, pricePerStandard }) => ({
    supermarketId,
    supermarketName,
    variantId: observation.variantId,
    brand: observation.variant.brand,
    packageLabel: observation.variant.packageLabel,
    amount: observation.amount.toNumber(),
    quantityBase: observation.quantityBase.toNumber(),
    pricePerStandard,
    date: observation.receipt.date,
  })).sort((a, b) => a.pricePerStandard - b.pricePerStandard);
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
  const history = observations
    .filter((observation) => observation.receipt.date >= cutoff)
    .reverse()
    .map((observation) => ({
      id: observation.id,
      supermarketId: observation.receipt.supermarketId,
      supermarketName: observation.receipt.supermarket.name,
      variantId: observation.variantId,
      brand: observation.variant.brand,
      packageLabel: observation.variant.packageLabel,
      pricePerStandard: pricePerStandard(observation.amount.toNumber(), observation.quantityBase.toNumber(), comparableDimension),
      date: observation.receipt.date,
    }));
  response.json({ product, unit: comparableDimension === 'WEIGHT' ? '€/kg' : comparableDimension === 'VOLUME' ? '€/l' : '€/unidad', recommendations, history });
}));
