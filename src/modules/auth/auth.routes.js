import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { pool } from '../../db/database.js';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter=Router();
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false,message:{error:'Demasiados intentos. Intenta nuevamente en unos minutos.'}});
function publicUser(u){return{id:u.id,name:u.name,username:u.username,role:u.role,active:u.active,mustChangePassword:u.must_change_password??u.mustChangePassword};}

authRouter.post('/login',loginLimiter,async(req,res,next)=>{try{
  const username=String(req.body?.username||'').trim().toLowerCase(), password=String(req.body?.password||'');
  if(!username||!password) return res.status(400).json({error:'Usuario y contraseña son obligatorios.'});
  const {rows}=await pool.query('SELECT * FROM users WHERE lower(username)=$1',[username]);const u=rows[0];
  if(!u||!u.active||!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Credenciales incorrectas.'});
  const token=jwt.sign({sub:u.id,role:u.role},env.jwtSecret,{expiresIn:env.jwtExpiresIn});
  res.json({token,user:publicUser(u)});
}catch(e){next(e);}});

authRouter.get('/me',requireAuth,(req,res)=>res.json({user:req.user}));
authRouter.post('/change-password',requireAuth,async(req,res,next)=>{try{
 const current=String(req.body?.currentPassword||''),nextPassword=String(req.body?.newPassword||'');
 if(nextPassword.length<8)return res.status(400).json({error:'La nueva contraseña debe tener al menos 8 caracteres.'});
 const {rows}=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
 if(!(await bcrypt.compare(current,rows[0].password_hash))) return res.status(400).json({error:'La contraseña actual no coincide.'});
 const hash=await bcrypt.hash(nextPassword,12);await pool.query('UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',[hash,req.user.id]);
 res.json({ok:true});
}catch(e){next(e);}});
