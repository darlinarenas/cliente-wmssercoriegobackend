import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelPendingShipment} from '../../src/services/transfer-workflow.js';
test('anula carga pendiente sin alterar stock ni historial',()=>{
 const shipment={id:'CG1',transferId:'TRF1',status:'EN_TRANSITO',events:[],destinationSiteId:'VIT'};
 const transfer={id:'TRF1',status:'EN_TRANSITO',stockDeductedAt:'2026-01-01'};
 const d={shipments:[shipment],transfers:[transfer],inventory:[{id:'I1',qty:7}],movements:[],tasks:[],session:{userId:'A'}};
 assert.throws(()=>cancelPendingShipment(d,shipment,{reason:'corto'}),/motivo/);
 cancelPendingShipment(d,shipment,{reason:'Prueba de Vitacura'});
 assert.equal(shipment.status,'ANULADA');assert.equal(transfer.status,'ANULADA');assert.equal(d.inventory[0].qty,7);
 assert.equal(shipment.requiresStockReconciliation,true);
 assert.throws(()=>cancelPendingShipment(d,shipment,{reason:'Prueba de Vitacura'}),/pendientes/);
});
test('no anula carga recibida',()=>{
 const s={id:'CG2',transferId:'TRF2',status:'RECIBIDA'};
 assert.throws(()=>cancelPendingShipment({transfers:[],tasks:[]},s,{reason:'Prueba de Vitacura'}),/pendientes/);
});
