import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/database.js';

const APPLY=process.argv.includes('--apply');
const ONCE=process.argv.includes('--once');
const IMPORT_KEY='realInventory20260821';
const COMPANY_ID='SERCO_RIEGO';
if(!APPLY){
  console.error('Importación protegida. Ejecuta con --apply para cargar los datos reales.');
  process.exit(2);
}

const here=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(here,'..','data','real-inventory-2026-08-21.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const client=await pool.connect();
let skipImport=false;
try{
  await client.query('BEGIN');

  if(ONCE){
    const metaLock=(await client.query('SELECT settings FROM wms_meta WHERE id=1 FOR UPDATE')).rows[0];
    const previous=metaLock?.settings?.imports?.[IMPORT_KEY];
    if(previous?.completed){
      await client.query('COMMIT');
      console.log(JSON.stringify({ok:true,skipped:true,reason:'Importación real ya ejecutada',importKey:IMPORT_KEY,completedAt:previous.completedAt||null},null,2));
      skipImport=true;
    }
  }

  if(!skipImport){
  const site={...data.siteToEnsure,companyId:COMPANY_ID};
  await client.query('INSERT INTO sites(id,data,company_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data',[site.id,JSON.stringify(site),COMPANY_ID]);

  const existing=(await client.query('SELECT id,code,data FROM products WHERE company_id=$1',[COMPANY_ID])).rows;
  const byCode=new Map(existing.map(r=>[String(r.code),r]));
  const importedIdByCode=new Map();
  for(const p of data.products){
    const old=byCode.get(String(p.code));
    const id=old?.id||p.id;
    const merged={...(old?.data||{}),...p,id,code:String(p.code),companyId:COMPANY_ID};
    await client.query('INSERT INTO products(id,code,data,company_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(company_id,id) DO UPDATE SET code=EXCLUDED.code,data=EXCLUDED.data',[id,String(p.code),JSON.stringify(merged),COMPANY_ID]);
    importedIdByCode.set(String(p.code),id);
  }

  const codeToProduct=new Map(data.products.map(p=>[String(p.id),String(p.code)]));
  for(const c of data.product_codes){
    const sku=codeToProduct.get(String(c.productId));
    const productId=importedIdByCode.get(sku);
    if(!productId)continue;
    const alias={...c,productId,companyId:COMPANY_ID};
    const collision=(await client.query(`SELECT 1 FROM products WHERE company_id=$2 AND code=$1 UNION ALL SELECT 1 FROM product_codes WHERE company_id=$2 AND data->>'code'=$1 LIMIT 1`,[String(alias.code),COMPANY_ID])).rowCount>0;
    if(collision)continue;
    await client.query('INSERT INTO product_codes(id,data,company_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data',[alias.id,JSON.stringify(alias),COMPANY_ID]);
  }

  // Reemplaza únicamente el stock físico operativo; conserva historial, órdenes y auditoría.
  await client.query('DELETE FROM inventory WHERE company_id=$1',[COMPANY_ID]);
  await client.query(`DELETE FROM pallets WHERE company_id=$1 AND (data->>'origin' LIKE 'Inventario físico%' OR data->>'origin' LIKE 'Inventario físico PRODUCTOS.xlsx%')`,[COMPANY_ID]);
  await client.query(`DELETE FROM locations WHERE company_id=$1 AND id LIKE 'PAL-%'`,[COMPANY_ID]);

  for(const loc of data.legacy_locations){
    const scoped={...loc,companyId:COMPANY_ID};await client.query('INSERT INTO locations(id,data,company_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data',[scoped.id,JSON.stringify(scoped),COMPANY_ID]);
  }
  for(const p of data.pallets){
    const scoped={...p,companyId:COMPANY_ID};await client.query('INSERT INTO pallets(id,data,company_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data',[scoped.id,JSON.stringify(scoped),COMPANY_ID]);
  }
  const invPayload=JSON.stringify(data.inventory.map(x=>({...x,companyId:COMPANY_ID})));
  await client.query(`
    INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data,company_id)
    SELECT x->>'id',x->>'productCode',x->>'locationId',COALESCE(NULLIF(x->>'qty',''),'0')::numeric,NULLIF(x->>'palletId',''),x,$2
    FROM jsonb_array_elements($1::jsonb) AS x
  `,[invPayload,COMPANY_ID]);

  const meta=(await client.query('SELECT settings,revision FROM wms_meta WHERE id=1 FOR UPDATE')).rows[0];
  const settings=meta?.settings||{};
  settings.erpStockBySite={...(settings.erpStockBySite||{}),...data.erpStockBySite};
  settings.erpStockUpdatedAt={...(settings.erpStockUpdatedAt||{}),REC:data.generatedAt,VIT:data.generatedAt};
  if(ONCE){
    settings.imports={...(settings.imports||{}),[IMPORT_KEY]:{
      completed:true,
      completedAt:new Date().toISOString(),
      products:data.products.length,
      aliases:data.product_codes.length,
      inventoryRows:data.inventory.length,
      pallets:data.pallets.length
    }};
  }
  await client.query('UPDATE wms_meta SET settings=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1',[JSON.stringify(settings)]);
  await client.query('INSERT INTO wms_company_meta(company_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(company_id) DO UPDATE SET settings=EXCLUDED.settings,revision=wms_company_meta.revision+1,updated_at=now()',[COMPANY_ID,JSON.stringify(settings)]);

  await client.query('COMMIT');
  console.log(JSON.stringify({ok:true,products:data.products.length,aliases:data.product_codes.length,inventoryRows:data.inventory.length,pallets:data.pallets.length,kameRecoleta:Object.keys(data.erpStockBySite.REC||{}).length,kameVitacura:Object.keys(data.erpStockBySite.VIT||{}).length},null,2));
  }
}catch(err){
  await client.query('ROLLBACK');
  console.error(err);
  process.exitCode=1;
}finally{
  client.release();
  await pool.end();
}
