import assert from 'node:assert/strict';
import { app } from '../src/app.js';

const server=app.listen(0,'127.0.0.1');
try{
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const {port}=server.address();
  const response=await fetch(`http://127.0.0.1:${port}/api/state`,{
    method:'OPTIONS',
    headers:{
      Origin:'https://cliente-wmssercoriego-q7w5.vercel.app',
      'Access-Control-Request-Method':'PUT',
      'Access-Control-Request-Headers':'authorization,content-type,x-wms-compact,x-wms-site'
    }
  });
  assert.equal(response.status,204,'El preflight de guardado debe ser aceptado');
  const allowed=String(response.headers.get('access-control-allow-headers')||'').toLowerCase();
  assert.match(allowed,/x-wms-compact/,'CORS debe permitir X-WMS-Compact');
  assert.equal(response.headers.get('access-control-allow-origin'),'https://cliente-wmssercoriego-q7w5.vercel.app');
  console.log('OK · preflight CORS del guardado PUT permite X-WMS-Compact');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
