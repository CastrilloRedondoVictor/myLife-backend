import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { DEFAULT_CATEGORIES } from '../lib/default-categories.js';
import { renameLinkedCoLifeCategories } from '../lib/shared-ledger.js';

export const spacesRouter = Router();
const createSpaceSchema = z.object({ name: z.string().trim().min(1).max(33) });
const inviteSchema = z.object({ token: z.string().min(32).max(128) });
const archiveSchema = z.object({ archived: z.boolean() });
const renameSpaceSchema = z.object({ name: z.string().trim().min(1).max(33) });
const memberRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });

async function getMembership(userId: string, spaceId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, spaceId, status: 'ACTIVE' },
    include: { space: true },
  });
  if (!membership) throw new ApiError(403, 'No tienes acceso a este espacio.');
  return membership;
}

async function getCoLifeAdmin(userId: string, spaceId: string) {
  const membership = await getMembership(userId, spaceId);
  if (membership.space.type !== 'COLIFE') throw new ApiError(400, 'La gestión de miembros solo está disponible en CoLife.');
  if (membership.space.archivedAt) throw new ApiError(409, 'Restaura el CoLife antes de gestionar sus miembros.');
  if (membership.role !== 'ADMIN') throw new ApiError(403, 'Se requiere el rol de administrador.');
  return membership;
}

async function preventRemovingLastAdmin(tx: Prisma.TransactionClient, spaceId: string, membershipId: string) {
  const adminCount = await tx.membership.count({ where: { spaceId, role: 'ADMIN', status: 'ACTIVE' } });
  if (adminCount <= 1) {
    const membership = await tx.membership.findUnique({ where: { id: membershipId }, select: { role: true } });
    if (membership?.role === 'ADMIN') throw new ApiError(409, 'El CoLife debe conservar al menos un administrador activo.');
  }
}

async function pauseMemberRecurringRules(tx: Prisma.TransactionClient, spaceId: string, userId: string, actorId: string) {
  const rules = await tx.recurringRule.findMany({
    where: {
      spaceId,
      active: true,
      OR: [{ payerUserId: userId }, { shares: { some: { userId } } }],
    },
    select: { id: true, description: true },
  });
  if (!rules.length) return;
  await tx.recurringRule.updateMany({ where: { id: { in: rules.map(({ id }) => id) } }, data: { active: false } });
  await tx.auditEvent.createMany({
    data: rules.map((rule) => ({
      spaceId,
      actorId,
      entityType: 'RECURRING_RULE',
      entityId: rule.id,
      action: 'PAUSED_MEMBER_LEFT',
      details: JSON.stringify({ userId, description: rule.description }),
    })),
  });
}

spacesRouter.get('/', asyncHandler(async (request, response) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: request.auth!.userId, status: 'ACTIVE' },
    include: { space: true },
    orderBy: [{ space: { type: 'asc' } }, { space: { name: 'asc' } }],
  });
  response.json(memberships.map(({ space, role }) => ({
    id: space.id,
    name: space.name,
    type: space.type,
    currency: space.currency,
    role,
    archivedAt: space.archivedAt,
  })));
}));

spacesRouter.patch('/:spaceId', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  const { name } = renameSpaceSchema.parse(request.body);
  await getCoLifeAdmin(request.auth!.userId, spaceId);
  const space = await prisma.$transaction(async (tx) => {
    const updated = await tx.space.update({ where: { id: spaceId }, data: { name } });
    await renameLinkedCoLifeCategories(tx, updated);
    await tx.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'SPACE',
        entityId: spaceId,
        action: 'RENAMED',
        details: JSON.stringify({ name }),
      },
    });
    return updated;
  });
  response.json({ id: space.id, name: space.name, type: space.type, currency: space.currency, archivedAt: space.archivedAt });
}));

spacesRouter.post('/', asyncHandler(async (request, response) => {
  const { name } = createSpaceSchema.parse(request.body);
  const rawToken = randomBytes(32).toString('base64url');
  const created = await prisma.$transaction(async (transaction) => {
    const space = await transaction.space.create({
      data: {
        name,
        type: 'COLIFE',
        currency: 'EUR',
        createdByUserId: request.auth!.userId,
        memberships: { create: { userId: request.auth!.userId, role: 'ADMIN', status: 'ACTIVE' } },
      },
    });
    await transaction.category.createMany({
      data: DEFAULT_CATEGORIES.filter((category) => category.type === 'EXPENSE').map((category) => ({ ...category, spaceId: space.id })),
    });
    await transaction.invitation.create({
      data: {
        spaceId: space.id,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        acceptanceOpen: true,
        createdByUserId: request.auth!.userId,
      },
    });
    await transaction.auditEvent.create({
      data: {
        spaceId: space.id,
        actorId: request.auth!.userId,
        entityType: 'SPACE',
        entityId: space.id,
        action: 'CREATED',
        details: JSON.stringify({ name: space.name, type: space.type }),
      },
    });
    return space;
  });
  response.status(201).json({
    id: created.id,
    name: created.name,
    type: created.type,
    currency: created.currency,
    role: 'ADMIN',
    invitation: { token: rawToken, url: `${config.FRONTEND_ORIGIN}/?invite=${rawToken}` },
  });
}));

