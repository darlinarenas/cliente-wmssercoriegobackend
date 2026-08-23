import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool, makeUserId } from '../../db/database.js';
import { requireRole } from '../../middleware/auth.js';
import { storePassword, verifyPassword } from '../../security/passwords.js';

export const usersRouter=Router();
usersRouter.use(requireRole('ADMIN_GLOBAL','ADMINISTRADOR'));
const roles=new Set(['ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO','OPERADOR_BODEGA','OPERADOR_RECEPCION','TRANSPORTISTA']);
const passwordResetLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados restablecimientos de contraseña. Intenta nuevamente en unos minutos.'}});

function validate(body,creating=false){
 const name=String(body.name||'').trim(),username=String(body.username||'').trim().toLowerCase(),role=String(body.role||'OPERADOR_BODEGA'),password=String(body.password||'');
 if(!name)throw Object.assign(new Error('El nombre es obligatorio.'),{status:400});
 if(!/^[a-z0-9._]{3,40}$/.test(username))throw Object.assign(new Error('El usuario debe tener 3 a 40 caracteres: letras, números, punto o guion bajo.'),{status:400});
 if(!roles.has(role))throw Object.assign(new Error('Rol inválido.'),{status:400});
 if(creating&&password.length<8)throw Object.assign(new Error('La contraseña temporal debe tener al menos 8 caracteres.'),{status:400});
 const siteIds=Array.isArray(body.siteIds)?[...new Set(body.siteIds.map(x=>String(x).trim()).filter(Boolean))]:[];
 const companyIds=Array.isArray(body.companyIds)?[...new Set(body.companyIds.map(x=>String(x).trim()).filter(Boolean))]:[];
 const accessStatus=['ACTIVE','PAUSED','DISABLED'].includes(body.accessStatus)?body.accessStatus:(body.active===false?'DISABLED':'ACTIVE');
 const accessAssignments=Array.isArray(body.accessAssignments)?body.accessAssignments.map(a=>({companyId:String(a?.companyId||'').trim(),siteId:String(a?.siteId||'').trim(),role:String(a?.role||'')})).filter(a=>a.companyId&&a.siteId&&roles.has(a.role)&&a.role!=='ADMIN_GLOBAL'):[];
 if(role==='ADMINISTRADOR'&&!siteIds.length)throw Object.assign(new Error('El administrador de centro debe tener al menos un centro asignado. Usa Administrador general para acceso total.'),{status:400});
 return{name,username,role,password,active:accessStatus==='ACTIVE',accessStatus,accessAssignments,siteIds,companyIds};
}
function enforceAdminScope(requestUser,value){const global=requestUser?.role==='ADMIN_GLOBAL'||(requestUser?.role==='ADMINISTRADOR'&&!(requestUser.siteIds||[]).length);if(global)return;if(value.role==='ADMIN_GLOBAL')throw Object.assign(new Error('Un administrador de centro no puede crear administradores generales.'),{status:403});const allowed=new Set(requestUser.siteIds||[]);if(value.siteIds.some(id=>!allowed.has(id)))throw Object.assign(new Error('No puedes asignar usuarios a un centro fuera de tu autorización.'),{status:403});}
function publicUserSql(){return `id,name,username,role,active,access_status AS "accessStatus",access_assignments AS "accessAssignments",site_ids AS "siteIds",company_ids AS "companyIds",must_change_password AS "mustChangePassword",created_at AS "createdAt"`; }
export function assertTargetIdentity(pathId,bodyId){if(String(bodyId||'')!==String(pathId||''))throw Object.assign(new Error('La identidad del usuario no coincide. Recarga la pantalla antes de guardar.'),{status:409});}
export function protectPrimaryAdmin(id,value){if(id==='USR-ADMIN'&&(value.role!=='ADMIN_GLOBAL'||value.accessStatus!=='ACTIVE'||value.siteIds.length||value.accessAssignments.length))throw Object.assign(new Error('El administrador principal debe conservar acceso general activo.'),{status:400});}

usersRouter.get('/',async(_req,res,next)=>{try{const {rows}=await pool.query(`SELECT ${publicUserSql()} FROM users ORDER BY name`);res.json(rows);}catch(e){next(e);}});

usersRouter.post('/',async(req,res,next)=>{try{
 const v=validate(req.body,true);enforceAdminScope(req.user,v);let id=makeUserId(v.name),n=2;while((await pool.query('SELECT 1 FROM users WHERE id=$1',[id])).rowCount)id=`${makeUserId(v.name)}-${n++}`;
 const storedPassword=storePassword(v.password);const {rows}=await pool.query(`INSERT INTO users(id,name,username,password_hash,role,active,access_status,access_assignments,site_ids,company_ids,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,false) RETURNING ${publicUserSql()}`,[id,v.name,v.username,storedPassword,v.role,v.active,v.accessStatus,JSON.stringify(v.accessAssignments),JSON.stringify(v.siteIds),JSON.stringify(v.companyIds)]);res.status(201).json(rows[0]);
}catch(e){if(e.code==='23505')e=Object.assign(new Error('Ese nombre de usuario ya existe.'),{status:409});next(e);}});

