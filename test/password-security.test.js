import assert from 'node:assert/strict';
import { hashPassword, isBcryptHash, verifyPassword } from '../src/security/passwords.js';

const plain='PruebaSegura-2026';
const hash=await hashPassword(plain);
assert.equal(isBcryptHash(hash),true,'El hash generado debe ser bcrypt válido');
assert.equal(await verifyPassword(plain,hash),true,'La contraseña correcta debe validar');
assert.equal(await verifyPassword('incorrecta',hash),false,'Una contraseña distinta debe fallar');
assert.equal(await verifyPassword(plain,plain),false,'Texto plano nunca debe aceptarse como hash');
console.log('OK · contraseñas: bcrypt obligatorio, validación correcta y texto plano rechazado');
