import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../src/modules/auth/auth.routes.js',import.meta.url),'utf8');
const auth=fs.readFileSync(new URL('../../src/services/auth.js',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../../src/modules/login/login.js',import.meta.url),'utf8');
const layout=fs.readFileSync(new URL('../../src/layout/layout.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../../src/app.js',import.meta.url),'utf8');

assert.doesNotMatch(server,/const state=await readState/,'el login no debe reconstruir el estado empresarial');
assert.match(server,/res\.json\(\{token,user,companies\}\)/,'el login debe devolver solo identidad y empresas');
assert.match(auth,/loginCompanies=data\.companies/);
assert.match(login,/auth\.loginCompanies/);
assert.doesNotMatch(login,/auth\.loginState\?\.companies/);
assert.doesNotMatch(layout,/site-switch[\s\S]{0,500}location\.reload/,'cambiar centro no debe recargar la página');
assert.match(layout,/serco:context-changed/);
assert.match(app,/addEventListener\('serco:context-changed'/);

console.log('OK · login liviano, una sola carga y cambio instantáneo de centro válidos');
