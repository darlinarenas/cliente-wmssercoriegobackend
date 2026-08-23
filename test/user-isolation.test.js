import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertTargetIdentity,protectPrimaryAdmin } from '../src/modules/usuarios/users.routes.js';

assert.doesNotThrow(()=>assertTargetIdentity('USR-DARLIN-ARENAS','USR-DARLIN-ARENAS'));
assert.throws(()=>assertTargetIdentity('USR-DARLIN-ARENAS','USR-ADMIN'),e=>e.status===409);

const globalAdmin={role:'ADMIN_GLOBAL',accessStatus:'ACTIVE',siteIds:[],accessAssignments:[]};
assert.doesNotThrow(()=>protectPrimaryAdmin('USR-ADMIN',globalAdmin));
assert.throws(()=>protectPrimaryAdmin('USR-ADMIN',{...globalAdmin,role:'OPERADOR_BODEGA'}),e=>e.status===400);
assert.doesNotThrow(()=>protectPrimaryAdmin('USR-DARLIN-ARENAS',{...globalAdmin,role:'OPERADOR_BODEGA'}));

const routeSource=fs.readFileSync(new URL('../src/modules/usuarios/users.routes.js',import.meta.url),'utf8');
assert.match(routeSource,/WHERE id=\$9 RETURNING/,'la actualización debe quedar limitada por la llave primaria');
const dbSource=fs.readFileSync(new URL('../src/db/database.js',import.meta.url),'utf8');
assert.match(dbSource,/WHERE id='USR-ADMIN' AND/,'el arranque debe reparar únicamente al administrador principal');

console.log('OK · edición aislada por ID y administrador principal protegido');
