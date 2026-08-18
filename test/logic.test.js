import assert from 'node:assert/strict';
import { INITIAL_STATE } from '../src/db/initial-state.js';

assert.ok(Array.isArray(INITIAL_STATE.sites),'sites debe ser arreglo');
assert.ok(Array.isArray(INITIAL_STATE.products),'products debe ser arreglo');
assert.ok(Array.isArray(INITIAL_STATE.product_codes),'product_codes debe existir');
assert.ok(Array.isArray(INITIAL_STATE.orders),'orders debe existir');
assert.ok(INITIAL_STATE.sites.some(s=>s.id==='REC'),'Recoleta debe existir');
console.log('OK · estructura base V13 válida');
