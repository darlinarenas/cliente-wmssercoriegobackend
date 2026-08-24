import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canAccessCompany,requestedCompany,tenantItem } from '../src/security/tenant.js';
import { replaceState } from '../src/db/database.js';

const scoped={id:'U-A',role:'OPERADOR_BODEGA',companyIds:['A'],accessAssignments:[]};
const global={id:'ROOT',role:'ADMIN_GLOBAL',companyIds:[]};
assert.equal(canAccessCompany(scoped,'A'),true);
assert.equal(canAccessCompany(scoped,'B'),false);
assert.equal(canAccessCompany(global,'B'),true);
assert.equal(requestedCompany({headers:{'x-wms-company':'A'}},scoped),'A');
assert.throws(()=>requestedCompany({headers:{'x-wms-company':'B'}},scoped),e=>e.status===403&&e.code==='COMPANY_FORBIDDEN');
assert.deepEqual(tenantItem({id:'P1'},'A'),{id:'P1',companyId:'A'});
assert.throws(()=>tenantItem({id:'P1',companyId:'B'},'A'),e=>e.code==='CROSS_COMPANY_WRITE');

const sql=[];
const client={query:async(q)=>{const text=String(q).replace(/\s+/g,' ').trim();sql.push(text);if(text.includes('SELECT revision'))return {rows:[{revision:4}]};if(text.includes('RETURNING updated_at'))return {rows:[{updated_at:new Date().toISOString()}]};return {rows:[]};}};
await assert.rejects(
  replaceState(client,{meta:{revision:4},inventory:[{id:'I-B',companyId:'B',productCode:'P',locationId:'L',qty:1}]},4,global,true,'A'),
  e=>e.status===403&&e.code==='CROSS_COMPANY_WRITE'
);

const db=fs.readFileSync(new URL('../src/db/database.js',import.meta.url),'utf8');
const entities=fs.readFileSync(new URL('../src/modules/catalogo/entity.routes.js',import.meta.url),'utf8');
assert.match(db,/WHERE company_id=\$1/g,'la reconstrucción del estado debe filtrar por empresa');
assert.match(db,/PRIMARY KEY\(company_id,id\)/,'las entidades deben admitir IDs iguales sin colisionar entre empresas');
assert.match(db,/products_company_code_key ON products\(company_id,code\)/,'un mismo SKU debe poder existir en empresas distintas');
assert.match(entities,/WHERE company_id=\$1 AND id=\$2/g,'las operaciones por ID deben incluir siempre company_id');
assert.doesNotMatch(entities,/DELETE FROM \$\{t\} WHERE id=/,'ninguna eliminación puede ejecutarse solo por ID');

console.log('OK · aislamiento empresarial de lectura, escritura, IDs y SKU validado');
