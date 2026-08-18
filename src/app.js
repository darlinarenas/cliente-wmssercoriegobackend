import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFound, errorHandler } from './middleware/error-handler.js';
export const app=express();
app.use(helmet());
const origins=env.frontendOrigin.split(',').map(x=>x.trim()).filter(Boolean);
const isAllowedOrigin=(origin)=>{
  if(!origin) return true;
  if(origins.includes(origin)) return true;
  try{
    const {hostname,protocol}=new URL(origin);
    if(protocol==='https:' && hostname.endsWith('.vercel.app') && hostname.startsWith('cliente-wmssercoriego-')) return true;
  }catch{}
  return false;
};
app.use(cors({origin:(origin,cb)=>isAllowedOrigin(origin)?cb(null,true):cb(new Error('Origen no permitido por CORS')),credentials:false}));
app.use(express.json({limit:'8mb'}));
app.use('/api',apiRouter);app.use(notFound);app.use(errorHandler);
