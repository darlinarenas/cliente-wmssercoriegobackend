import { app } from './app.js';
import { env } from './config/env.js';
import { ensureDatabase } from './db/database.js';
await ensureDatabase();
app.listen(env.port,()=>console.log(`SercoRiego WMS API escuchando en puerto ${env.port}`));
