import assert from 'node:assert/strict';
import { INITIAL_STATE } from '../src/db/initial-state.js';
import { upgradeState } from '../../src/services/state-upgrade.js';

global.window={SERCO_WMS_API_BASE_URL:'/api'};
global.localStorage={_m:new Map(),getItem(k){return this._m.get(k)||null;},setItem(k,v){this._m.set(k,String(v));},removeItem(k){this._m.delete(k);}};

assert.ok(Array.isArray(INITIAL_STATE.companies),'companies debe ser arreglo');
assert.ok(INITIAL_STATE.companies.some(c=>c.id==='SERCO_RIEGO'),'Serco Riego debe existir como empresa inicial');
assert.ok(Array.isArray(INITIAL_STATE.sites),'sites debe ser arreglo');
assert.ok(INITIAL_STATE.sites.some(s=>s.id==='REC'&&s.companyId==='SERCO_RIEGO'),'Recoleta debe pertenecer a Serco Riego');
assert.ok(Array.isArray(INITIAL_STATE.products),'products debe ser arreglo');
assert.ok(Array.isArray(INITIAL_STATE.product_codes),'product_codes debe existir');
assert.ok(Array.isArray(INITIAL_STATE.orders),'orders debe existir');

const legacy={meta:{version:13},settings:{},session:{userId:'U',activeSiteId:'REC'},sites:[{id:'REC',name:'Recoleta',parentSiteId:null},{id:'VIT',name:'Vitacura',parentSiteId:'REC'}],users:[{id:'U',role:'ENCARGADO',siteIds:['REC']}],product_codes:[],orders:[],racks:[],locations:[],inventory:[],pallets:[]};
assert.equal(upgradeState(legacy),true,'la migración V15 debe detectar cambios');
assert.equal(legacy.companies[0].id,'SERCO_RIEGO');
assert.equal(legacy.sites[1].companyId,'SERCO_RIEGO');
assert.equal('parentSiteId' in legacy.sites[1],false,'dependencia debe desaparecer');
assert.deepEqual(legacy.users[0].companyIds,['SERCO_RIEGO']);
assert.equal(legacy.meta.version,15);

const { stockBySite,stockStatus,reservedBySite }=await import('../../src/services/stock.js');
const sample={companies:[{id:'A',active:true},{id:'B',active:true}],sites:[{id:'REC',companyId:'A',active:true},{id:'VIT',companyId:'A',active:true},{id:'MKP',companyId:'B',active:true}],locations:[{id:'L1',siteId:'REC'},{id:'L2',siteId:'VIT'},{id:'L3',siteId:'MKP'}],pallets:[],inventory:[{id:'I1',productCode:'P1',locationId:'L1',qty:18},{id:'I2',productCode:'P1',locationId:'L2',qty:2},{id:'I3',productCode:'P1',locationId:'L3',qty:99}],orders:[{id:'O1',sourceSiteId:'REC',status:'ACEPTADA',items:[{productCode:'P1',qty:5}]}],users:[],session:{}};
assert.deepEqual(stockBySite('P1',sample),{REC:18,VIT:2,MKP:99});
assert.equal(reservedBySite('P1',sample).REC,5);
assert.deepEqual(stockStatus('P1','REC',sample),{physical:18,reserved:5,available:13});
assert.deepEqual(stockStatus('P1','REC',sample,'O1'),{physical:18,reserved:0,available:18});

const legacyPhysical={meta:{version:14},settings:{},session:{userId:'U',activeSiteId:'REC'},companies:[{id:'SERCO_RIEGO',active:true}],sites:[{id:'REC',companyId:'SERCO_RIEGO',active:true},{id:'VIT',companyId:'SERCO_RIEGO',active:true}],users:[{id:'U',role:'ADMINISTRADOR',siteIds:[],companyIds:[]}],racks:[{id:'R1',siteId:'REC',levels:1,modules:1}],locations:[{id:'REC-R1-M1-N1',siteId:'REC',rackId:'R1',active:true}],pallets:[{id:'PAL-1',locationId:'REC-R1-M1-N1'}],inventory:[{id:'I1',productCode:'P1',locationId:'REC-R1-M1-N1',palletId:'PAL-1',qty:10}],receipts:[{id:'REC-1',palletId:'PAL-1',status:'CERRADA'}],movements:[],transfers:[],orders:[],product_codes:[]};
upgradeState(legacyPhysical);
assert.equal(legacyPhysical.pallets[0].siteId,'REC','los pallets legados deben quedar en Recoleta');
assert.equal(legacyPhysical.inventory[0].siteId,'REC','el inventario legado debe quedar en Recoleta');
assert.equal(legacyPhysical.receipts[0].siteId,'REC','las recepciones legadas deben quedar en Recoleta');
assert.equal(legacyPhysical.racks.some(r=>r.siteId==='VIT'),false,'Vitacura no debe heredar racks de Recoleta');

const { deductStock,availableFrom }=await import('../../src/services/inventory-ops.js');
const isolated={locations:[{id:'REC-L1',siteId:'REC'},{id:'VIT-L1',siteId:'VIT'}],pallets:[],inventory:[{id:'IR',siteId:'REC',productCode:'P',locationId:'REC-L1',qty:5},{id:'IV',siteId:'VIT',productCode:'P',locationId:'VIT-L1',qty:9}]};
assert.equal(availableFrom(isolated,'P','AUTO','REC'),5);
assert.equal(availableFrom(isolated,'P','AUTO','VIT'),9);
const take=deductStock(isolated,{code:'P',qty:4,sourceKey:'AUTO',siteId:'REC'});
assert.equal(take.ok,true);
assert.equal(isolated.inventory.find(i=>i.id==='IR').qty,1);
assert.equal(isolated.inventory.find(i=>i.id==='IV').qty,9,'un despacho de Recoleta no puede descontar Vitacura');

console.log('OK · estructura V15 multiempresa, aislamiento por centro, migración y stock reservado válidos');