spacesRouter.post('/invitations/accept', asyncHandler(async (request, response) => {
  const { token } = inviteSchema.parse(request.body);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const joined = await prisma.$transaction(async (transaction) => {
    const invitation = await transaction.invitation.findFirst({
      where: { tokenHash, acceptanceOpen: true },
      include: { space: true },
    });
    if (!invitation || invitation.space.archivedAt) throw new ApiError(404, 'La invitación no está disponible.');
    const existing = await transaction.membership.findUnique({
      where: { spaceId_userId: { spaceId: invitation.spaceId, userId: request.auth!.userId } },
    });
    if (existing?.status === 'ACTIVE') throw new ApiError(409, 'Ya eres miembro de este CoLife.');
    if (existing) {
      await transaction.membership.update({
        where: { id: existing.id },
        data: { role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date(), leftAt: null },
      });
    } else {
      await transaction.membership.create({
        data: { spaceId: invitation.spaceId, userId: request.auth!.userId, role: 'MEMBER', status: 'ACTIVE' },
      });
    }
    await transaction.auditEvent.create({
      data: {
        spaceId: invitation.spaceId,
        actorId: request.auth!.userId,
        entityType: 'MEMBERSHIP',
        entityId: request.auth!.userId,
        action: 'JOINED',
        details: JSON.stringify({ role: 'MEMBER' }),
      },
    });
    return { spaceId: invitation.spaceId, name: invitation.space.name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(201).json(joined);
}));

spacesRouter.get('/:spaceId/members', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  await getMembership(request.auth!.userId, spaceId);
  const members = await prisma.membership.findMany({
    where: { spaceId, status: 'ACTIVE' },
    include: { user: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
  response.json(members.map(({ user, role, joinedAt }) => ({ user, role, joinedAt })));
}));

spacesRouter.get('/:spaceId/invitation', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  const membership = await getMembership(request.auth!.userId, spaceId);
  if (membership.space.type !== 'COLIFE') throw new ApiError(400, 'Las invitaciones solo están disponibles en CoLife.');
  if (membership.role !== 'ADMIN') throw new ApiError(403, 'Se requiere el rol de administrador.');
  const invitation = await prisma.invitation.findUnique({ where: { spaceId }, select: { acceptanceOpen: true } });
  if (!invitation) throw new ApiError(404, 'No se encontró la invitación.');
  response.json(invitation);
}));

spacesRouter.post('/:spaceId/invitation/rotate', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  await getCoLifeAdmin(request.auth!.userId, spaceId);
  const invitation = await prisma.invitation.findUnique({ where: { spaceId } });
  if (!invitation) throw new ApiError(404, 'No se encontró la invitación.');
  const rawToken = randomBytes(32).toString('base64url');
  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: invitation.id }, data: { tokenHash: createHash('sha256').update(rawToken).digest('hex') } });
    await tx.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'INVITATION',
        entityId: invitation.id,
        action: 'ROTATED',
        details: JSON.stringify({ acceptanceOpen: invitation.acceptanceOpen }),
      },
    });
  });
  response.status(201).json({ token: rawToken, url: `${config.FRONTEND_ORIGIN}/?invite=${rawToken}` });
}));

spacesRouter.patch('/:spaceId/members/:userId/role', asyncHandler(async (request, response) => {
  const { spaceId, userId } = z.object({ spaceId: z.string().min(1).max(30), userId: z.string().min(1).max(30) }).parse(request.params);
  const { role } = memberRoleSchema.parse(request.body);
  await getCoLifeAdmin(request.auth!.userId, spaceId);
  const updated = await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({ where: { spaceId, userId, status: 'ACTIVE' } });
    if (!target) throw new ApiError(404, 'No se encontró un miembro activo con ese identificador.');
    if (target.role === 'ADMIN' && role !== 'ADMIN') await preventRemovingLastAdmin(tx, spaceId, target.id);
    await tx.membership.update({ where: { id: target.id }, data: { role } });
    await tx.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'MEMBERSHIP',
        entityId: target.id,
        action: 'ROLE_CHANGED',
        details: JSON.stringify({ userId, previousRole: target.role, role }),
      },
    });
    return { userId, role };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.json(updated);
}));

