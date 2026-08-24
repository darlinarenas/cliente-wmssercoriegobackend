import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { notFound, errorHandler } from './middleware/error-handler.js';

export const app=express();
app.use(helmet());

const normalizeOrigin=(value)=>String(value||'').trim().replace(/\/+$/,'');
const configuredOrigins=new Set(
  env.frontendOrigin
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)
);

// Dominios oficiales del frontend. Se acepta tanto producción como previews
// del mismo proyecto en Vercel, además de cualquier origen configurado
// explícitamente mediante FRONTEND_ORIGIN.
const isOfficialVercelFrontend=(origin)=>{
  try{
    const {hostname,protocol}=new URL(origin);
    if(protocol!=='https:') return false;
    if(hostname==='cliente-wmssercoriego.vercel.app') return true;
    return hostname.endsWith('.vercel.app') && hostname.startsWith('cliente-wmssercoriego-');
  }catch{
    return false;
  }
};

export const isAllowedOrigin=(origin)=>{
  // Peticiones servidor-servidor, health checks, curl/Postman, etc.
  if(!origin) return true;
  const normalized=normalizeOrigin(origin);
  if(configuredOrigins.has(normalized)) return true;
  if(isOfficialVercelFrontend(normalized)) return true;
  return false;
};

app.use(cors({
  origin:(origin,cb)=>{
    if(isAllowedOrigin(origin)) return cb(null,true);
    console.warn(`[CORS] Origen rechazado: ${origin}`);
    return cb(new Error('Origen no permitido por CORS'));
  },
  credentials:false,
  methods:['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  // X-WMS-Compact lo envía el frontend al guardar el estado. Si no se declara
  // aquí, el navegador bloquea el PUT en el preflight y muestra "Failed to fetch".
  allowedHeaders:['Content-Type','Authorization','X-Integration-Key','X-Kame-Integration-Key','X-WMS-Site','X-WMS-Company','X-WMS-Compact'],
  optionsSuccessStatus:204,
}));

app.use(express.json({limit:'8mb'}));
app.use('/api',apiRouter);
app.use(notFound);
app.use(errorHandler);
