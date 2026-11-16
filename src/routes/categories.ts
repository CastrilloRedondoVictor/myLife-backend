import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/async-handler.js';
import { ApiError } from '../lib/api-error.js';
import { transactionTypes } from '../lib/domain.js';

export const categoriesRouter = Router();
const categorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  type: z.enum(transactionTypes),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).default('#7c8da6'),
  icon: z.string().trim().min(1).max(30).default('circle'),
});
const categoryUpdateSchema = categorySchema.omit({ type: true }).partial().refine((value) => Object.keys(value).length > 0, {
  message: 'Indica al menos un campo para actualizar.',
});

categoriesRouter.get('/', asyncHandler(async (_request, response) => {
  const categories = await prisma.category.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  response.json(categories);
}));

categoriesRouter.post('/', asyncHandler(async (request, response) => {
  const input = categorySchema.parse(request.body);
  const category = await prisma.category.create({ data: input });
  response.status(201).json(category);
}));

categoriesRouter.patch('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const input = categoryUpdateSchema.parse(request.body);
  const category = await prisma.category.update({ where: { id }, data: input });
  response.json(category);
}));

categoriesRouter.delete('/:id', asyncHandler(async (request, response) => {
  const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { transactions: true, recurringRules: true, budgets: true } } },
  });
  if (!category) throw new ApiError(404, 'No se encontró la categoría.');
  const linkedRecords = category._count.transactions + category._count.recurringRules + category._count.budgets;
  if (linkedRecords > 0) {
    throw new ApiError(409, 'No se puede eliminar: la categoría tiene movimientos, reglas recurrentes o presupuestos asociados.');
  }
  await prisma.category.delete({ where: { id } });
  response.status(204).end();
}));
