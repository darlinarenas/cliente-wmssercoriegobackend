import pg from 'pg';
import { env } from '../config/env.js';
import { INITIAL_STATE } from './initial-state.js';
import { storePassword } from '../security/passwords.js';
import { DEFAULT_COMPANY_ID, tenantItem, userCompanyIds } from '../security/tenant.js';

const { Pool } = pg;
if(!env.databaseUrl) console.warn('[WMS] DATABASE_URL no configurada.');
export const pool = new Pool({connectionString:env.databaseUrl,ssl:env.databaseSsl?{rejectUnauthorized:false}:false});

const ENTITY_TABLES=['companies','sites','sectors','racks','locations','products','product_codes','inventory','pallets','receipts','transfers','shipments','tasks','orders','movements','audit'];
const TENANT_TABLES=ENTITY_TABLES.filter(t=>t!=='companies');

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
CREATE TABLE IF NOT EXISTS wms_company_meta (
  company_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
UPDATE users u SET company_ids=COALESCE((SELECT jsonb_agg(DISTINCT a->>'companyId') FROM jsonb_array_elements(u.access_assignments) a WHERE NULLIF(a->>'companyId','') IS NOT NULL),'[]'::jsonb) WHERE u.role<>'ADMIN_GLOBAL' AND jsonb_array_length(u.company_ids)=0;
UPDATE users SET company_ids=jsonb_build_array('SERCO_RIEGO') WHERE role<>'ADMIN_GLOBAL' AND jsonb_array_length(company_ids)=0;
UPDATE users u SET company_ids=jsonb_build_array(u.company_ids->0),access_assignments=COALESCE((SELECT jsonb_agg(a) FROM jsonb_array_elements(u.access_assignments) a WHERE a->>'companyId'=u.company_ids->>0),'[]'::jsonb) WHERE u.role<>'ADMIN_GLOBAL' AND jsonb_array_length(u.company_ids)>1;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_single_company_check;
ALTER TABLE users ADD CONSTRAINT users_single_company_check CHECK (role='ADMIN_GLOBAL' OR jsonb_array_length(company_ids)=1);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE sectors ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE racks ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE product_codes ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE movements ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
ALTER TABLE audit ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT 'SERCO_RIEGO';
UPDATE sites SET company_id=COALESCE(NULLIF(data->>'companyId',''),'SERCO_RIEGO');
UPDATE sectors x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE racks x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE locations x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE pallets x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE receipts x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE transfers x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'sourceSiteId';
UPDATE orders x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'sourceSiteId';
UPDATE movements x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),s.company_id,'SERCO_RIEGO') FROM sites s WHERE s.id=x.data->>'siteId';
UPDATE inventory x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),l.company_id,x.company_id) FROM locations l WHERE l.id=x.location_id;
UPDATE product_codes x SET company_id=COALESCE(NULLIF(x.data->>'companyId',''),p.company_id,x.company_id) FROM products p WHERE p.id=x.data->>'productId' AND (x.data->>'companyId' IS NULL OR p.company_id=x.data->>'companyId');
UPDATE sites SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE sectors SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE racks SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE locations SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE products SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE product_codes SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE inventory SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE pallets SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE receipts SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE transfers SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE shipments SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE tasks SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE orders SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE movements SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
UPDATE audit SET data=jsonb_set(data,'{companyId}',to_jsonb(company_id),true);
INSERT INTO wms_company_meta(company_id,revision,settings,planning)
SELECT c.id,COALESCE(m.revision,1),COALESCE(m.settings,'{}'::jsonb),COALESCE(m.planning,'{}'::jsonb)
FROM companies c CROSS JOIN wms_meta m ON m.id=1 ON CONFLICT(company_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_sites_company ON sites(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_company_product ON inventory(company_id,product_code);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_ids ON users USING GIN(company_ids);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_company_code_key ON products(company_id,code);
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','sectors','racks','locations','products','product_codes','inventory','pallets','receipts','transfers','shipments','tasks','orders','movements','audit'] LOOP
    IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=t::regclass AND contype='p' AND pg_get_constraintdef(oid) NOT ILIKE '%company_id%') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I_pkey',t,t);
      EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY(company_id,id)',t);
    END IF;
  END LOOP;
END $$;
`;

function makeUserId(name){
  const base=String(name||'USUARIO').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,22)||'USUARIO';
  return `USR-${base}`;
}

async function insertEntity(client,table,item,companyId=DEFAULT_COMPANY_ID){
  if(table==='companies')return client.query('INSERT INTO companies(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[item.id,JSON.stringify(item)]);
  const scoped=tenantItem(item,companyId);
  if(table==='products') return client.query('INSERT INTO products(id,code,data,company_id) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(company_id,id) DO UPDATE SET code=EXCLUDED.code,data=EXCLUDED.data',[scoped.id,scoped.code,JSON.stringify(scoped),companyId]);
  if(table==='inventory') return client.query('INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data,company_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(company_id,id) DO UPDATE SET product_code=EXCLUDED.product_code,location_id=EXCLUDED.location_id,qty=EXCLUDED.qty,pallet_id=EXCLUDED.pallet_id,data=EXCLUDED.data',[scoped.id,scoped.productCode,scoped.locationId,Number(scoped.qty||0),scoped.palletId||null,JSON.stringify(scoped),companyId]);
  return client.query(`INSERT INTO ${table}(id,data,company_id) VALUES($1,$2::jsonb,$3) ON CONFLICT(company_id,id) DO UPDATE SET data=EXCLUDED.data`,[scoped.id,JSON.stringify(scoped),companyId]);
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
    // Invariante de seguridad: USR-ADMIN siempre conserva acceso general.
    // No modifica nombre, usuario, contraseña ni ningún otro usuario.
    await client.query(`UPDATE users
      SET role='ADMIN_GLOBAL',active=true,access_status='ACTIVE',access_assignments='[]'::jsonb,site_ids='[]'::jsonb,company_ids='[]'::jsonb,updated_at=now()
      WHERE id='USR-ADMIN' AND (role<>'ADMIN_GLOBAL' OR active IS NOT TRUE OR access_status<>'ACTIVE' OR access_assignments<>'[]'::jsonb OR site_ids<>'[]'::jsonb OR company_ids<>'[]'::jsonb)`);
    const count=(await client.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
    if(count===0){
      for(const table of ENTITY_TABLES){
        for(const item of INITIAL_STATE[table]||[]) await insertEntity(client,table,item,DEFAULT_COMPANY_ID);
      }
    }
    await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function withTransaction(fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function readState(client=pool,currentUser=null,companyId=DEFAULT_COMPANY_ID){
  await client.query("INSERT INTO wms_company_meta(company_id) VALUES($1) ON CONFLICT(company_id) DO NOTHING",[companyId]);
  const allowedCompanies=currentUser?.role==='ADMIN_GLOBAL'?null:userCompanyIds(currentUser);
  // Una sola ida a PostgreSQL para reconstruir el estado completo. Antes se
  // realizaba una consulta por colección, acumulando latencia innecesaria.
  const row=(await client.query(`
    SELECT
      m.revision,
      m.settings,
      m.planning,
      m.created_at,
      m.updated_at,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM companies WHERE $3::text[] IS NULL OR id=ANY($3::text[])),'[]'::jsonb) AS companies,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM sites WHERE company_id=$1),'[]'::jsonb) AS sites,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM sectors WHERE company_id=$1),'[]'::jsonb) AS sectors,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM racks WHERE company_id=$1),'[]'::jsonb) AS racks,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM locations WHERE company_id=$1),'[]'::jsonb) AS locations,
      COALESCE((SELECT jsonb_agg(data ORDER BY code) FROM products WHERE company_id=$1),'[]'::jsonb) AS products,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM product_codes WHERE company_id=$1),'[]'::jsonb) AS product_codes,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM inventory WHERE company_id=$1),'[]'::jsonb) AS inventory,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM pallets WHERE company_id=$1),'[]'::jsonb) AS pallets,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM receipts WHERE company_id=$1),'[]'::jsonb) AS receipts,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM transfers WHERE company_id=$1),'[]'::jsonb) AS transfers,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM shipments WHERE company_id=$1),'[]'::jsonb) AS shipments,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM tasks WHERE company_id=$1),'[]'::jsonb) AS tasks,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM orders WHERE company_id=$1),'[]'::jsonb) AS orders,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM movements WHERE company_id=$1),'[]'::jsonb) AS movements,
      COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM audit WHERE company_id=$1),'[]'::jsonb) AS audit,
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
        ) FROM users u WHERE u.id=$2 OR u.role='ADMIN_GLOBAL' OR u.company_ids ? $1
      ),'[]'::jsonb) AS users
    FROM wms_company_meta m
    WHERE m.company_id=$1
  `,[companyId,currentUser?.id||'USR-ADMIN',allowedCompanies])).rows[0];

  return {
    meta:{version:12,revision:Number(row?.revision||1),updatedAt:row?.updated_at,createdAt:row?.created_at},
    settings:row?.settings||{},
    planning:row?.planning||{},
    session:{userId:currentUser?.id||'USR-ADMIN',activeSiteId:(currentUser?.siteIds||currentUser?.site_ids||[]).find(id=>(row?.sites||[]).some(s=>s.id===id))||(row?.sites||[])[0]?.id||'',activeCompanyId:companyId},
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

async function replaceTableBulk(client,table,items,companyId,currentUser){
  // Conserva exactamente la semántica anterior (reemplazo completo de la
  // colección), pero inserta toda la colección en una sola consulta SQL.
  if(table==='companies'){
    if(currentUser?.role!=='ADMIN_GLOBAL')throw Object.assign(new Error('Solo el administrador general puede modificar empresas.'),{status:403});
    await client.query('DELETE FROM companies');
    if(items.length)await client.query(`INSERT INTO companies(id,data) SELECT x->>'id',x FROM jsonb_array_elements($1::jsonb) x`,[JSON.stringify(items)]);
    for(const c of items)await client.query('INSERT INTO wms_company_meta(company_id) VALUES($1) ON CONFLICT(company_id) DO NOTHING',[c.id]);
    return;
  }
  const scoped=items.map(item=>tenantItem(item,companyId));
  await client.query(`DELETE FROM ${table} WHERE company_id=$1`,[companyId]);
  if(!items.length)return;

  const payload=JSON.stringify(scoped);
  if(table==='products'){
    await client.query(`
      INSERT INTO products(id,code,data,company_id)
      SELECT x->>'id',x->>'code',x,$2
      FROM jsonb_array_elements($1::jsonb) AS x
    `,[payload,companyId]);
    return;
  }
  if(table==='inventory'){
    await client.query(`
      INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data,company_id)
      SELECT
        x->>'id',
        x->>'productCode',
        x->>'locationId',
        COALESCE(NULLIF(x->>'qty',''),'0')::numeric,
        NULLIF(x->>'palletId',''),
        x,
        $2
      FROM jsonb_array_elements($1::jsonb) AS x
    `,[payload,companyId]);
    return;
  }
  await client.query(`
    INSERT INTO ${table}(id,data,company_id)
    SELECT x->>'id',x,$2
    FROM jsonb_array_elements($1::jsonb) AS x
  `,[payload,companyId]);
}

export async function replaceState(client,state,expectedRevision,currentUser,compact=false,companyId=DEFAULT_COMPANY_ID){
  await client.query('INSERT INTO wms_company_meta(company_id) VALUES($1) ON CONFLICT(company_id) DO NOTHING',[companyId]);
  const locked=(await client.query('SELECT revision FROM wms_company_meta WHERE company_id=$1 FOR UPDATE',[companyId])).rows[0];
  const actual=Number(locked?.revision||1);
  if(expectedRevision!=null && Number(expectedRevision)!==actual){const e=new Error('El inventario cambió en otro equipo. Recarga antes de guardar.');e.status=409;e.code='REVISION_CONFLICT';throw e;}
  for(const table of ENTITY_TABLES){
    // Compatibilidad durante despliegues: un frontend anterior que aún no conozca
    // una colección nueva no puede vaciarla accidentalmente.
    if(!Array.isArray(state[table])) continue;
    await replaceTableBulk(client,table,state[table],companyId,currentUser);
  }
  const next=actual+1;
  const updated=(await client.query('UPDATE wms_company_meta SET revision=$1,settings=$2::jsonb,planning=$3::jsonb,updated_at=now() WHERE company_id=$4 RETURNING updated_at',[next,JSON.stringify(state.settings||{}),JSON.stringify(state.planning||{}),companyId])).rows[0];
  if(compact)return {compact:true,meta:{version:15,revision:next,updatedAt:updated?.updated_at}};
  return readState(client,currentUser,companyId);
}

export { ENTITY_TABLES, TENANT_TABLES, makeUserId };
