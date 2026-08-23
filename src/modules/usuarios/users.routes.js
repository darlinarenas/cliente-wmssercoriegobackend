import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool, makeUserId } from '../../db/database.js';
import { requireRole } from '../../middleware/auth.js';
import { storePassword, verifyPassword } from '../../security/passwords.js';

export const usersRouter=Router();
usersRouter.use(requireRole('ADMIN_GLOBAL','ADMINISTRADOR'));
const roles=new Set(['ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO','OPERADOR_BODEGA','OPERADOR_RECEPCION']);
const passwordResetLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados restablecimientos de contraseña. Intenta nuevamente en unos minutos.'}});

function validate(body,creating=false){
 const name=String(body.name||'').trim(),username=String(body.username||'').trim().toLowerCase(),role=String(body.role||'OPERADOR_BODEGA'),password=String(body.password||'');
 if(!name)throw Object.assign(new Error('El nombre es obligatorio.'),{status:400});
 if(!/^[a-z0-9._]{3,40}$/.test(username))throw Object.assign(new Error('El usuario debe tener 3 a 40 caracteres: letras, números, punto o guion bajo.'),{status:400});
 if(!roles.has(role))throw Object.assign(new Error('Rol inválido.'),{status:400});
 if(creating&&password.length<8)throw Object.assign(new Error('La contraseña temporal debe tener al menos 8 caracteres.'),{status:400});
 const siteIds=Array.isArray(body.siteIds)?[...new Set(body.siteIds.map(x=>String(x).trim()).filter(Boolean))]:[];
 const companyIds=Array.isArray(body.companyIds)?[...new Set(body.companyIds.map(x=>String(x).trim()).filter(Boolean))]:[];
 if(role==='ADMINISTRADOR'&&!siteIds.length)throw Object.assign(new Error('El administrador de centro debe tener al menos un centro asignado. Usa Administrador general para acceso total.'),{status:400});
 return{name,username,role,password,active:body.active!==false,siteIds,companyIds};
}
function enforceAdminScope(requestUser,value){const global=requestUser?.role==='ADMIN_GLOBAL'||(requestUser?.role==='ADMINISTRADOR'&&!(requestUser.siteIds||[]).length);if(global)return;if(value.role==='ADMIN_GLOBAL')throw Object.assign(new Error('Un administrador de centro no puede crear administradores generales.'),{status:403});const allowed=new Set(requestUser.siteIds||[]);if(value.siteIds.some(id=>!allowed.has(id)))throw Object.assign(new Error('No puedes asignar usuarios a un centro fuera de tu autorización.'),{status:403});}
function publicUserSql(){return `id,name,username,role,active,site_ids AS "siteIds",company_ids AS "companyIds",must_change_password AS "mustChangePassword",created_at AS "createdAt"`; }

usersRouter.get('/',async(_req,res,next)=>{try{const {rows}=await pool.query(`SELECT ${publicUserSql()} FROM users ORDER BY name`);res.json(rows);}catch(e){next(e);}});

usersRouter.post('/',async(req,res,next)=>{try{
 const v=validate(req.body,true);enforceAdminScope(req.user,v);let id=makeUserId(v.name),n=2;while((await pool.query('SELECT 1 FROM users WHERE id=$1',[id])).rowCount)id=`${makeUserId(v.name)}-${n++}`;
 const storedPassword=storePassword(v.password);const {rows}=await pool.query(`INSERT INTO users(id,name,username,password_hash,role,active,site_ids,company_ids,must_change_password) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,false) RETURNING ${publicUserSql()}`,[id,v.name,v.username,storedPassword,v.role,v.active,JSON.stringify(v.siteIds),JSON.stringify(v.companyIds)]);res.status(201).json(rows[0]);
}catch(e){if(e.code==='23505')e=Object.assign(new Error('Ese nombre de usuario ya existe.'),{status:409});next(e);}});

usersRouter.put('/:id',async(req,res,next)=>{try{
 const v=validate(req.body,false),target=(await pool.query('SELECT role,site_ids AS "siteIds" FROM users WHERE id=$1',[req.params.id])).rows[0];if(!target)return res.status(404).json({error:'Usuario no encontrado.'});const requesterGlobal=req.user?.role==='ADMIN_GLOBAL'||(req.user?.role==='ADMINISTRADOR'&&!(req.user.siteIds||[]).length);if(!requesterGlobal&&(target.role==='ADMIN_GLOBAL'||!(target.siteIds||[]).some(id=>(req.user.siteIds||[]).includes(id))))return res.status(403).json({error:'No puedes modificar un usuario fuera de tu centro.'});enforceAdminScope(req.user,v);if(req.params.id==='USR-ADMIN'&&!v.active)return res.status(400).json({error:'No se puede desactivar el administrador principal.'});
 const {rows}=await pool.query(`UPDATE users SET name=$1,username=$2,role=$3,active=$4,site_ids=$5::jsonb,company_ids=$6::jsonb,updated_at=now() WHERE id=$7 RETURNING ${publicUserSql()}`,[v.name,v.username,v.role,v.active,JSON.stringify(v.siteIds),JSON.stringify(v.companyIds),req.params.id]);
 if(!rows[0])return res.status(404).json({error:'Usuario no encontrado.'});res.json(rows[0]);
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
 await pool.query('UPDATE users SET password_hash=$1,must_change_password=false,active=true,updated_at=now() WHERE id=$2',[storedPassword,target.id]);
 res.json({ok:true,user:{id:target.id,name:target.name,username:target.username}});
}catch(e){next(e);}});
