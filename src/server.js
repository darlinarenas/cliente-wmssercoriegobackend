import { app } from './app.js';
import { env } from './config/env.js';
import { ensureDatabase } from './db/database.js';
await ensureDatabase();
// La importación histórica de inventario es una herramienta administrativa y
// nunca debe ejecutarse durante cada arranque. Si ese proceso auxiliar falla,
// no puede impedir que la API, el login y /health queden disponibles.
app.listen(env.port,()=>console.log(`SercoRiego WMS API escuchando en puerto ${env.port}`));
