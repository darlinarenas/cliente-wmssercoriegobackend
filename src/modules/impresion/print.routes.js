import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../../db/database.js';
import { requireRole } from '../../middleware/auth.js';

const MAX_ZPL_BYTES=12*1024*1024;
const ONLINE_WINDOW_MS=20_000;
const hashToken=(value)=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
const makeId=(prefix)=>`${prefix}-${crypto.randomUUID()}`;
const clean=(v,max=120)=>String(v||'').trim().slice(0,max);

async function ensureSite(companyId,siteId){
  const row=(await pool.query('SELECT 1 FROM sites WHERE company_id=$1 AND id=$2 LIMIT 1',[companyId,siteId])).rows[0];
  if(!row)throw Object.assign(new Error('El centro seleccionado no pertenece a esta empresa.'),{status:400});
}
function validateZpl(zpl){
  const value=String(zpl||'');
  if(!value.includes('^XA')||!value.includes('^XZ'))throw Object.assign(new Error('El trabajo no contiene ZPL válido.'),{status:400});
  if(Buffer.byteLength(value,'utf8')>MAX_ZPL_BYTES)throw Object.assign(new Error('La impresión es demasiado grande; divide la cola en lotes.'),{status:413});
  return value;
}
function stationView(row){
  const last=row.last_seen_at?new Date(row.last_seen_at).getTime():0;
  return {id:row.id,siteId:row.site_id,name:row.name,printerName:row.printer_name||'',active:row.active!==false,lastSeenAt:row.last_seen_at||null,online:!!last&&Date.now()-last<ONLINE_WINDOW_MS};
}

export const printRouter=Router();
printRouter.get('/stations',async(req,res,next)=>{try{
  const siteId=clean(req.query.siteId,80);if(siteId)await ensureSite(req.companyId,siteId);
  const params=[req.companyId];let where='company_id=$1';if(siteId){params.push(siteId);where+=' AND site_id=$2';}
  const rows=(await pool.query(`SELECT * FROM print_stations WHERE ${where} ORDER BY active DESC,last_seen_at DESC NULLS LAST,name`,params)).rows;
  res.json({stations:rows.map(stationView)});
}catch(e){next(e);}});

printRouter.post('/stations',requireRole('ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO'),async(req,res,next)=>{try{
  const siteId=clean(req.body?.siteId,80),name=clean(req.body?.name,80)||'PC impresión',printerName=clean(req.body?.printerName,180);
  if(!siteId)return res.status(400).json({error:'Selecciona el centro para esta estación de impresión.'});
  await ensureSite(req.companyId,siteId);
  const token=crypto.randomBytes(32).toString('base64url'),id=makeId('PST');
  const row=(await pool.query(`INSERT INTO print_stations(id,company_id,site_id,name,token_hash,printer_name,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,req.companyId,siteId,name,hashToken(token),printerName,req.user?.id||null])).rows[0];
  res.status(201).json({station:stationView(row),token});
}catch(e){next(e);}});

printRouter.patch('/stations/:id',requireRole('ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO'),async(req,res,next)=>{try{
  const current=(await pool.query('SELECT * FROM print_stations WHERE id=$1 AND company_id=$2',[req.params.id,req.companyId])).rows[0];
  if(!current)return res.status(404).json({error:'Estación no encontrada.'});
  const name=req.body?.name==null?current.name:clean(req.body.name,80),active=req.body?.active==null?current.active:!!req.body.active;
  const row=(await pool.query('UPDATE print_stations SET name=$3,active=$4,updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING *',[req.params.id,req.companyId,name,active])).rows[0];
  res.json({station:stationView(row)});
}catch(e){next(e);}});

printRouter.post('/jobs',async(req,res,next)=>{try{
  const siteId=clean(req.body?.siteId,80),requestedStation=clean(req.body?.stationId,100),labelType=clean(req.body?.labelType,40),copies=Math.max(1,Math.min(500,Number(req.body?.copies)||1)),zpl=validateZpl(req.body?.zpl);
  if(!siteId)return res.status(400).json({error:'No se pudo determinar el centro de impresión.'});
  await ensureSite(req.companyId,siteId);
  let station;
  if(requestedStation)station=(await pool.query('SELECT * FROM print_stations WHERE id=$1 AND company_id=$2 AND site_id=$3 AND active=true',[requestedStation,req.companyId,siteId])).rows[0];
  else station=(await pool.query('SELECT * FROM print_stations WHERE company_id=$1 AND site_id=$2 AND active=true ORDER BY last_seen_at DESC NULLS LAST,created_at ASC LIMIT 1',[req.companyId,siteId])).rows[0];
  if(!station)return res.status(409).json({error:'No hay una PC puente configurada para este centro.',code:'PRINT_STATION_MISSING'});
  const id=makeId('PRN');
  await pool.query(`INSERT INTO print_jobs(id,company_id,site_id,station_id,created_by,label_type,zpl,copies)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,req.companyId,siteId,station.id,req.user?.id||null,labelType,zpl,copies]);
  res.status(202).json({job:{id,status:'pending',station:stationView(station)}});
}catch(e){next(e);}});

