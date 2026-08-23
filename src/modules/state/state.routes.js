import { Router } from 'express';
import { readState, replaceState, withTransaction } from '../../db/database.js';
import { INITIAL_STATE } from '../../db/initial-state.js';
import { requireRole } from '../../middleware/auth.js';
export const stateRouter=Router();
stateRouter.get('/',async(req,res,next)=>{try{res.json(await readState(undefined,req.user));}catch(e){next(e);}});
stateRouter.put('/',async(req,res,next)=>{try{const expected=req.body?.meta?.revision,compact=req.get('X-WMS-Compact')==='1';const nextState=await withTransaction(c=>replaceState(c,req.body,expected,req.user,compact));res.json(nextState);}catch(e){next(e);}});
stateRouter.post('/reset',requireRole('ADMIN_GLOBAL','ADMINISTRADOR'),async(req,res,next)=>{try{const current=await readState(undefined,req.user);const fresh={...INITIAL_STATE,shipments:[],tasks:[],users:current.users,session:{userId:req.user.id},meta:{...INITIAL_STATE.meta,revision:current.meta.revision}};res.json(await withTransaction(c=>replaceState(c,fresh,current.meta.revision,req.user)));}catch(e){next(e);}});
