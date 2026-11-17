import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { ApiError } from './api-error.js';

export const SESSION_COOKIE = 'mylife_session';
export const CSRF_COOKIE = 'mylife_csrf';

export interface AuthContext {
  userId: string;
  sessionId: string;
  csrfTokenHash: string;
  email: string;
  displayName: string | null;
}

export interface SpaceContext {
  spaceId: string;
  spaceType: string;
  spaceName: string;
  membershipRole: string;
  archivedAt: Date | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    space?: SpaceContext;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function resolveAuth(request: Request): Promise<AuthContext | null> {
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken || rawToken.length > 200) return null;
  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash: sha256(rawToken),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  if (!session) return null;
  return {
    userId: session.userId,
    sessionId: session.id,
    csrfTokenHash: session.csrfTokenHash,
    email: session.user.email,
    displayName: session.user.displayName,
  };
}

export const optionalAuthentication: RequestHandler = async (request, _response, next) => {
  try {
    request.auth = (await resolveAuth(request)) ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuthentication: RequestHandler = async (request, _response, next) => {
  try {
    request.auth = (await resolveAuth(request)) ?? undefined;
    if (!request.auth) throw new ApiError(401, 'Inicia sesión para continuar.');
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCsrfForMutations: RequestHandler = (request, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next();
    return;
  }
  if (request.get('origin') !== config.FRONTEND_ORIGIN) {
    next(new ApiError(403, 'Origen no permitido.'));
    return;
  }
  const csrfCookie = readCookie(request, CSRF_COOKIE);
  const csrfHeader = request.get('x-csrf-token');
  if (!request.auth || !csrfCookie || !csrfHeader || csrfCookie !== csrfHeader || sha256(csrfHeader) !== request.auth.csrfTokenHash) {
    next(new ApiError(403, 'Verificación CSRF no válida.'));
    return;
  }
  next();
};

export const requireTenantDataReady: RequestHandler = (_request, _response, next) => {
  if (!config.TENANT_DATA_READY) {
    next(new ApiError(503, 'El acceso a datos está deshabilitado hasta completar y verificar la migración de espacios.'));
    return;
  }
  next();
};

export const requireSpaceContext: RequestHandler = async (request, _response, next) => {
  try {
    if (!request.auth) throw new ApiError(401, 'Inicia sesión para continuar.');
    const spaceId = request.get('x-space-id');
    if (!spaceId || spaceId.length > 30) throw new ApiError(400, 'Selecciona un espacio válido.');
    const membership = await prisma.membership.findFirst({
      where: { userId: request.auth.userId, spaceId, status: 'ACTIVE' },
      include: { space: true },
    });
    if (!membership) throw new ApiError(403, 'No tienes acceso a este espacio.');
    request.space = {
      spaceId: membership.spaceId,
      spaceType: membership.space.type,
      spaceName: membership.space.name,
      membershipRole: membership.role,
      archivedAt: membership.space.archivedAt,
    };
    next();
  } catch (error) {
    next(error);
  }
};

export function assertSpaceWritable(request: Request): void {
  if (request.space?.spaceType === 'COLIFE' && request.space.archivedAt) {
    throw new ApiError(409, 'El CoLife está archivado y no admite esta operación.');
  }
}

export function requireAdmin(request: Request): void {
  if (request.space?.membershipRole !== 'ADMIN') {
    throw new ApiError(403, 'Se requiere el rol de administrador.');
  }
}

export function requireActiveSpace(request: Request, response: Response, next: NextFunction): void {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertSpaceWritable(request);
    next();
  } catch (error) {
    next(error);
  }
}
