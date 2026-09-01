export const PERMISSION_KEYS=['codesConsult','codesAssociate','productsEdit','inventoryAdjust','physicalStockAdjust','labelsPrint','mapView','inventoryCount','inventoryManage','inventoryReview','palletsView','palletsOperate','palletsRegister','palletsEdit','changeSku','reconcileErp','applyErpStock','ordersCancel'];

export function rolePermissions(role){
 const manage=['ADMIN_GLOBAL','ADMINISTRADOR','ENCARGADO'].includes(role);
 const operator=manage||['OPERADOR_BODEGA','OPERADOR_RECEPCION'].includes(role);
 return {codesConsult:operator,codesAssociate:manage,productsEdit:manage,inventoryAdjust:manage,physicalStockAdjust:manage,labelsPrint:manage,mapView:manage,inventoryCount:manage,inventoryManage:manage,inventoryReview:manage,palletsView:operator,palletsOperate:operator,palletsRegister:manage,palletsEdit:manage,changeSku:manage,reconcileErp:manage,applyErpStock:manage,ordersCancel:manage};
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
 if(assignment?.customPermissions!==true)return rolePermissions(role);
 const source=assignment.permissions||{},permissions=sanitizePermissions(source),defaults=rolePermissions(role);
 ['physicalStockAdjust','labelsPrint','mapView','inventoryCount','inventoryManage','inventoryReview','palletsView','palletsOperate','palletsRegister','palletsEdit','changeSku','reconcileErp','applyErpStock','ordersCancel'].forEach(key=>{if(typeof source[key]!=='boolean')permissions[key]=defaults[key];});
 return permissions;
}

export function requireOperations(...operations){
 const operationPermission={codesAssociate:'codesAssociate',productsEdit:'productsEdit',inventoryAdjust:'inventoryAdjust',physicalStockAdjust:'physicalStockAdjust',inventoryCount:'inventoryCount',inventoryManage:'inventoryManage',inventoryReview:'inventoryReview',palletsOperate:'palletsOperate',palletsRegister:'palletsRegister',palletsEdit:'palletsEdit'};
 return (req,res,next)=>{
  const siteId=String(req.get('X-WMS-Site')||'').trim(),permissions=userPermissions(req.user,req.companyId,siteId);
  const denied=operations.find(operation=>!permissions[operationPermission[operation]]);
  return denied?res.status(403).json({error:'Tu permiso personalizado no autoriza esta operación.'}):next();
 };
}
