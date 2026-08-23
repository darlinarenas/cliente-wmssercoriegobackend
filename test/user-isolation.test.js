import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertTargetIdentity,protectPrimaryAdmin } from '../src/modules/usuarios/users.routes.js';

assert.doesNotThrow(()=>assertTargetIdentity('USR-DARLIN-ARENAS','USR-DARLIN-ARENAS'));
assert.throws(()=>assertTargetIdentity('USR-DARLIN-ARENAS','USR-ADMIN'),e=>e.status===409);
const admin={role:'ADMIN_GLOBAL',accessStatus:'ACTIVE',siteIds:[],accessAssignments:[]};
assert.doesNotThrow(()=>protectPrimaryAdmin('USR-ADMIN',admin));
assert.throws(()=>protectPrimaryAdmin('USR-ADMIN',{...admin,role:'OPERADOR_BODEGA'}),e=>e.status===400);
assert.doesNotThrow(()=>protectPrimaryAdmin('USR-DARLIN-ARENAS',{...admin,role:'OPERADOR_BODEGA'}));
const source=fs.readFileSync(new URL('../src/modules/usuarios/users.routes.js',import.meta.url),'utf8');
assert.match(source,/WHERE id=\$9 RETURNING/);
console.log('OK · edición aislada por ID y administrador principal protegido');
