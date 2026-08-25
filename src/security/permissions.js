export const PERMISSION_KEYS=['codesConsult','codesAssociate','productsEdit','inventoryAdjust'];

export function rolePermissions(role){
 const manage=['ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO'].includes(role);
 return {codesConsult:manage||['OPERADOR_BODEGA','OPERADOR_RECEPCION'].includes(role),codesAssociate:manage,productsEdit:manage,inventoryAdjust:manage};
}

export function sanitizePermissions(value){
 const source=value&&typeof value==='object'?value:{};
 return Object.fromEntries(PERMISSION_KEYS.map(key=>[key,source[key]===true]));
}

export function effectiveAssignment(user,companyId,siteId){
 return (user?.accessAssignments||user?.access_assignments||[]).find(a=>a?.companyId===companyId&&a?.siteId===siteId)||null;
}

export function userPermissions(user,companyId,siteId){
 if(user?.role==='ADMIN_GLOBAL')return rolePermissions('ADMIN_GLOBAL');
 const assignment=effectiveAssignment(user,companyId,siteId),role=assignment?.role||user?.role;
 return assignment?.customPermissions===true?sanitizePermissions(assignment.permissions):rolePermissions(role);
}

export function requireOperations(...operations){
 const operationPermission={codesAssociate:'codesAssociate',productsEdit:'productsEdit',inventoryAdjust:'inventoryAdjust'};
 return (req,res,next)=>{
  const siteId=String(req.get('X-WMS-Site')||'').trim(),permissions=userPermissions(req.user,req.companyId,siteId);
  const denied=operations.find(operation=>!permissions[operationPermission[operation]]);
  return denied?res.status(403).json({error:'Tu permiso personalizado no autoriza esta operación.'}):next();
 };
}
