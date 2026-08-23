import pg from 'pg';
import { env } from '../config/env.js';
import { INITIAL_STATE } from './initial-state.js';
import { storePassword } from '../security/passwords.js';

const { Pool } = pg;
if(!env.databaseUrl) console.warn('[WMS] DATABASE_URL no configurada.');
export const pool = new Pool({connectionString:env.databaseUrl,ssl:env.databaseSsl?{rejectUnauthorized:false}:false});

const ENTITY_TABLES=['companies','sites','sectors','racks','locations','products','product_codes','inventory','pallets','receipts','transfers','shipments','tasks','orders','movements','audit'];

const schemaSql=`
CREATE TABLE IF NOT EXISTS wms_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
  revision BIGINT NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMINISTRADOR','ENCARGADO','OPERADOR_BODEGA','OPERADOR_RECEPCION','TRANSPORTISTA')),
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS sectors (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS racks (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS product_codes (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, product_code TEXT NOT NULL, location_id TEXT NOT NULL, qty NUMERIC NOT NULL DEFAULT 0, pallet_id TEXT, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS pallets (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_code);
CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_pallet ON inventory(pallet_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
ALTER TABLE users ADD COLUMN IF NOT EXISTS site_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_assignments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_access_status_check;
ALTER TABLE users ADD CONSTRAINT users_access_status_check CHECK (access_status IN ('ACTIVE','PAUSED','DISABLED'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO','OPERADOR_BODEGA','OPERADOR_RECEPCION','TRANSPORTISTA'));
`;