usersRouter.put('/:id',async(req,res,next)=>{try{
 assertTargetIdentity(req.params.id,req.body?.targetUserId);
 const v=validate(req.body,false),target=(await pool.query('SELECT role,site_ids AS "siteIds" FROM users WHERE id=$1',[req.params.id])).rows[0];if(!target)return res.status(404).json({error:'Usuario no encontrado.'});const requesterGlobal=req.user?.role==='ADMIN_GLOBAL'||(req.user?.role==='ADMINISTRADOR'&&!(req.user.siteIds||[]).length);if(!requesterGlobal&&(target.role==='ADMIN_GLOBAL'||!(target.siteIds||[]).some(id=>(req.user.siteIds||[]).includes(id))))return res.status(403).json({error:'No puedes modificar un usuario fuera de tu centro.'});enforceAdminScope(req.user,v);protectPrimaryAdmin(req.params.id,v);if(req.params.id===req.user.id&&v.accessStatus!=='ACTIVE')return res.status(400).json({error:'No puedes pausar ni desactivar tu propia sesión.'});
 const {rows}=await pool.query(`UPDATE users SET name=$1,username=$2,role=$3,active=$4,access_status=$5,access_assignments=$6::jsonb,site_ids=$7::jsonb,company_ids=$8::jsonb,updated_at=now() WHERE id=$9 RETURNING ${publicUserSql()}`,[v.name,v.username,v.role,v.active,v.accessStatus,JSON.stringify(v.accessAssignments),JSON.stringify(v.siteIds),JSON.stringify(v.companyIds),req.params.id]);
 if(rows.length!==1)return res.status(409).json({error:'No se pudo confirmar una actualización individual del usuario.'});res.json(rows[0]);
}catch(e){if(e.code==='23505')e=Object.assign(new Error('Ese nombre de usuario ya existe.'),{status:409});next(e);}});

usersRouter.post('/:id/reset-password',passwordResetLimiter,async(req,res,next)=>{try{
 const adminPassword=String(req.body?.adminPassword||'');
 const newPassword=String(req.body?.newPassword||'');
 if(newPassword.length<8)return res.status(400).json({error:'La nueva contraseña debe tener al menos 8 caracteres.'});
 if(newPassword.length>128)return res.status(400).json({error:'La nueva contraseña es demasiado larga.'});
 if(!adminPassword)return res.status(400).json({error:'Ingresa tu contraseña administrativa para autorizar el cambio.'});
 const admin=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id])).rows[0];
 if(!admin||!verifyPassword(adminPassword,admin.password_hash))return res.status(401).json({error:'La contraseña administrativa no coincide.'});
 const target=(await pool.query('SELECT id,name,username FROM users WHERE id=$1',[req.params.id])).rows[0];
 if(!target)return res.status(404).json({error:'Usuario no encontrado.'});
 const storedPassword=storePassword(newPassword);
 await pool.query('UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',[storedPassword,target.id]);
 res.json({ok:true,user:{id:target.id,name:target.name,username:target.username}});
}catch(e){next(e);}});

usersRouter.delete('/:id',async(req,res,next)=>{try{
 if(req.params.id==='USR-ADMIN'||req.params.id===req.user.id)return res.status(400).json({error:'No puedes eliminar el administrador principal ni tu propia sesión.'});
 const target=(await pool.query('SELECT id,role,site_ids AS "siteIds" FROM users WHERE id=$1',[req.params.id])).rows[0];
 if(!target)return res.status(404).json({error:'Usuario no encontrado.'});
 const requesterGlobal=req.user?.role==='ADMIN_GLOBAL'||(req.user?.role==='ADMINISTRADOR'&&!(req.user.siteIds||[]).length);
 if(!requesterGlobal&&(target.role==='ADMIN_GLOBAL'||!(target.siteIds||[]).some(id=>(req.user.siteIds||[]).includes(id))))return res.status(403).json({error:'No puedes eliminar un usuario fuera de tu centro.'});
 const referenced=await pool.query(`SELECT EXISTS(
   SELECT 1 FROM audit WHERE data->>'userId'=$1
   UNION ALL SELECT 1 FROM movements WHERE data::text LIKE $2
   UNION ALL SELECT 1 FROM receipts WHERE data::text LIKE $2
   UNION ALL SELECT 1 FROM transfers WHERE data::text LIKE $2
   UNION ALL SELECT 1 FROM orders WHERE data::text LIKE $2
 ) AS used`,[target.id,`%${target.id}%`]);
 if(referenced.rows[0]?.used)return res.status(409).json({error:'Este usuario ya tiene actividad registrada. Desactívalo para conservar la trazabilidad.'});
 await pool.query('DELETE FROM users WHERE id=$1',[target.id]);
 res.status(204).end();
}catch(e){next(e);}});
