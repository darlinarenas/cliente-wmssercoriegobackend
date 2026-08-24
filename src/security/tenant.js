export const DEFAULT_COMPANY_ID='SERCO_RIEGO';

export function userCompanyIds(user){
  return [...new Set([...(user?.companyIds||user?.company_ids||[]),...(user?.accessAssignments||user?.access_assignments||[]).map(a=>a?.companyId)].map(String).filter(Boolean))];
}

export function canAccessCompany(user,companyId){
  if(!user||!companyId)return false;
  if(user.role==='ADMIN_GLOBAL')return true;
  return userCompanyIds(user).includes(companyId);
}

export function requestedCompany(req,user=req.user){
  const requested=String(req?.get?.('X-WMS-Company')||req?.headers?.['x-wms-company']||'').trim();
  const allowed=userCompanyIds(user);
  const companyId=requested||allowed[0]||DEFAULT_COMPANY_ID;
  if(!canAccessCompany(user,companyId))throw Object.assign(new Error('No tienes acceso a la empresa solicitada.'),{status:403,code:'COMPANY_FORBIDDEN'});
  return companyId;
}

export function tenantItem(item,companyId){
  if(!item||typeof item!=='object')return item;
  const own=String(item.companyId||companyId||'').trim();
  if(own!==companyId)throw Object.assign(new Error('El registro pertenece a otra empresa.'),{status:403,code:'CROSS_COMPANY_WRITE'});
  return {...item,companyId};
}
