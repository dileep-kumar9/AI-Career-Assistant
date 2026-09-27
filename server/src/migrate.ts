/** Applies pending database migrations and exits (`npm run db:migrate`). */
import { loadConfig } from './config.js';
import { createStore } from './db/store.js';

const config = loadConfig();
const store = await createStore(config.databaseUrl);
await store.migrate();
await store.close();
console.log(`Migrations applied (${store.kind}).`);