function makeUserId(name){
  const base=String(name||'USUARIO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,22)||'USUARIO';
  return `USR-${base}`;
}

async function insertEntity(client,table,item){
  if(table==='products') return client.query('INSERT INTO products(id,code,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,data=EXCLUDED.data',[item.id,item.code,JSON.stringify(item)]);
  if(table==='inventory') return client.query('INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO UPDATE SET product_code=EXCLUDED.product_code,location_id=EXCLUDED.location_id,qty=EXCLUDED.qty,pallet_id=EXCLUDED.pallet_id,data=EXCLUDED.data',[item.id,item.productCode,item.locationId,Number(item.qty||0),item.palletId||null,JSON.stringify(item)]);
  return client.query(`INSERT INTO ${table}(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data`,[item.id,JSON.stringify(item)]);
}

export async function ensureDatabase(){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query("INSERT INTO wms_meta(id,revision,settings,planning) VALUES(1,1,$1::jsonb,$2::jsonb) ON CONFLICT(id) DO NOTHING",[JSON.stringify(INITIAL_STATE.settings||{}),JSON.stringify(INITIAL_STATE.planning||{})]);
    // El administrador principal se crea una sola vez. Si ya existe, el arranque
    // NO modifica username, nombre, contraseña, estado ni ningún otro dato.
    const adminExists=(await client.query("SELECT 1 FROM users WHERE id='USR-ADMIN' LIMIT 1")).rowCount>0;
    if(!adminExists){
      // Mantiene el mismo modo de contraseña configurado para el resto de la
      // aplicación. Evita crear una base nueva con una clave incompatible con
      // el inicio de sesión actual de desarrollo.
      const hash=storePassword(env.adminPassword);
      await client.query(`INSERT INTO users(id,name,username,password_hash,role,active,must_change_password)
        VALUES('USR-ADMIN',$1,$2,$3,'ADMINISTRADOR',true,true)
        ON CONFLICT(id) DO NOTHING`,[env.adminName,env.adminUsername.toLowerCase(),hash]);
    }
    const count=(await client.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    if(count===0){
      for(const table of ENTITY_TABLES){
        for(const item of INITIAL_STATE[table]||[]) await insertEntity(client,table,item);
      }
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function withTransaction(fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function readState(client=pool,currentUser=null){
  // Una sola ida a PostgreSQL para reconstruir el estado completo. Antes se
  // realizaba una consulta por colección, acumulando latencia innecesaria.
  const row=(await client.query(`
    SELECT
      m.revision,
      m.settings,
      m.planning,
      m.created_at,
      m.updated_at,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM companies),'[]'::jsonb) AS companies,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM sites),'[]'::jsonb) AS sites,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM sectors),'[]'::jsonb) AS sectors,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM racks),'[]'::jsonb) AS racks,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM locations),'[]'::jsonb) AS locations,
      COALESCE((SELECT jsonb_agg(data ORDER BY code) FROM products),'[]'::jsonb) AS products,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM product_codes),'[]'::jsonb) AS product_codes,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM inventory),'[]'::jsonb) AS inventory,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM pallets),'[]'::jsonb) AS pallets,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM receipts),'[]'::jsonb) AS receipts,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM transfers),'[]'::jsonb) AS transfers,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM shipments),'[]'::jsonb) AS shipments,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM tasks),'[]'::jsonb) AS tasks,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM orders),'[]'::jsonb) AS orders,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM movements),'[]'::jsonb) AS movements,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM audit),'[]'::jsonb) AS audit,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id',u.id,
            'name',u.name,
            'username',u.username,
            'role',u.role,
            'active',u.active,
            'accessStatus',u.access_status,
            'accessAssignments',u.access_assignments,
            'siteIds',u.site_ids,
            'companyIds',u.company_ids,
            'createdAt',u.created_at
          ) ORDER BY u.name
        ) FROM users u
      ),'[]'::jsonb) AS users
    FROM wms_meta m
    WHERE m.id=1
  `)).rows[0];

  return {
    meta:{version:12,revision:Number(row?.revision||1),updatedAt:row?.updated_at,createdAt:row?.created_at},
    settings:row?.settings||{},
    planning:row?.planning||{},
    session:{userId:currentUser?.id||'USR-ADMIN',activeSiteId:(currentUser?.siteIds||currentUser?.site_ids||[])[0]||'REC',activeCompanyId:(currentUser?.companyIds||currentUser?.company_ids||[])[0]||'SERCO_RIEGO'},
    companies:row?.companies||[],
    sites:row?.sites||[],
    sectors:row?.sectors||[],
    racks:row?.racks||[],
    locations:row?.locations||[],
    products:row?.products||[],
    product_codes:row?.product_codes||[],
    inventory:row?.inventory||[],
    pallets:row?.pallets||[],
    receipts:row?.receipts||[],
    transfers:row?.transfers||[],
    shipments:row?.shipments||[],
    tasks:row?.tasks||[],
    orders:row?.orders||[],
    movements:row?.movements||[],
    audit:row?.audit||[],
    users:row?.users||[]
  };
}

async function replaceTableBulk(client,table,items){
  // Conserva exactamente la semántica anterior (reemplazo completo de la
  // colección), pero inserta toda la colección en una sola consulta SQL.
  await client.query(`DELETE FROM ${table}`);
  if(!items.length)return;

  const payload=JSON.stringify(items);
  if(table==='products'){
    await client.query(`
      INSERT INTO products(id,code,data)
      SELECT x->>'id',x->>'code',x
      FROM jsonb_array_elements($1::jsonb) AS x
    `,[payload]);
    return;
  }
  if(table==='inventory'){
    await client.query(`
      INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data)
      SELECT
        x->>'id',
        x->>'productCode',
        x->>'locationId',
        COALESCE(NULLIF(x->>'qty',''),'0')::numeric,
        NULLIF(x->>'palletId',''),
        x
      FROM jsonb_array_elements($1::jsonb) AS x
    `,[payload]);
    return;
  }
  await client.query(`
    INSERT INTO ${table}(id,data)
    SELECT x->>'id',x
    FROM jsonb_array_elements($1::jsonb) AS x
  `,[payload]);
}

export async function replaceState(client,state,expectedRevision,currentUser,compact=false){
  const locked=(await client.query('SELECT revision FROM wms_meta WHERE id=1 FOR UPDATE')).rows[0];
  const actual=Number(locked?.revision||1);
  if(expectedRevision!=null && Number(expectedRevision)!==actual){const e=new Error('El inventario cambió en otro equipo. Recarga antes de guardar.');e.status=409;e.code='REVISION_CONFLICT';throw e;}
  for(const table of ENTITY_TABLES){
    // Compatibilidad durante despliegues: un frontend anterior que aún no conozca
    // una colección nueva no puede vaciarla accidentalmente.
    if(!Array.isArray(state[table])) continue;
    await replaceTableBulk(client,table,state[table]);
  }
  const next=actual+1;
  const updated=(await client.query('UPDATE wms_meta SET revision=$1,settings=$2::jsonb,planning=$3::jsonb,updated_at=now() WHERE id=1 RETURNING updated_at',[next,JSON.stringify(state.settings||{}),JSON.stringify(state.planning||{})])).rows[0];
  if(compact)return {compact:true,meta:{version:15,revision:next,updatedAt:updated?.updated_at}};
  return readState(client,currentUser);
}

export { ENTITY_TABLES, makeUserId };
