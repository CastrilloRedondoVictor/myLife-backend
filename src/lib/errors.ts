import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './api-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _next;
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({ error: 'Solicitud no válida', details: error.issues });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      response.status(409).json({ error: 'Ya existe un registro con esos datos.' });
      return;
    }
    if (error.code === 'P2003' || error.code === 'P2025') {
      response.status(404).json({ error: 'No se encontró el recurso relacionado.' });
      return;
    }
  }
  if (error instanceof Error && error.message.startsWith('El mes')) {
    response.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Ha ocurrido un error interno.' });
};
