import { Prisma } from '@prisma/client';
import type { Space } from '@prisma/client';
import { ApiError } from './api-error.js';
import { calculateExpenseCorrectionAdjustments, type ExpenseContributionSnapshot } from './settlement-domain.js';
import type { AllocationMode, AllocationResult } from './shared-expense.js';

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export async function reconcileSettledExpenseCorrection(
  tx: Prisma.TransactionClient,
  input: {
    spaceId: string;
    entryId: string;
    previous: ExpenseContributionSnapshot;
    replacement: ExpenseContributionSnapshot | null;
  },
) {
  const adjustments = calculateExpenseCorrectionAdjustments(input.previous, input.replacement);
  if (adjustments.length) {
    await tx.settlementAdjustment.createMany({
      data: adjustments.map(({ userId, amountCents }) => ({
        spaceId: input.spaceId,
        userId,
        amount: centsToDecimal(amountCents),
        reason: `Reconciliación del gasto ${input.entryId}`,
      })),
    });
  }
  return adjustments;
}

export async function assertActiveCoLifeMembers(tx: Prisma.TransactionClient, spaceId: string, userIds: string[]) {
  const requiredIds = [...new Set(userIds)];
  const memberships = await tx.membership.findMany({
    where: { spaceId, userId: { in: requiredIds }, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (memberships.length !== requiredIds.length) {
    throw new ApiError(400, 'El pagador y todos los participantes deben ser miembros activos del CoLife.');
  }
}

export async function getCoLifeCategoryForMember(
  tx: Prisma.TransactionClient,
  userId: string,
  groupSpace: Space,
) {
  const personalMembership = await tx.membership.findFirst({
    where: { userId, status: 'ACTIVE', space: { type: 'PERSONAL' } },
    include: { space: true },
  });
  if (!personalMembership) throw new ApiError(409, 'El miembro no tiene un espacio Personal activo.');

  const linkedCategory = await tx.category.findFirst({
    where: { spaceId: personalMembership.spaceId, sourceCoLifeSpaceId: groupSpace.id },
  });
  const baseName = `CoLife ${groupSpace.name}`;
  if (baseName.length > 40) throw new ApiError(409, 'El nombre del CoLife supera el límite de su categoría Personal.');

  let suffixNumber = 1;
  while (suffixNumber < 1000) {
    const suffix = suffixNumber === 1 ? '' : ` (${suffixNumber})`;
    const name = `${baseName.slice(0, 40 - suffix.length)}${suffix}`;
    const collision = await tx.category.findFirst({
      where: {
        spaceId: personalMembership.spaceId,
        name,
        type: 'EXPENSE',
        ...(linkedCategory ? { id: { not: linkedCategory.id } } : {}),
      },
    });
    if (!collision) {
      const category = linkedCategory
        ? await tx.category.update({ where: { id: linkedCategory.id }, data: { name } })
        : await tx.category.create({
          data: {
            spaceId: personalMembership.spaceId,
            sourceCoLifeSpaceId: groupSpace.id,
            name,
            type: 'EXPENSE',
            color: '#7c8da6',
            icon: 'users',
          },
        });
      return { personalSpace: personalMembership.space, category };
    }
    suffixNumber += 1;
  }
  throw new ApiError(409, 'No se pudo asignar un nombre único a la categoría Personal del CoLife.');
}

export async function renameLinkedCoLifeCategories(tx: Prisma.TransactionClient, groupSpace: Space) {
  const categories = await tx.category.findMany({
    where: { sourceCoLifeSpaceId: groupSpace.id },
    select: { id: true, spaceId: true },
  });
  const baseName = `CoLife ${groupSpace.name}`;
  if (baseName.length > 40) throw new ApiError(409, 'El nombre del CoLife supera el límite de su categoría Personal.');

  for (const category of categories) {
    if (!category.spaceId) continue;
    let suffixNumber = 1;
    while (suffixNumber < 1000) {
      const suffix = suffixNumber === 1 ? '' : ` (${suffixNumber})`;
      const name = `${baseName.slice(0, 40 - suffix.length)}${suffix}`;
      const collision = await tx.category.findFirst({
        where: { spaceId: category.spaceId, name, type: 'EXPENSE', id: { not: category.id } },
        select: { id: true },
      });
      if (!collision) {
        await tx.category.update({ where: { id: category.id }, data: { name } });
        break;
      }
      suffixNumber += 1;
    }
    if (suffixNumber >= 1000) throw new ApiError(409, 'No se pudo asignar un nombre único a la categoría Personal del CoLife.');
  }
}

export async function syncPersonalMirror(
  tx: Prisma.TransactionClient,
  input: {
    shareId: string;
    userId: string;
    groupSpace: Space;
    description: string;
    date: Date;
    amountCents: number;
    active: boolean;
  },
) {
  const { personalSpace, category } = await getCoLifeCategoryForMember(tx, input.userId, input.groupSpace);
  const existing = await tx.financialEntry.findUnique({ where: { derivedShareId: input.shareId } });
  const data = {
    spaceId: personalSpace.id,
    type: 'EXPENSE',
    status: 'CONFIRMED',
    amount: centsToDecimal(input.amountCents),
    description: `CoLife · ${input.groupSpace.name}: ${input.description}`.slice(0, 160),
    date: input.date,
    isFixed: false,
    categoryId: category.id,
    payerUserId: null,
    voidedAt: input.active ? null : new Date(),
  };
  if (existing) {
    return tx.financialEntry.update({ where: { id: existing.id }, data });
  }
  return tx.financialEntry.create({
    data: { ...data, derivedShareId: input.shareId },
  });
}

export async function syncExpenseShares(
  tx: Prisma.TransactionClient,
  input: {
    entryId: string;
    groupSpace: Space;
    mode: AllocationMode;
    description: string;
    date: Date;
    allocations: AllocationResult[];
    syncMirrors?: boolean;
  },
) {
  const syncMirrors = input.syncMirrors ?? true;
  const existingShares = await tx.expenseShare.findMany({ where: { entryId: input.entryId } });
  const remaining = new Map(input.allocations.map((allocation) => [allocation.userId, allocation]));
  for (const share of existingShares) {
    const allocation = remaining.get(share.userId);
    if (!allocation) {
      if (share.isActive) {
        await tx.expenseShare.update({ where: { id: share.id }, data: { isActive: false } });
        if (syncMirrors) await syncPersonalMirror(tx, {
          shareId: share.id,
          userId: share.userId,
          groupSpace: input.groupSpace,
          description: input.description,
          date: input.date,
          amountCents: Math.round(share.amount.toNumber() * 100),
          active: false,
        });
      }
      continue;
    }
    await tx.expenseShare.update({
      where: { id: share.id },
      data: {
        amount: centsToDecimal(allocation.amountCents),
        allocationType: input.mode,
        shareBasis: allocation.shareBasis,
        isActive: true,
      },
    });
    if (syncMirrors) await syncPersonalMirror(tx, {
      shareId: share.id,
      userId: share.userId,
      groupSpace: input.groupSpace,
      description: input.description,
      date: input.date,
      amountCents: allocation.amountCents,
      active: true,
    });
    remaining.delete(share.userId);
  }

  for (const allocation of remaining.values()) {
    const share = await tx.expenseShare.create({
      data: {
        entryId: input.entryId,
        userId: allocation.userId,
        amount: centsToDecimal(allocation.amountCents),
        allocationType: input.mode,
        shareBasis: allocation.shareBasis,
      },
    });
    if (syncMirrors) await syncPersonalMirror(tx, {
      shareId: share.id,
      userId: allocation.userId,
      groupSpace: input.groupSpace,
      description: input.description,
      date: input.date,
      amountCents: allocation.amountCents,
      active: true,
    });
  }
}
