import { ensureDatabase, pool } from './database.js';
try{await ensureDatabase();console.log('PostgreSQL preparado correctamente.');}finally{await pool.end();}
