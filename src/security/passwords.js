// Modo de desarrollo solicitado: contraseñas visibles en PostgreSQL.
// No se aplica hashing/cifrado en esta etapa. Antes de una entrega comercial
// este módulo debe migrarse de forma controlada a almacenamiento seguro.

function validatePassword(password){
  const value=String(password??'');
  if(value.length<8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres.'),{status:400});
  if(value.length>128) throw Object.assign(new Error('La contraseña es demasiado larga.'),{status:400});
  return value;
}

export function storePassword(password){
  return validatePassword(password);
}

export function verifyPassword(password,storedPassword){
  return String(password??'')===String(storedPassword??'');
}
