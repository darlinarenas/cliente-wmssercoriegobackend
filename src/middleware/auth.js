import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/database.js';
import { requestedCompany } from '../security/tenant.js';

export async function requireAuth(req,res,next){
  try{
    const raw=req.headers.authorization||'';
    const token=raw.startsWith('Bearer ')?raw.slice(7):'';
    if(!token) return res.status(401).json({error:'Debes iniciar sesión.'});
    const payload=jwt.verify(token,env.jwtSecret);
    const {rows}=await pool.query('SELECT id,name,username,role,active,access_status AS "accessStatus",access_assignments AS "accessAssignments",site_ids AS "siteIds",company_ids AS "companyIds",must_change_password AS "mustChangePassword" FROM users WHERE id=$1',[payload.sub]);
    const user=rows[0];
    if(!user||!user.active||user.accessStatus!=='ACTIVE') return res.status(401).json({error:'Usuario pausado o desactivado.'});
    req.user=user;req.companyId=requestedCompany(req,user);next();
  }catch(e){return res.status(401).json({error:'Sesión inválida o vencida.'});}
}
export function requireRole(...roles){return(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'No tienes permiso para esta operación.'});}
