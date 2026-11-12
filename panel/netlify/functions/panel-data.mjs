import {authorized} from '../lib/access.mjs';
import {getStore} from '@netlify/blobs';
import {sharedKeys} from '../../public/shared-keys.js';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

export default async function handler(request){
  const key=process.env.DASHBOARD_ACCESS_KEY;
  if(!key||key.length<24)return json({error:'Falta la clave del panel.'},503);
  if(!authorized(request.headers.get('authorization'),request.headers.get('cookie'),key))return json({error:'Clave del panel incorrecta.'},401);
  if(!['GET','PATCH'].includes(request.method))return json({error:'Método no permitido.'},405);
  try{
    const store=getStore({name:'margen-private',consistency:'strong'});
    const path='panel-v1';
    const load=()=>store.getWithMetadata(path,{type:'json'});
    if(request.method==='GET'){
      const current=await load();
      return json({values:current?.data??{},initialized:Boolean(current)});
    }
    const body=await request.text();
    if(body.length>1_000_000)return json({error:'Los datos superan el tamaño permitido.'},413);
    let patch;
    try{patch=JSON.parse(body)}catch{return json({error:'Datos inválidos.'},400)}
    if(!record(patch)||!Object.keys(patch).length||Object.entries(patch).some(([k,v])=>!sharedKeys.includes(k)||!record(v)||!Object.hasOwn(v,'before')||!Object.hasOwn(v,'value')||v.value===null)){
      return json({error:'Cambios inválidos.'},400);
    }
    for(let attempt=0;attempt<4;attempt++){
      const current=await load(), values=current?.data??{};
      const conflicts=Object.keys(patch).filter(k=>!same(values[k]??null,patch[k].before)&&!same(values[k]??null,patch[k].value));
      if(conflicts.length)return json({values,conflicts},409);
      const next={...values,...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,v.value]))};
      if(same(next,values))return json({values});
      const result=await store.setJSON(path,next,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
      if(result.modified)return json({values:next});
    }
    return json({error:'Hay otra sincronización en curso. Se volverá a intentar.'},503);
  }catch{return json({error:'El almacenamiento compartido no está disponible.'},503)}
}
