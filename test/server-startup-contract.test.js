import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
const importer=fs.readFileSync(new URL('../scripts/import-real-inventory.js',import.meta.url),'utf8');
assert.doesNotMatch(server,/spawnSync/,'el servidor no debe ejecutar importadores durante el arranque');
assert.doesNotMatch(server,/import-real-inventory/,'el importador histórico debe ser manual');
assert.match(server,/await ensureDatabase\(\)/,'el esquema debe prepararse antes de escuchar');
assert.match(server,/app\.listen/,'la API debe abrir el puerto después de preparar PostgreSQL');
assert.match(importer,/COMPANY_ID='SERCO_RIEGO'/,'la importación manual debe declarar su empresa');
assert.match(importer,/ON CONFLICT\(company_id,id\)/,'la importación manual debe respetar las claves multiempresa');
assert.match(importer,/DELETE FROM inventory WHERE company_id=\$1/,'la importación manual no puede borrar inventario de otras empresas');

console.log('OK · el importador auxiliar ya no puede tumbar el servidor ni el login');
