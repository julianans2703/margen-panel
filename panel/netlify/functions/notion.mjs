import {authorized} from '../lib/access.mjs';
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const fields={
  invoices:{client:['Cliente','Customer','Nombre','Factura'],issued:['Fecha de emisión','Emisión','Fecha factura','Fecha'],amount:['Importe en €','Importe EUR','Importe','Total'],state:['Cobrado','Estado','Status'],year:['Año'],paid:['Fecha de pago','Pago','Fecha de cobro'],due:['Vencimiento','Fecha de vencimiento'],month:['Mes'],batch:['Lote Mercury','Lote'],mercury:['Neto Mercury USD'],mercuryDate:['Fecha abono Mercury']},
  movements:{date:['Fecha','Fecha del movimiento'],amount:['Importe','Importe en €','Cantidad','Total'],category:['Categoría','Categoria','Category'],type:['Tipo','Tipo de movimiento']},
  budgets:{month:['Mes','Fecha'],amount:['Presupuesto','Importe','Límite','Cantidad'],category:['Categoría','Nombre','Category']}
};
const required={invoices:['client','amount'],movements:['date','amount','category'],budgets:['amount','category']};
const configVars={invoices:'NOTION_FACTURAS',movements:'NOTION_MOVIMIENTOS',budgets:'NOTION_PRESUPUESTOS'};
function read(p){
  if(!p)return null;
  const v=p[p.type];
  if(p.type==='formula'||p.type==='rollup')return read(v);
  if(p.type==='title'||p.type==='rich_text')return v.map(x=>x.plain_text).join('');
  if(p.type==='multi_select')return v.map(x=>x.name).join(', ');
  if(p.type==='date')return v?.start?.slice(0,10);
  if(p.type==='select'||p.type==='status')return v?.name;
  if(['string','number','checkbox','boolean'].includes(p.type))return v;
  return null;
}
function property(schema, aliases){
  for(const alias of aliases){
    const key=Object.keys(schema).find(k=>normalize(k)===normalize(alias)||schema[k].id===alias);
    if(key)return key;
  }
}
function date(value){
  const text=String(value??'').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) ? text : null;
}
function month(value, year){
  if(!value)return null;
  let t=normalize(value);
  if(/^[a-z]+$/.test(t)&&/^\d{4}$/.test(String(year)))t+=' '+year;
  if(/^\d{4}-(0[1-9]|1[0-2])(?:$|-)/.test(t))return t.slice(0,7);
  const match=t.match(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de)? (\d{4})$/);
  if(!match)return null;
  const i='enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ').indexOf(match[1])+1;
  return match[2]+'-'+String(i).padStart(2,'0');
}
async function notion(path,body){
  const response=await fetch('https://api.notion.com/v1/'+path,{
    method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+process.env.NOTION_TOKEN,'Notion-Version':'2025-09-03','Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(9000)
  });
  if(!response.ok){const error=Error('Notion respondió '+response.status+' al leer '+path.split('/')[0]+'.');error.status=response.status;throw error}
  return response.json();
}
async function load(kind,mapping,warnings){
  const input=process.env[configVars[kind]].trim().split(/[?#]/)[0];
  let id=input.match(/[a-f\d]{8}(?:-?[a-f\d]{4}){3}-?[a-f\d]{12}$/i)?.[0];
  if(!id)throw Error(configVars[kind]+' debe terminar en un ID válido de Notion.');
  let schema;
  try{schema=(await notion('data_sources/'+id)).properties}
  catch(error){
    if(error.status!==404)throw error;
    const db=await notion('databases/'+id);
    if(db.data_sources?.length!==1)throw Error(configVars[kind]+' necesita el ID de una fuente concreta.');
    id=db.data_sources[0].id;
    schema=(await notion('data_sources/'+id)).properties;
  }
  const names=Object.fromEntries(Object.entries(fields[kind]).map(([key,aliases])=>[
    key,property(schema,mapping[kind]?.[key] ? [mapping[kind][key]] : aliases)
      || (key==='client'&&!mapping[kind]?.[key] ? Object.keys(schema).find(k=>schema[k].type==='title'):undefined)
  ]));
  const missing=[...new Set([...required[kind],...Object.keys(mapping[kind]??{})])].filter(k=>!names[k]);
  if(missing.length)throw Error(configVars[kind]+' · faltan correspondencias para '+missing.join(', ')+'.');
  const supported=['formula','rollup','title','rich_text','multi_select','date','select','status','number','checkbox'];
  for(const [key,name] of Object.entries(names)){
    if(name&&!supported.includes(schema[name].type))throw Error(configVars[kind]+' · '+key+' usa '+schema[name].type+'. Selecciona una propiedad compatible.');
  }
  let cursor, omitted=0, undated=0, unknownMonth=0;
  const rows=[];
  do{
    const result=await notion('data_sources/'+id+'/query',{page_size:100,...(cursor?{start_cursor:cursor}:{})});
    for(const page of result.results){
      if(page.object!=='page'||page.archived||page.in_trash)continue;
      const get=k=>read(page.properties[names[k]]);
      const amount=get('amount');
      if(kind==='invoices' && (amount==null || amount===''))continue;
      if(!Number.isFinite(amount)){omitted++;continue}
      const category=get('category');
      const issued=date(get('issued'));
      const paymentDate=date(get('paid'));
      const period=month(get('month'),get('year')??issued?.slice(0,4)??paymentDate?.slice(0,4)??(kind==='invoices'?process.env.NOTION_FACTURAS_YEAR:null));
      if(get('month')&&!period)unknownMonth++;
      if(kind==='invoices'){
        const rawState=get('state'), state=normalize(rawState);
        const paid=rawState===false ? null : paymentDate;
        const settled=rawState===true||['cobrada','cobrado','pagada','pagado','paid','settled'].includes(state);
        if((!issued&&!period&&!paid)||amount<0){omitted++;continue}
        if(settled&&!paid)undated++;
        rows.push({id:page.id,client:String(get('client')||'Sin cliente'),amount,issued,paid,mercury:Number.isFinite(get('mercury'))&&get('mercury')>=0?get('mercury'):null,mercuryDate:date(get('mercuryDate')),due:date(get('due'))||(rawState===false?paymentDate:null),month:period,batch:String(get('batch')??'').trim(),settled,late:['retrasada','vencida','overdue'].includes(state)});
      }else if(kind==='movements'){
        const d=date(get('date')),type=normalize(get('type'));
        if(!d||!category){omitted++;continue}
        if(names.type&&!['gasto','egreso','salida','expense','debit'].includes(type))continue;
        rows.push({date:d,category:String(category),amount:Math.abs(amount)});
      }else{
        if(!category||amount<0||(get('month')&&!period)){omitted++;continue}
        rows.push({month:period,category:String(category),amount});
      }
    }
    cursor=result.has_more ? result.next_cursor : null;
    if(result.has_more&&!cursor)throw Error('Notion devolvió una paginación incompleta.');
  }while(cursor);
  if(omitted)warnings.push(configVars[kind]+' · '+omitted+' filas omitidas por datos inválidos.');
  if(undated)warnings.push(undated+' facturas cobradas sin fecha de pago.');
  if(unknownMonth&&kind==='invoices')warnings.push(unknownMonth+' meses sin año o formato reconocido.');
  return rows;
}
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'},body:JSON.stringify(body)});
export async function handler(event){
  if(event.httpMethod!=='GET')return json(405,{error:'Método no permitido.'});
  const key=process.env.DASHBOARD_ACCESS_KEY;
  if(!key||!process.env.NOTION_TOKEN||!process.env.NOTION_FACTURAS)return json(503,{error:'Configura la conexión en Netlify primero.'});
  if(key.length<24)return json(503,{error:'Configura una clave de acceso de al menos 24 caracteres.'});
  if(!authorized(event.headers.authorization,event.headers.cookie,key))return json(401,{error:'Clave de acceso incorrecta.'});
  try{
    let mapping;
    try{mapping=JSON.parse(process.env.NOTION_MAPPING||'{}')}catch{throw Error('NOTION_MAPPING debe ser JSON válido.')}
    if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('NOTION_MAPPING debe ser un objeto JSON.');
    const warnings=[];
    const entries=[];
    for(const kind of Object.keys(configVars))entries.push([kind,process.env[configVars[kind]] ? await load(kind,mapping,warnings) : []]);
    return json(200,{data:Object.fromEntries(entries),warnings,sources:Object.keys(configVars).filter(kind=>process.env[configVars[kind]])});
  }catch(error){return json(502,{error:error.message})}
}
