import pg from 'pg';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { INITIAL_STATE } from './initial-state.js';

const { Pool } = pg;
if(!env.databaseUrl) console.warn('[WMS] DATABASE_URL no configurada.');
export const pool = new Pool({connectionString:env.databaseUrl,ssl:env.databaseSsl?{rejectUnauthorized:false}:false});

const ENTITY_TABLES=['sites','sectors','racks','locations','products','inventory','pallets','receipts','transfers','movements','audit'];

const schemaSql=`
CREATE TABLE IF NOT EXISTS wms_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id=1),
  revision BIGINT NOT NULL DEFAULT 1,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  planning JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMINISTRADOR','ENCARGADO','OPERADOR_BODEGA','OPERADOR_RECEPCION')),
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
CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, product_code TEXT NOT NULL, location_id TEXT NOT NULL, qty NUMERIC NOT NULL DEFAULT 0, pallet_id TEXT, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS pallets (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS movements (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_code);
CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_pallet ON inventory(pallet_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
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
    const hash=await bcrypt.hash(env.adminPassword,12);
    await client.query(`INSERT INTO users(id,name,username,password_hash,role,active,must_change_password)
      VALUES('USR-ADMIN',$1,$2,$3,'ADMINISTRADOR',true,true)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, username=EXCLUDED.username, active=true`,[env.adminName,env.adminUsername.toLowerCase(),hash]);
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
  const meta=(await client.query('SELECT * FROM wms_meta WHERE id=1')).rows[0];
  const result={meta:{version:12,revision:Number(meta?.revision||1),updatedAt:meta?.updated_at,createdAt:meta?.created_at},settings:meta?.settings||{},planning:meta?.planning||{},session:{userId:currentUser?.id||'USR-ADMIN'}};
  for(const table of ENTITY_TABLES){
    if(table==='products') result[table]=(await client.query('SELECT data FROM products ORDER BY code')).rows.map(r=>r.data);
    else if(table==='inventory') result[table]=(await client.query('SELECT data FROM inventory ORDER BY id')).rows.map(r=>r.data);
    else result[table]=(await client.query(`SELECT data FROM ${table} ORDER BY id`)).rows.map(r=>r.data);
  }
  result.users=(await client.query('SELECT id,name,username,role,active,created_at AS "createdAt" FROM users ORDER BY name')).rows;
  return result;
}

export async function replaceState(client,state,expectedRevision,currentUser){
  const locked=(await client.query('SELECT revision FROM wms_meta WHERE id=1 FOR UPDATE')).rows[0];
  const actual=Number(locked?.revision||1);
  if(expectedRevision!=null && Number(expectedRevision)!==actual){const e=new Error('El inventario cambió en otro equipo. Recarga antes de guardar.');e.status=409;e.code='REVISION_CONFLICT';throw e;}
  for(const table of ENTITY_TABLES){
    await client.query(`DELETE FROM ${table}`);
    for(const item of state[table]||[]) await insertEntity(client,table,item);
  }
  const next=actual+1;
  await client.query('UPDATE wms_meta SET revision=$1,settings=$2::jsonb,planning=$3::jsonb,updated_at=now() WHERE id=1',[next,JSON.stringify(state.settings||{}),JSON.stringify(state.planning||{})]);
  return readState(client,currentUser);
}

export { ENTITY_TABLES, makeUserId };
