// Diagnóstico opcional: no registra cuerpos, tokens, IDs ni parámetros de consulta.
// Activar temporalmente con WMS_TRAFFIC_METRICS=1 en Render.
export function trafficMetrics(req,res,next){
  if(process.env.WMS_TRAFFIC_METRICS!=='1')return next();
  const start=process.hrtime.bigint();
  res.once('finish',()=>{
    const route=(req.baseUrl||'')+(req.route?.path||'');
    const path=route||req.path.replace(/\/[0-9a-f-]{12,}/gi,'/:id');
    const bytes=Number(res.getHeader('content-length'));
    const elapsedMs=Math.round(Number(process.hrtime.bigint()-start)/1e6);
    console.info('[WMS_TRAFFIC]',JSON.stringify({method:req.method,route:path,status:res.statusCode,responseBytes:Number.isFinite(bytes)?bytes:null,durationMs:elapsedMs}));
  });
  next();
}
