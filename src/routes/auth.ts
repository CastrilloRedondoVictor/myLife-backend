import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { DEFAULT_CATEGORIES } from '../lib/default-categories.js';
import {
  CSRF_COOKIE,
  optionalAuthentication,
  readCookie,
  requireAuthentication,
  requireCsrfForMutations,
  SESSION_COOKIE,
  sha256,
} from '../lib/request-context.js';

export const authRouter = Router();
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const OIDC_TRANSACTION_DURATION_MS = 5 * 60 * 1000;
const cookieSecure = config.NODE_ENV === 'production';
const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
let oidcConfiguration: ReturnType<typeof discovery> | undefined;

function getOidcConfiguration() {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(503, 'El inicio de sesión Google no está configurado.');
  }
  oidcConfiguration ??= discovery(
    new URL('https://accounts.google.com'),
    config.GOOGLE_CLIENT_ID,
    { client_secret: config.GOOGLE_CLIENT_SECRET },
  );
  return oidcConfiguration;
}

function sessionCookieOptions() {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'lax' as const, path: '/api', maxAge: SESSION_DURATION_MS };
}

function oauthStateCookieOptions() {
  return { httpOnly: true, secure: cookieSecure, sameSite: 'lax' as const, path: '/api/auth/google/callback', maxAge: OIDC_TRANSACTION_DURATION_MS };
}

authRouter.get('/google/login', oauthLimiter, asyncHandler(async (_request, response) => {
  const client = await getOidcConfiguration();
  const state = randomState();
  const nonce = randomNonce();
  const pkceVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(pkceVerifier);
  const expiresAt = new Date(Date.now() + OIDC_TRANSACTION_DURATION_MS);

  await prisma.$transaction([
    prisma.oidcTransaction.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
    prisma.oidcTransaction.create({
      data: { stateHash: sha256(state), nonce, pkceVerifier, expiresAt },
    }),
  ]);
  response.cookie('mylife_oidc_state', state, oauthStateCookieOptions());
  const authorizationUrl = buildAuthorizationUrl(client, {
    redirect_uri: config.OIDC_REDIRECT_URI,
    scope: 'openid email profile',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    prompt: 'select_account',
  });
  response.redirect(authorizationUrl.href);
}));

authRouter.get('/google/callback', oauthLimiter, asyncHandler(async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  const stateCookie = readCookie(request, 'mylife_oidc_state');
  response.clearCookie('mylife_oidc_state', oauthStateCookieOptions());
  if (!state || !stateCookie || state !== stateCookie || state.length > 200) {
    throw new ApiError(400, 'La verificación del inicio de sesión no es válida. Vuelve a intentarlo.');
  }

  const transaction = await prisma.oidcTransaction.findFirst({
    where: { stateHash: sha256(state), expiresAt: { gt: new Date() } },
  });
  if (!transaction) throw new ApiError(400, 'El inicio de sesión ha caducado. Vuelve a intentarlo.');
  await prisma.oidcTransaction.delete({ where: { id: transaction.id } });

  const callbackUrl = new URL(config.OIDC_REDIRECT_URI);
  callbackUrl.search = new URL(request.originalUrl, 'http://localhost').search;
  let claims: ReturnType<NonNullable<Awaited<ReturnType<typeof authorizationCodeGrant>>['claims']>> | undefined;
  try {
    const tokenResponse = await authorizationCodeGrant(await getOidcConfiguration(), callbackUrl, {
      expectedState: state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.pkceVerifier,
      idTokenExpected: true,
    });
    claims = tokenResponse.claims();
  } catch {
    throw new ApiError(401, 'Google no pudo validar el inicio de sesión. Vuelve a intentarlo.');
  }

  const googleSubject = claims?.sub;
  const email = claims?.email;
  const emailVerified = claims?.email_verified;
  if (typeof googleSubject !== 'string' || typeof email !== 'string' || emailVerified !== true) {
    throw new ApiError(401, 'La cuenta de Google no proporcionó una identidad verificada.');
  }

  const user = await prisma.$transaction(async (transactionClient) => {
    const account = await transactionClient.user.upsert({
      where: { googleSubject },
      update: {
        email,
        displayName: typeof claims?.name === 'string' ? claims.name.slice(0, 160) : null,
        avatarUrl: typeof claims?.picture === 'string' ? claims.picture.slice(0, 500) : null,
      },
      create: {
        googleSubject,
        email,
        displayName: typeof claims?.name === 'string' ? claims.name.slice(0, 160) : null,
        avatarUrl: typeof claims?.picture === 'string' ? claims.picture.slice(0, 500) : null,
      },
    });

    let personalMembership = await transactionClient.membership.findFirst({
      where: { userId: account.id, status: 'ACTIVE', space: { type: 'PERSONAL' } },
      include: { space: true },
    });
    if (!personalMembership) {
      const personalSpace = await transactionClient.space.create({
        data: {
          name: 'Personal',
          type: 'PERSONAL',
          createdByUserId: account.id,
          memberships: { create: { userId: account.id, role: 'ADMIN', status: 'ACTIVE' } },
        },
      });
      personalMembership = await transactionClient.membership.findUnique({
        where: { spaceId_userId: { spaceId: personalSpace.id, userId: account.id } },
        include: { space: true },
      });
    }
    if (!personalMembership) throw new Error('No se pudo crear el espacio Personal.');
    if (config.TENANT_DATA_READY) {
      const categoryCount = await transactionClient.category.count({ where: { spaceId: personalMembership.spaceId } });
      if (categoryCount === 0) {
        await transactionClient.category.createMany({
          data: DEFAULT_CATEGORIES.map((category) => ({ ...category, spaceId: personalMembership!.spaceId })),
        });
      }
    }
    return account;
  });

  const rawSessionToken = randomBytes(32).toString('base64url');
  const rawCsrfToken = randomBytes(32).toString('base64url');
  await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: sha256(rawSessionToken),
      csrfTokenHash: sha256(rawCsrfToken),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
  response.cookie(SESSION_COOKIE, rawSessionToken, sessionCookieOptions());
  response.cookie(CSRF_COOKIE, rawCsrfToken, { ...sessionCookieOptions(), httpOnly: false });
  response.redirect(config.FRONTEND_ORIGIN);
}));

authRouter.get('/session', optionalAuthentication, asyncHandler(async (request, response) => {
  if (!request.auth) {
    response.json({ authenticated: false });
    return;
  }
  const csrfToken = readCookie(request, CSRF_COOKIE);
  const validCsrfToken = csrfToken && sha256(csrfToken) === request.auth.csrfTokenHash ? csrfToken : null;
  const memberships = await prisma.membership.findMany({
    where: { userId: request.auth.userId, status: 'ACTIVE' },
    include: { space: true },
    orderBy: [{ space: { type: 'asc' } }, { space: { name: 'asc' } }],
  });
  response.json({
    authenticated: true,
    user: { id: request.auth.userId, email: request.auth.email, displayName: request.auth.displayName },
    spaces: memberships.map(({ space, role }) => ({
      id: space.id,
      name: space.name,
      type: space.type,
      currency: space.currency,
      role,
      archivedAt: space.archivedAt,
    })),
    csrfToken: validCsrfToken,
  });
}));

authRouter.post('/logout', requireAuthentication, requireCsrfForMutations, asyncHandler(async (request, response) => {
  await prisma.userSession.update({ where: { id: request.auth!.sessionId }, data: { revokedAt: new Date() } });
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: '/api' });
  response.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: cookieSecure, sameSite: 'lax', path: '/api' });
  response.status(204).end();
}));
