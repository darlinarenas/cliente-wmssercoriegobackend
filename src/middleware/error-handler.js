export function notFound(_req,res){res.status(404).json({error:'Ruta no encontrada.'});}
export function errorHandler(err,_req,res,_next){console.error(err);res.status(err.status||500).json({error:err.message||'Error interno.',code:err.code||undefined});}
