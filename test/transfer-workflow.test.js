import assert from 'node:assert/strict';
import { acceptShipmentCustody,createShipment,markShipmentArrival,receiveShipment,palletPendingQty } from '../../src/services/transfer-workflow.js';
import { code128Svg } from '../../src/services/barcode.js';

const data={session:{userId:'ADMIN'},shipments:[],tasks:[],transfers:[],locations:[],inventory:[],pallets:[],movements:[],users:[{id:'ADMIN',name:'Administrador'}]};
const transfer={id:'TRF-TEST-1',sourceSiteId:'REC',destinationSiteId:'VIT',status:'PREPARANDO',driver:'',items:[{code:'A1',qty:5},{code:'B2',qty:3}]};data.transfers.push(transfer);
const shipment=createShipment(data,transfer,{driverName:'Conductor Uno',userId:'ADMIN',at:'2026-08-23T10:00:00.000Z'});
const barcode=code128Svg(shipment.code);assert.match(barcode,/class="shipment-barcode"/);assert.match(barcode,/rect x=/);assert.ok(!barcode.includes('undefined'));
assert.equal(transfer.status,'LISTO_RETIRO');assert.equal(shipment.status,'LISTA_RETIRO');assert.equal(data.shipments.length,1);assert.equal(createShipment(data,transfer).id,shipment.id);
acceptShipmentCustody(data,shipment,{userId:'DRIVER',at:'2026-08-23T11:00:00.000Z'});assert.equal(shipment.status,'EN_TRANSITO');assert.equal(transfer.status,'EN_TRANSITO');assert.throws(()=>acceptShipmentCustody(data,shipment),/ya fue retirada/);
markShipmentArrival(data,shipment,{userId:'DRIVER',at:'2026-08-23T12:00:00.000Z'});assert.equal(shipment.status,'LLEGADA_DESTINO');
const result=receiveShipment(data,shipment,{receivedItems:[{code:'A1',qty:5},{code:'B2',qty:2}],userId:'RECEIVER',notes:'Falta una unidad B2',at:'2026-08-23T12:10:00.000Z'});
assert.equal(shipment.status,'RECIBIDA_DIFERENCIAS');assert.equal(transfer.status,'RECIBIDA_DIFERENCIAS');assert.equal(result.differences.length,1);assert.equal(data.tasks.length,1);assert.equal(result.task.palletId,shipment.containerId);assert.equal(palletPendingQty(data,shipment.containerId),7);assert.equal(data.inventory.reduce((s,i)=>s+i.qty,0),7);assert.throws(()=>receiveShipment(data,shipment),/no está disponible/);
console.log('OK · carga, custodia, tránsito, recepción con diferencias y tarea POR UBICAR válidos');
