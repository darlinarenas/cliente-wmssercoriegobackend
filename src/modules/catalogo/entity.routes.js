import { Router } from 'express';
import { pool, ENTITY_TABLES } from '../../db/database.js';

const allowed=new Set(ENTITY_TABLES);
function tableFor(req){const t=req.params.entity;if(!allowed.has(t))throw Object.assign(new Error('Módulo no válido.'),{status:404});return t;}
function selectSql(t){return t==='products'?'SELECT data FROM products ORDER BY code':t==='inventory'?'SELECT data FROM inventory ORDER BY id':`SELECT data FROM ${t} ORDER BY id`;}
async function upsert(t,item){
 if(!item?.id)throw Object.assign(new Error('El campo id es obligatorio.'),{status:400});
 if(t==='products')return pool.query('INSERT INTO products(id,code,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,data=EXCLUDED.data RETURNING data',[item.id,item.code,JSON.stringify(item)]);
 if(t==='inventory')return pool.query('INSERT INTO inventory(id,product_code,location_id,qty,pallet_id,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO UPDATE SET product_code=EXCLUDED.product_code,location_id=EXCLUDED.location_id,qty=EXCLUDED.qty,pallet_id=EXCLUDED.pallet_id,data=EXCLUDED.data RETURNING data',[item.id,item.productCode,item.locationId,Number(item.qty||0),item.palletId||null,JSON.stringify(item)]);
 return pool.query(`INSERT INTO ${t}(id,data) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data RETURNING data`,[item.id,JSON.stringify(item)]);
}
export const entityRouter=Router();
entityRouter.get('/:entity',async(req,res,next)=>{try{const t=tableFor(req);res.json((await pool.query(selectSql(t))).rows.map(r=>r.data));}catch(e){next(e);}});
entityRouter.get('/:entity/:id',async(req,res,next)=>{try{const t=tableFor(req),r=(await pool.query(`SELECT data FROM ${t} WHERE id=$1`,[req.params.id])).rows[0];if(!r)return res.status(404).json({error:'Registro no encontrado.'});res.json(r.data);}catch(e){next(e);}});
entityRouter.post('/:entity',async(req,res,next)=>{try{const t=tableFor(req);res.status(201).json((await upsert(t,req.body)).rows[0].data);}catch(e){next(e);}});
entityRouter.put('/:entity/:id',async(req,res,next)=>{try{const t=tableFor(req);res.json((await upsert(t,{...req.body,id:req.params.id})).rows[0].data);}catch(e){next(e);}});
entityRouter.delete('/:entity/:id',async(req,res,next)=>{try{const t=tableFor(req);await pool.query(`DELETE FROM ${t} WHERE id=$1`,[req.params.id]);res.status(204).end();}catch(e){next(e);}});
