import { Router } from 'express';
import { pool } from '../../db/database.js';
import { env } from '../../config/env.js';

export const kameRouter=Router();
const norm=v=>String(v??'').trim().replace(/\s+/g,'').toUpperCase();
function unauthorized(res){return res.status(401).json({error:'Clave de integración inválida.'});}

kameRouter.post('/orders',async(req,res,next)=>{
 try{
  if(!env.kameIntegrationKey)return res.status(503).json({error:'Integración Kame preparada pero aún no activada. Configura KAME_INTEGRATION_KEY cuando dispongas de la API.'});
  if(String(req.get('x-integration-key')||'')!==env.kameIntegrationKey)return unauthorized(res);
  const companyId=String(req.get('x-wms-company')||req.body?.companyId||'').trim();
  if(!companyId)return res.status(400).json({error:'La integración debe indicar companyId o X-WMS-Company.'});
  const externalNumber=String(req.body?.externalNumber||req.body?.orderNumber||'').trim();
  const sourceSiteId=String(req.body?.sourceSiteId||'').trim();
  const requestSiteId=String(req.body?.requestSiteId||'').trim();
  const incoming=Array.isArray(req.body?.items)?req.body.items:[];
  if(!externalNumber||!sourceSiteId||!requestSiteId||!incoming.length)return res.status(400).json({error:'Faltan externalNumber, sourceSiteId, requestSiteId o items.'});
  const products=(await pool.query('SELECT data FROM products WHERE company_id=$1',[companyId])).rows.map(r=>r.data);
  const codes=(await pool.query('SELECT data FROM product_codes WHERE company_id=$1',[companyId])).rows.map(r=>r.data).filter(x=>x.active!==false);
  const codeMap=new Map();for(const p of products){codeMap.set(norm(p.code),p);for(const old of p.previousCodes||[])codeMap.set(norm(old),p);}for(const c of codes){const p=products.find(x=>x.id===c.productId);if(p)codeMap.set(norm(c.code),p);}
  const grouped=new Map(),errors=[];
  incoming.forEach((x,i)=>{const raw=norm(x.code??x.sku??x.productCode),qty=Number(x.qty??x.quantity);const p=codeMap.get(raw);if(!p){errors.push(`Item ${i+1}: código ${raw||'(vacío)'} no reconocido.`);return;}if(!Number.isFinite(qty)||qty<=0){errors.push(`Item ${i+1}: cantidad inválida.`);return;}const prev=grouped.get(p.code)||{productCode:p.code,qty:0,pickedQty:0,inputCodes:[]};prev.qty+=qty;prev.inputCodes.push(raw);grouped.set(p.code,prev);});
  if(errors.length)return res.status(422).json({error:'La orden contiene códigos o cantidades inválidas.',details:errors});
  const siteRows=(await pool.query('SELECT data FROM sites WHERE company_id=$1 AND id=ANY($2::text[])',[companyId,[sourceSiteId,requestSiteId]])).rows.map(r=>r.data);const sourceSite=siteRows.find(s=>s.id===sourceSiteId),requestSite=siteRows.find(s=>s.id===requestSiteId);if(!sourceSite||!requestSite)return res.status(400).json({error:'Centro origen o solicitante no existe en la empresa indicada.'});const now=new Date().toISOString(),id=`ORD-KAME-${Date.now()}`;const order={id,externalNumber,source:'KAME_API',companyId,sourceSiteId,requestSiteId,status:'RECIBIDA',assignedTo:null,items:[...grouped.values()],createdAt:now,createdBy:'KAME',events:[{at:now,userId:'KAME',message:'Orden recibida desde integración Kame'}]};
  const client=await pool.connect();try{await client.query('BEGIN');const duplicate=await client.query("SELECT data FROM orders WHERE company_id=$1 AND data->>'externalNumber'=$2",[companyId,externalNumber]);if(duplicate.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'La orden ya fue recibida.',order:duplicate.rows[0].data});}await client.query('INSERT INTO orders(id,data,company_id) VALUES($1,$2::jsonb,$3)',[id,JSON.stringify(order),companyId]);await client.query('INSERT INTO wms_company_meta(company_id) VALUES($1) ON CONFLICT(company_id) DO NOTHING',[companyId]);await client.query('UPDATE wms_company_meta SET revision=revision+1,updated_at=now() WHERE company_id=$1',[companyId]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.status(201).json(order);
 }catch(e){next(e);}
});