printRouter.get('/jobs/:id',async(req,res,next)=>{try{
  const row=(await pool.query(`SELECT j.id,j.status,j.error,j.created_at,j.claimed_at,j.printed_at,s.name AS station_name,s.printer_name
    FROM print_jobs j JOIN print_stations s ON s.id=j.station_id WHERE j.id=$1 AND j.company_id=$2`,[req.params.id,req.companyId])).rows[0];
  if(!row)return res.status(404).json({error:'Trabajo de impresión no encontrado.'});
  res.json({job:{id:row.id,status:row.status,error:row.error||'',createdAt:row.created_at,claimedAt:row.claimed_at,printedAt:row.printed_at,stationName:row.station_name,printerName:row.printer_name||''}});
}catch(e){next(e);}});

async function agentStation(req){
  const raw=String(req.headers.authorization||''),token=raw.startsWith('Bearer ')?raw.slice(7):'';
  if(!token)return null;
  return (await pool.query('SELECT * FROM print_stations WHERE token_hash=$1 AND active=true LIMIT 1',[hashToken(token)])).rows[0]||null;
}
export async function requirePrintAgent(req,res,next){try{const station=await agentStation(req);if(!station)return res.status(401).json({error:'Estación de impresión no autorizada.'});req.printStation=station;next();}catch(e){next(e);}}

export const printAgentRouter=Router();
printAgentRouter.use(requirePrintAgent);
printAgentRouter.post('/heartbeat',async(req,res,next)=>{try{
  const printerName=clean(req.body?.printerName,180);
  await pool.query("UPDATE print_stations SET printer_name=COALESCE(NULLIF($2,''),printer_name),last_seen_at=now(),updated_at=now() WHERE id=$1",[req.printStation.id,printerName]);
  res.json({ok:true,stationId:req.printStation.id});
}catch(e){next(e);}});
printAgentRouter.get('/jobs/next',async(req,res,next)=>{const client=await pool.connect();try{
  await client.query('BEGIN');
  await client.query('UPDATE print_stations SET last_seen_at=now(),updated_at=now() WHERE id=$1',[req.printStation.id]);
  const row=(await client.query(`SELECT id,zpl,copies,label_type FROM print_jobs
    WHERE station_id=$1 AND (status='pending' OR (status='claimed' AND claimed_at<now()-interval '90 seconds'))
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`,[req.printStation.id])).rows[0];
  if(!row){await client.query('COMMIT');return res.json({ok:true,job:null});}
  await client.query("UPDATE print_jobs SET status='claimed',claimed_at=now(),attempts=attempts+1,updated_at=now() WHERE id=$1",[row.id]);
  await client.query('COMMIT');res.json({ok:true,job:{id:row.id,zpl:row.zpl,copies:row.copies,labelType:row.label_type}});
}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}});
printAgentRouter.post('/jobs/:id/result',async(req,res,next)=>{try{
  const ok=req.body?.ok===true,error=clean(req.body?.error,500),printerName=clean(req.body?.printerName,180);
  const result=await pool.query(`UPDATE print_jobs SET status=$3,error=$4,printed_at=CASE WHEN $3='printed' THEN now() ELSE printed_at END,updated_at=now()
    WHERE id=$1 AND station_id=$2 RETURNING id`,[req.params.id,req.printStation.id,ok?'printed':'error',ok?'':(error||'Error de impresión')]);
  if(!result.rowCount)return res.status(404).json({error:'Trabajo no encontrado para esta estación.'});
  await pool.query("UPDATE print_stations SET printer_name=COALESCE(NULLIF($2,''),printer_name),last_seen_at=now(),updated_at=now() WHERE id=$1",[req.printStation.id,printerName]);
  res.json({ok:true});
}catch(e){next(e);}});
