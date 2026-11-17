import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { calculateBalances, suggestTransfers } from '../lib/settlement-domain.js';
import { centsToDecimal } from '../lib/shared-ledger.js';

export const settlementsRouter = Router();
const settlementSchema = z.object({
	fromUserId: z.string().min(1).max(30),
	toUserId: z.string().min(1).max(30),
	amountCents: z.number().int().positive().max(999_999_999_999),
	paidAt: z.coerce.date().optional(),
	note: z.string().trim().max(160).optional().nullable(),
});

function cents(amount: Prisma.Decimal): number {
	return Math.round(amount.toNumber() * 100);
}

async function loadLedger(spaceId: string) {
	const [members, entries, settlements, adjustments] = await prisma.$transaction([
		prisma.membership.findMany({
			where: { spaceId },
			include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
			orderBy: { joinedAt: 'asc' },
		}),
		prisma.financialEntry.findMany({
			where: { spaceId, type: 'EXPENSE', status: 'CONFIRMED', voidedAt: null, payerUserId: { not: null } },
			include: { shares: { where: { isActive: true }, select: { userId: true, amount: true } } },
		}),
		prisma.settlement.findMany({ where: { spaceId }, select: { fromUserId: true, toUserId: true, amount: true } }),
		prisma.settlementAdjustment.findMany({ where: { spaceId }, select: { userId: true, amount: true } }),
	]);
	const computed = calculateBalances(
		entries.map((entry) => ({
			totalCents: cents(entry.amount),
			payerUserId: entry.payerUserId!,
			shares: entry.shares.map((share) => ({ userId: share.userId, amountCents: cents(share.amount) })),
		})),
		settlements.map((settlement) => ({
			fromUserId: settlement.fromUserId,
			toUserId: settlement.toUserId,
			amountCents: cents(settlement.amount),
		})),
		adjustments.map((adjustment) => ({ userId: adjustment.userId, amountCents: cents(adjustment.amount) })),
	);
	const balanceByUser = new Map(computed.map(({ userId, balanceCents }) => [userId, balanceCents]));
	const balances = members.map(({ user, role, status, joinedAt, leftAt }) => ({
		user,
		role,
		status,
		joinedAt,
		leftAt,
		balanceCents: balanceByUser.get(user.id) ?? 0,
	}));
	const normalizedBalances = balances.map(({ user, balanceCents }) => ({ userId: user.id, balanceCents }));
	return { balances, suggestions: suggestTransfers(normalizedBalances) };
}

settlementsRouter.get('/balance', asyncHandler(async (request, response) => {
	if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Los saldos compartidos solo existen en CoLife.');
	response.json(await loadLedger(request.space!.spaceId));
}));

settlementsRouter.get('/', asyncHandler(async (request, response) => {
	if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Las liquidaciones solo existen en CoLife.');
	const settlements = await prisma.settlement.findMany({
		where: { spaceId: request.space!.spaceId },
		include: {
			fromUser: { select: { id: true, email: true, displayName: true } },
			toUser: { select: { id: true, email: true, displayName: true } },
			createdBy: { select: { id: true, email: true, displayName: true } },
		},
		orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
	});
	response.json(settlements);
}));

settlementsRouter.post('/', asyncHandler(async (request, response) => {
	if (request.space!.spaceType !== 'COLIFE') throw new ApiError(400, 'Las liquidaciones solo existen en CoLife.');
	const input = settlementSchema.parse(request.body);
	const spaceId = request.space!.spaceId;
	if (input.fromUserId === input.toUserId) throw new ApiError(400, 'El origen y el destino del pago deben ser distintos.');
	if (input.paidAt && input.paidAt.getTime() > Date.now()) throw new ApiError(400, 'La fecha del pago no puede estar en el futuro.');
	if (request.auth!.userId !== input.fromUserId && request.auth!.userId !== input.toUserId) {
		throw new ApiError(403, 'Solo el pagador o el receptor pueden registrar esta liquidación.');
	}

	await prisma.$transaction(async (tx) => {
		const [fromMembership, toMembership] = await Promise.all([
			tx.membership.findFirst({ where: { spaceId, userId: input.fromUserId } }),
			tx.membership.findFirst({ where: { spaceId, userId: input.toUserId } }),
		]);
		if (!fromMembership || !toMembership) throw new ApiError(400, 'Ambas personas deben pertenecer al CoLife.');

		const [entries, existingSettlements, adjustments] = await Promise.all([
			tx.financialEntry.findMany({
				where: { spaceId, type: 'EXPENSE', status: 'CONFIRMED', voidedAt: null, payerUserId: { not: null } },
				include: { shares: { where: { isActive: true }, select: { userId: true, amount: true } } },
			}),
			tx.settlement.findMany({ where: { spaceId }, select: { fromUserId: true, toUserId: true, amount: true } }),
			tx.settlementAdjustment.findMany({ where: { spaceId }, select: { userId: true, amount: true } }),
		]);
		const balances = calculateBalances(
			entries.map((entry) => ({
				totalCents: cents(entry.amount),
				payerUserId: entry.payerUserId!,
				shares: entry.shares.map((share) => ({ userId: share.userId, amountCents: cents(share.amount) })),
			})),
			existingSettlements.map((settlement) => ({
				fromUserId: settlement.fromUserId,
				toUserId: settlement.toUserId,
				amountCents: cents(settlement.amount),
			})),
			adjustments.map((adjustment) => ({ userId: adjustment.userId, amountCents: cents(adjustment.amount) })),
		);
		const balanceByUser = new Map(balances.map(({ userId, balanceCents }) => [userId, balanceCents]));
		const debt = -(balanceByUser.get(input.fromUserId) ?? 0);
		const credit = balanceByUser.get(input.toUserId) ?? 0;
		if (debt <= 0 || credit <= 0 || input.amountCents > Math.min(debt, credit)) {
			throw new ApiError(409, 'El pago supera el saldo pendiente entre estas personas. Actualiza los saldos antes de registrar el pago.');
		}

		const settlement = await tx.settlement.create({
			data: {
				spaceId,
				fromUserId: input.fromUserId,
				toUserId: input.toUserId,
				createdByUserId: request.auth!.userId,
				amount: centsToDecimal(input.amountCents),
				note: input.note || null,
				paidAt: input.paidAt ?? new Date(),
			},
		});
		await tx.auditEvent.create({
			data: {
				spaceId,
				actorId: request.auth!.userId,
				entityType: 'SETTLEMENT',
				entityId: settlement.id,
				action: 'RECORDED',
				details: JSON.stringify({ fromUserId: input.fromUserId, toUserId: input.toUserId, amountCents: input.amountCents }),
			},
		});
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	response.status(201).json(await loadLedger(spaceId));
}));
