import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_CATEGORIES } from '../src/lib/default-categories.js';

const prisma = new PrismaClient();

async function main() {
  const personalSpaces = await prisma.space.findMany({ where: { type: 'PERSONAL' }, select: { id: true } });
  for (const space of personalSpaces) {
    for (const category of DEFAULT_CATEGORIES) {
      await prisma.category.upsert({
        where: { spaceId_name_type: { spaceId: space.id, name: category.name, type: category.type } },
        update: {},
        create: { ...category, spaceId: space.id },
      });
    }
  }
  console.log(`Categorías iniciales sincronizadas en ${personalSpaces.length} espacios Personal.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
