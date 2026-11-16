import { app } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`MyLife API escuchando en http://${config.HOST}:${config.PORT}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
