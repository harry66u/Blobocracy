import { startServer } from './server';

const port = Number(process.env.PORT ?? 8080);
const virtualPlayers = Number(process.env.VIRTUAL_PLAYERS ?? 0);
const srv = await startServer({ port, virtualPlayers });
console.log(`Blobocracy server on :${srv.port} (${virtualPlayers} virtual players)`);
