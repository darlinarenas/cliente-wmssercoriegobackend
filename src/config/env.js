import 'dotenv/config';

const bool=(value,fallback=false)=>value==null?fallback:['1','true','yes','si'].includes(String(value).toLowerCase());
export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:8080',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL,false),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-this-secret-sercoriego',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'SercoRiego2026!',
  adminName: process.env.ADMIN_NAME || 'Administrador',
  kameIntegrationKey: process.env.KAME_INTEGRATION_KEY || '',
};
