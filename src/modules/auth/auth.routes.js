import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { pool } from '../../db/database.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter=Router();
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados intentos. Intenta nuevamente en unos minutos.'}});
function publicUser(u){return{id:u.id,name:u.name,username:u.username,role:u.role,active:u.active,siteIds:u.site_ids||u.siteIds||[],companyIds:u.company_ids||u.companyIds||[],mustChangePassword:u.must_change_password??u.mustChangePassword};}

authRouter.post('/login',loginLimiter,async(req,res,next)=>{try{
  const username=String(req.body?.username||'').trim().toLowerCase(), password=String(req.body?.password||'');
  if(!username||!password) return res.status(400).json({error:'Usuario y contraseña son obligatorios.'});
  const {rows}=await pool.query('SELECT * FROM users WHERE lower(username)=$1',[username]);const u=rows[0];
  if(!u||!u.active||!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Credenciales incorrectas.'});
  const token=jwt.sign({sub:u.id,role:u.role},env.jwtSecret,{expiresIn:env.jwtExpiresIn});
  res.json({token,user:publicUser(u)});
}catch(e){next(e);}});

authRouter.get('/me',requireAuth,(req,res)=>res.json({user:req.user}));

const adminRecoveryLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados intentos de recuperación. Intenta nuevamente en unos minutos.'}});
function safeSecretEqual(a,b){
 const aa=Buffer.from(String(a||''));const bb=Buffer.from(String(b||''));
 return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);
}
authRouter.post('/recover-admin',adminRecoveryLimiter,async(req,res,next)=>{try{
 const recoveryKey=String(req.body?.recoveryKey||'');
 const newPassword=String(req.body?.newPassword||'');
 const configuredRecoveryKey=String(process.env.ADMIN_RECOVERY_KEY||'');
 if(!configuredRecoveryKey)return res.status(503).json({error:'La recuperación administrativa no está configurada en el servidor.'});
 if(!safeSecretEqual(recoveryKey,configuredRecoveryKey))return res.status(401).json({error:'Clave de recuperación incorrecta.'});
 if(newPassword.length<8)return res.status(400).json({error:'La nueva contraseña debe tener al menos 8 caracteres.'});
 if(newPassword.length>128)return res.status(400).json({error:'La nueva contraseña es demasiado larga.'});
 const target=(await pool.query("SELECT id FROM users WHERE id='USR-ADMIN' LIMIT 1")).rows[0];
 if(!target)return res.status(404).json({error:'No existe el administrador principal.'});
 const hash=await bcrypt.hash(newPassword,12);
 await pool.query('UPDATE users SET password_hash=$1,active=true,must_change_password=false,updated_at=now() WHERE id=$2',[hash,target.id]);
 res.json({ok:true});
}catch(e){next(e);}});


const supercodeLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados intentos de supercódigo. Intenta nuevamente en unos minutos.'}});
authRouter.post('/verify-supercode',requireAuth,supercodeLimiter,async(req,res,next)=>{try{
  if(req.user?.role!=='ADMINISTRADOR') return res.status(403).json({error:'Solo un administrador puede autorizar eliminaciones.'});
  const supercode=String(req.body?.supercode||'');
  if(!supercode) return res.status(400).json({error:'Ingresa el supercódigo administrativo.'});
  const {rows}=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
  const ok=rows[0]&&await bcrypt.compare(supercode,rows[0].password_hash);
  if(!ok) return res.status(401).json({error:'Supercódigo incorrecto.'});
  res.json({ok:true});
}catch(e){next(e);}});
authRouter.post('/change-password',requireAuth,async(req,res,next)=>{try{
 const current=String(req.body?.currentPassword||''),nextPassword=String(req.body?.newPassword||'');
 if(nextPassword.length<8)return res.status(400).json({error:'La nueva contraseña debe tener al menos 8 caracteres.'});
 const {rows}=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
 if(!(await bcrypt.compare(current,rows[0].password_hash))) return res.status(400).json({error:'La contraseña actual no coincide.'});
 const hash=await bcrypt.hash(nextPassword,12);await pool.query('UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',[hash,req.user.id]);
 res.json({ok:true});
}catch(e){next(e);}});
