import assert from 'node:assert/strict';
import { storePassword, verifyPassword } from '../src/security/passwords.js';

const plain='ClaveVisible2026';
const stored=storePassword(plain);
assert.equal(stored,plain,'Durante desarrollo la contraseña debe guardarse sin transformación');
assert.equal(verifyPassword(plain,stored),true,'La contraseña correcta debe validar');
assert.equal(verifyPassword('incorrecta',stored),false,'Una contraseña distinta debe fallar');
assert.equal(verifyPassword('ClaveVisible2026 ','ClaveVisible2026'),false,'La comparación debe ser exacta');
console.log('OK · desarrollo: contraseña directa, comparación exacta y sin bcrypt');
