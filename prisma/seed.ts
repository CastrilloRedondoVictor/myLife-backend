import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { TransactionType, type TransactionType as TransactionTypeValue } from '../src/lib/domain.js';

const prisma = new PrismaClient();

const defaults: Array<{ name: string; type: TransactionTypeValue; color: string; icon: string }> = [
  { name: 'Vivienda', type: TransactionType.EXPENSE, color: '#b48cff', icon: 'house' },
  { name: 'Alimentación', type: TransactionType.EXPENSE, color: '#ffb86b', icon: 'utensils' },
  { name: 'Transporte', type: TransactionType.EXPENSE, color: '#77a9ff', icon: 'car' },
  { name: 'Salud', type: TransactionType.EXPENSE, color: '#ff8292', icon: 'heart' },
  { name: 'Ocio', type: TransactionType.EXPENSE, color: '#ed8bd4', icon: 'sparkles' },
  { name: 'Servicios', type: TransactionType.EXPENSE, color: '#57cdb7', icon: 'bolt' },
  { name: 'Otros gastos', type: TransactionType.EXPENSE, color: '#7c8da6', icon: 'circle' },
  { name: 'Salario', type: TransactionType.INCOME, color: '#57cdb7', icon: 'briefcase' },
  { name: 'Otros ingresos', type: TransactionType.INCOME, color: '#77a9ff', icon: 'coins' },
];

async function main() {
  for (const category of defaults) {
    await prisma.category.upsert({
      where: { name_type: { name: category.name, type: category.type } },
      update: {},
      create: category,
    });
  }
  console.log(`Categorías iniciales disponibles: ${defaults.length}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
