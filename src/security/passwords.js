import bcrypt from 'bcryptjs';

// bcryptjs genera hashes de 60 caracteres con prefijos $2a$ o $2b$.
// Aceptamos también $2y$ por compatibilidad con hashes bcrypt externos.
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value){
  return typeof value==='string' && BCRYPT_RE.test(value);
}

export async function hashPassword(password){
  const value=String(password??'');
  if(value.length<8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres.'),{status:400});
  if(value.length>128) throw Object.assign(new Error('La contraseña es demasiado larga.'),{status:400});
  return bcrypt.hash(value,12);
}

export async function verifyPassword(password,storedHash){
  if(!isBcryptHash(storedHash)) return false;
  return bcrypt.compare(String(password??''),storedHash).catch(()=>false);
}

export const BCRYPT_POSTGRES_PATTERN='^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$';
