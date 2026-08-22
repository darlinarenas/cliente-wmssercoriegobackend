import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/database.js';

const APPLY=process.argv.includes('--apply');
const ONCE=process.argv.includes('--once');
const IMPORT_KEY='realInventory20260821';
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
  const site=data.siteToEnsure;
  await client.query('INSERT INTO sites(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[site.id,JSON.stringify(site)]);

  const existing=(await client.query('SELECT id,code,data FROM products')).rows;
  const byCode=new Map(existing.map(r=>[String(r.code),r]));
  const importedIdByCode=new Map();
  for(const p of data.products){
    const old=byCode.get(String(p.code));
    const id=old?.id||p.id;
    const merged={...(old?.data||{}),...p,id,code:String(p.code)};
    await client.query('INSERT INTO products(id,code,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,data=EXCLUDED.data',[id,String(p.code),JSON.stringify(merged)]);
    importedIdByCode.set(String(p.code),id);
  }

  const codeToProduct=new Map(data.products.map(p=>[String(p.id),String(p.code)]));
  for(const c of data.product_codes){
    const sku=codeToProduct.get(String(c.productId));
    const productId=importedIdByCode.get(sku);
    if(!productId)continue;
    const alias={...c,productId};
    const collision=(await client.query(`SELECT 1 FROM products WHERE code=$1 UNION ALL SELECT 1 FROM product_codes WHERE data->>'code'=$1 LIMIT 1`,[String(alias.code)])).rowCount>0;
    if(collision)continue;
    await client.query('INSERT INTO product_codes(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[alias.id,JSON.stringify(alias)]);
  }

  // Reemplaza únicamente el stock físico operativo; conserva historial, órdenes y auditoría.
  await client.query('DELETE FROM inventory');
  await client.query(`DELETE FROM pallets WHERE data->>'origin' LIKE 'Inventario físico%' OR data->>'origin' LIKE 'Inventario físico PRODUCTOS.xlsx%'`);
  await client.query(`DELETE FROM locations WHERE id LIKE 'PAL-%'`);

  for(const loc of data.legacy_locations){
    await client.query('INSERT INTO locations(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[loc.id,JSON.stringify(loc)]);
  }
  for(const p of data.pallets){
    await client.query('INSERT INTO pallets(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[p.id,JSON.stringify(p)]);
  }
  const invPayload=JSON.stringify(data.inventory);
  await client.query(`
    INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data)
    SELECT x->>'id',x->>'productCode',x->>'locationId',COALESCE(NULLIF(x->>'qty',''),'0')::numeric,NULLIF(x->>'palletId',''),x
    FROM jsonb_array_elements($1::jsonb) AS x
  `,[invPayload]);

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
