import {financialKeys,sharedKeys} from './shared-keys.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function createCloud({read,write,changed,status}){
  let running=false, conflicts=[], remote={};
  const baseline=()=>read('cloudBaseline',null);
  const queue=()=>read('cloudPending',{});
  function stage(key,value){
    if(!sharedKeys.includes(key))return;
    const pending=queue();
    pending[key]={before:pending[key]?.before??baseline()?.[key]??null,value};
    write('cloudPending',pending);
  }
  function apply(values){
    const pending=queue();
    let updated=false;
    for(const [key,value] of Object.entries(values)){
      if(sharedKeys.includes(key)&&!pending[key]&&!equal(read(key,null),value)){write(key,value);updated=true}
    }
    write('cloudBaseline',values);
    if(updated)changed();
  }
  async function sync(access){
    if(running||!access)return;
    running=true;
    const call=async patch=>{
      const response=await fetch('/.netlify/functions/panel-data',{method:patch?'PATCH':'GET',headers:{Authorization:'Bearer '+access,...(patch?{'Content-Type':'application/json'}:{})},body:patch?JSON.stringify(patch):undefined,cache:'no-store',signal:AbortSignal.timeout(10000)});
      const payload=await response.json();
      if(!response.ok&&response.status!==409)throw Error(payload.error);
      return payload;
    };
    try{
      const initial=await call();
      remote=initial.values;
      if(!initial.initialized&&!baseline()&&financialKeys.some(key=>read(key,null)!==null)){
        for(const key of sharedKeys){
          const value=read(key,null);
          if(value!==null&&!queue()[key])stage(key,value);
        }
      }
      const pending=queue();
      if(Object.keys(pending).length){
        const result=await call(pending);
        remote=result.values;
        conflicts=result.conflicts??[];
        if(conflicts.length){
          apply(remote);
          status('Hay cambios distintos en dos navegadores. Resuélvelos en Ajustes.',true);
          return;
        }
        const latest=queue();
        for(const [key,entry] of Object.entries(pending)){
          if(equal(latest[key],entry))delete latest[key];
          else if(latest[key])latest[key].before=remote[key]??null;
        }
        write('cloudPending',latest);
      }
      conflicts=[];
      apply(remote);
      status('Datos compartidos sincronizados.',false);
    }catch{status('La sincronización compartida no está disponible. Tus cambios siguen en este navegador y se volverán a intentar.',false)}
    finally{running=false}
  }
  function resolve(keepLocal){
    const pending=queue();
    for(const key of conflicts){
      if(keepLocal&&pending[key])pending[key].before=remote[key]??null;
      else delete pending[key];
    }
    write('cloudPending',pending);
    conflicts=[];
    apply(remote);
  }
  return {stage,sync,resolve};
}