spacesRouter.delete('/:spaceId/members/:userId', asyncHandler(async (request, response) => {
  const { spaceId, userId } = z.object({ spaceId: z.string().min(1).max(30), userId: z.string().min(1).max(30) }).parse(request.params);
  await getCoLifeAdmin(request.auth!.userId, spaceId);
  if (userId === request.auth!.userId) throw new ApiError(400, 'Usa la acción de salir del CoLife para retirar tu propia membresía.');
  await prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({ where: { spaceId, userId, status: 'ACTIVE' } });
    if (!target) throw new ApiError(404, 'No se encontró un miembro activo con ese identificador.');
    await preventRemovingLastAdmin(tx, spaceId, target.id);
    const leftAt = new Date();
    await tx.membership.update({ where: { id: target.id }, data: { status: 'LEFT', leftAt } });
    await pauseMemberRecurringRules(tx, spaceId, userId, request.auth!.userId);
    await tx.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'MEMBERSHIP',
        entityId: target.id,
        action: 'REMOVED',
        details: JSON.stringify({ userId, previousRole: target.role, status: 'LEFT', leftAt: leftAt.toISOString() }),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(204).end();
}));

spacesRouter.post('/:spaceId/leave', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  const membership = await getMembership(request.auth!.userId, spaceId);
  if (membership.space.type !== 'COLIFE') throw new ApiError(400, 'El espacio Personal no se puede abandonar.');
  if (membership.space.archivedAt) throw new ApiError(409, 'Restaura el CoLife antes de gestionar sus miembros.');
  await prisma.$transaction(async (tx) => {
    await preventRemovingLastAdmin(tx, spaceId, membership.id);
    const leftAt = new Date();
    await tx.membership.update({ where: { id: membership.id }, data: { status: 'LEFT', leftAt } });
    await pauseMemberRecurringRules(tx, spaceId, request.auth!.userId, request.auth!.userId);
    await tx.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'MEMBERSHIP',
        entityId: membership.id,
        action: 'LEFT',
        details: JSON.stringify({ userId: request.auth!.userId, role: membership.role, leftAt: leftAt.toISOString() }),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  response.status(204).end();
}));

spacesRouter.patch('/:spaceId/invitation', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  const { open } = z.object({ open: z.boolean() }).parse(request.body);
  const membership = await getMembership(request.auth!.userId, spaceId);
  if (membership.role !== 'ADMIN') throw new ApiError(403, 'Se requiere el rol de administrador.');
  if (membership.space.type !== 'COLIFE') throw new ApiError(400, 'Las invitaciones solo están disponibles en CoLife.');
  if (membership.space.archivedAt) throw new ApiError(409, 'Restaura el CoLife antes de cambiar sus invitaciones.');

  const invitation = await prisma.invitation.findUnique({ where: { spaceId } });
  if (!invitation) throw new ApiError(404, 'No se encontró la invitación.');
  await prisma.$transaction([
    prisma.invitation.update({ where: { id: invitation.id }, data: { acceptanceOpen: open } }),
    prisma.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'INVITATION',
        entityId: invitation.id,
        action: open ? 'OPENED' : 'CLOSED',
        details: JSON.stringify({ acceptanceOpen: open }),
      },
    }),
  ]);
  response.json({ acceptanceOpen: open });
}));

spacesRouter.patch('/:spaceId/archive', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  const { archived } = archiveSchema.parse(request.body);
  const membership = await getMembership(request.auth!.userId, spaceId);
  if (membership.role !== 'ADMIN') throw new ApiError(403, 'Se requiere el rol de administrador.');
  if (membership.space.type !== 'COLIFE') throw new ApiError(400, 'Solo se pueden archivar espacios CoLife.');
  const archivedAt = archived ? new Date() : null;
  await prisma.$transaction([
    prisma.space.update({ where: { id: spaceId }, data: { archivedAt } }),
    prisma.auditEvent.create({
      data: {
        spaceId,
        actorId: request.auth!.userId,
        entityType: 'SPACE',
        entityId: spaceId,
        action: archived ? 'ARCHIVED' : 'RESTORED',
        details: JSON.stringify({ archived }),
      },
    }),
  ]);
  response.json({ archivedAt });
}));

spacesRouter.get('/:spaceId/audit', asyncHandler(async (request, response) => {
  const { spaceId } = z.object({ spaceId: z.string().min(1).max(30) }).parse(request.params);
  await getMembership(request.auth!.userId, spaceId);
  const events = await prisma.auditEvent.findMany({
    where: { spaceId },
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  response.json(events);
}));
