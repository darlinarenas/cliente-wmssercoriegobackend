import assert from 'node:assert/strict';

const { replaceState }=await import('../src/db/database.js');
const sql=[];
const client={query:async(query)=>{sql.push(String(query).replace(/\s+/g,' ').trim());if(String(query).includes('SELECT revision'))return {rows:[{revision:7}]};if(String(query).includes('RETURNING updated_at'))return {rows:[{updated_at:new Date().toISOString()}]};return {rows:[]};}};
await replaceState(client,{meta:{revision:7},settings:{},planning:{},inventory:[{id:'I1',productCode:'P1',locationId:'L1',qty:3}]},7,{id:'U'},true);
assert.ok(sql.some(q=>q==='DELETE FROM inventory'),'el backend debe actualizar inventario recibido');
assert.equal(sql.some(q=>q==='DELETE FROM products'),false,'el backend debe conservar tablas ausentes');
console.log('OK · el backend reemplaza solo las colecciones recibidas');
