import {createCloud} from './cloud.js';
import {sharedKeys as backupKeys} from './shared-keys.js';
import {defaults,sum,shift,quote,status,monthly,monthOf,localDay,demo} from './model.js';
const $ = id => document.getElementById(id);
const read = (key,fallback) => {try{return JSON.parse(localStorage.getItem('margen.'+key)) ?? fallback}catch{return fallback}};
const write = (key,value) => localStorage.setItem('margen.'+key,JSON.stringify(value));
function save(key,value){
  write(key,value);
  if(live&&backupKeys.includes(key)){
    cloud.stage(key,value);
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(syncCloud,250);
  }
}
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=localDay();
let month=monthOf(today), currency=read('currency','EUR'), settings={...defaults,...read('settings',{})};
let sources=[], data=demo(today), live=false, syncing=false, selected='', timer;
const tabs={resumen:'Resumen',facturas:'Facturas y cobros',comisiones:'Comisiones',ahorros:'Ahorros',gastos:'Gastos y presupuesto',efectivo:'Efectivo',ajustes:'Ajustes'};
const dateLabel=(date,options={day:'numeric',month:'short'})=>date ? new Intl.DateTimeFormat('es-ES',{...options,timeZone:'UTC'}).format(new Date((date.length===7?date+'-01':date)+'T12:00:00Z')) : '—';
const labelMonth=m=>dateLabel(m,{month:'long',year:'numeric'});
const fmt=(n,c=currency)=>new Intl.NumberFormat('es-ES',{style:'currency',currency:c}).format(n);
const money=n=>fmt(currency==='USD'?n*settings.rate:n);
const percent=n=>new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(n)+' %';
const card=(title,body)=>'<section class="card"><h2>'+title+'</h2>'+body+'</section>';
const kpi=(name,value,note='')=>'<div class="card kpi"><small>'+name+'</small><strong class="num">'+value+'</strong><small>'+note+'</small></div>';
const empty=message=>'<p class="muted">'+message+'</p>';
const table=(headers,rows)=>rows.length ? '<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>' : empty('Sin registros en este periodo.');
const track=(n,over=false)=>'<div class="track '+(over?'over':'')+'"><span style="width:'+Math.min(100,Math.max(0,n))+'%"></span></div>';
const badge=i=>'<span class="pill '+(status(i)==='Retrasada'?'late':'')+'">'+status(i)+'</span>';
const months=(end=month,n=6)=>Array.from({length:n},(_,i)=>shift(end,i-n+1));
function chart(rows, names) {
  const max=Math.max(1,...rows.flatMap(r=>r.values));
  const bar=(v,i,m)=>{
    const label=names[i]+' · '+money(v);
    return '<button type="button" class="bar '+(i?'expense':'')+'" style="height:'+100*Math.max(0,v)/max+'%" aria-label="'+esc(labelMonth(m)+' · '+label)+'"><span class="bar-tip" aria-hidden="true">'+esc(label)+'</span></button>';
  };
  return '<div class="legend">'+names.map((n,i)=>'<span><i class="'+(i?'expense':'')+'"></i>'+n+'</span>').join('')+'</div><div class="chart">'+rows.map(({m,values})=>'<div class="group"><div class="bars">'+values.map((v,i)=>bar(v,i,m)).join('')+'</div><small>'+dateLabel(m,{month:'short'})+'</small></div>').join('')+'</div>';
}
function overview(s){
  const prev=monthly(withCash(),shift(month,-1),settings);
  const stats=[['Trabajo del mes',s.billed,prev.billed],['Cobrado estimado',s.received,prev.received],['Pendiente',s.pending,prev.pending],['Gastos',s.spent,prev.spent],['Balance',s.balance,prev.balance]];
  const confirmed=mercuryDeposits().filter(i=>monthOf(i.date)===month);
  const snapshot=read('mercuryTotal.'+profile(),null);
  const real=live?'<div class="grid kpis">'+kpi('Abonos confirmados en Mercury',confirmed.length?fmt(sum(confirmed,i=>i.usd),'USD'):'—',confirmed.length+' abonos · <a href="#mercury">Registrar o ver abonos →</a>')+kpi('Saldo total de Mercury',snapshot?fmt(snapshot.usd,'USD'):'—',snapshot?'Guardado el '+dateLabel(snapshot.date):'Saldo pendiente de registrar').replace('</div>','<details><summary>Actualizar saldo</summary>'+mercuryBalanceForm(snapshot)+'</details></div>')+'</div>':'';
  const late=data.invoices.filter(i=>status(i)==='Retrasada');
  const future=data.invoices.filter(i=>status(i)==='Pendiente' && monthOf(i.due)>monthOf(today));
  return real+'<div class="grid kpis">'+stats.map(([name,n,p])=>kpi(name,money(n),(n-p>0?'+':'')+money(n-p)+' vs. mes anterior')).join('')+'</div><div class="grid two">'+card('Flujo de caja',chart(months().map(m=>{const r=monthly(withCash(),m,settings);return {m,values:[r.received,r.spent]}}),['Cobrado neto','Gastos']))+card('Próximos cobros',months(shift(monthOf(today),3),3).map(m=>'<div class="row item"><span>'+labelMonth(m)+'</span><strong>'+money(sum(future.filter(i=>monthOf(i.due)===m),i=>quote(i,data.invoices,settings).eur))+'</strong></div>').join('')+'<p><span class="pill '+(late.length?'late':'')+'">'+late.length+' facturas retrasadas</span></p><a href="#facturas">Ver facturas →</a>')+'</div><div class="grid two">'+card('Reserva fiscal estimada','<strong>'+money(s.received*settings.tax/100)+'</strong><p class="muted">'+percent(settings.tax)+' del cobro neto de este mes.</p>')+card('Balance del mes','<strong>'+money(s.balance)+'</strong><p class="muted">Cobro neto estimado menos gastos registrados.</p>')+'</div>';
}
const cashRows=()=>read('cash.'+profile(),[]);
const cashTypes={deposit:'Entrada o retirada del banco',allocate:'Reservar para categoría',release:'Liberar dinero reservado',expense:'Gasto en efectivo',imagin:'Ingresar en Imagin'};
const withCash=()=>({...data,movements:[...data.movements,...cashRows().filter(row=>row.type==='expense').map(row=>({...row,amount:row.cents/100,category:row.category||'Efectivo'}))]});
function cashBalances(rows, unit){
  const buckets=new Map([['',0]]);
  for(const {type,category,cents} of rows.filter(row=>row.currency===unit)){
    const add=(key,delta)=>buckets.set(key,(buckets.get(key)||0)+delta);
    if(type==='allocate'||type==='release'){
      const delta=type==='allocate'?cents:-cents;
      add('',-delta);add(category,delta);
    }else add(type==='deposit'||type==='imagin'?'':category,type==='deposit'?cents:-cents);
  }
  return buckets;
}
function validCash(rows){
  const chronological=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
  return ['EUR','USD'].every(unit=>chronological.every((row,index)=>[...cashBalances(chronological.slice(0,index+1),unit).values()].every(cents=>cents>=0)));
}
function cashView(){
  const rows=cashRows();
  const buckets=[...cashBalances(rows,'EUR')];
  const balances=card('Efectivo en euros','<p><strong>'+fmt(sum(buckets,([,cents])=>cents)/100,'EUR')+'</strong></p>'+buckets.map(([category,cents])=>{
    const expenses=rows.filter(row=>row.currency==='EUR'&&row.type==='expense'&&row.category===category);
    return '<details class="item"><summary>'+esc(category||'Sin asignar')+' · '+fmt(cents/100,'EUR')+'</summary><p><button type="button" data-cash-spend="'+esc(category)+'">Registrar gasto aquí</button></p>'+table(['Fecha','Concepto','Gastado'],expenses.map(row=>[dateLabel(row.date),esc(row.note)||'—',fmt(row.cents/100,'EUR')]))+'</details>';
  }).join(''));
  return '<div class="grid two">'+balances+'</div>'+card('Registrar movimiento','<form id="cash"><div class="grid fields"><label class="field">Movimiento<select name="type">'+Object.entries(cashTypes).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label><label class="field">Importe<input name="amount" type="number" min=".01" step=".01" required></label><label class="field">Fecha<input name="date" type="date" max="'+localDay()+'" value="'+localDay()+'" required></label><label class="field">Categoría<input name="category" maxlength="80" placeholder="Ej. Trabajadores"></label><label class="field">Concepto opcional<input name="note" maxlength="150"></label></div><p class="muted">Registra lo que ya tienes como primera entrada. Usa una categoría para reservar o liberar dinero. Para ingresar en Imagin, usa efectivo sin asignar. Si está reservado, libéralo primero.</p><button class="primary">Guardar movimiento</button></form>')+'<div class="section">'+card('Movimientos del mes',table(['Fecha','Movimiento','Categoría','Concepto','Importe',''],rows.filter(row=>monthOf(row.date)===month).sort((a,b)=>b.date.localeCompare(a.date)).map(row=>[dateLabel(row.date),cashTypes[row.type],esc(row.category)||'—',esc(row.note)||'—',fmt(row.cents/100,row.currency),'<button type="button" data-cash-remove="'+esc(row.id)+'">Quitar</button>'])))+'</div>';
}
const mercuryDeposits=()=>read('mercuryDeposits.real',[]);
function deposits(){
  if(!live)return card('Abonos en Mercury',empty('Conecta el panel en Ajustes para abrir tus registros.'));
  const rows=mercuryDeposits().filter(row=>monthOf(row.date)===month).sort((a,b)=>b.date.localeCompare(a.date));
  return card('Registrar abono en Mercury','<form id="mercuryDeposit"><div class="grid fields"><label class="field">Importe recibido en USD<input type="number" min=".01" step=".01" name="usd" required></label><label class="field">Fecha de abono<input type="date" name="date" required value="'+(month===monthOf(today)?today:month+'-01')+'"></label><label class="field">Nota opcional<input name="note" maxlength="150"></label></div><button class="primary">Guardar abono</button></form><p class="muted">Registra una vez cada transferencia que llegó a Mercury. Los abonos se guardan en este navegador.</p>')+'<div class="section">'+card('Abonos del mes',table(['Fecha','Importe recibido','Nota',''],rows.map(row=>[dateLabel(row.date),fmt(row.usd,'USD'),esc(row.note),'<button type="button" data-deposit-remove="'+esc(row.id)+'">Quitar</button>'])))+'</div>';
}
function invoices(s){
  const visible=data.invoices.filter(i=>s.issued.includes(i)||monthOf(i.paid)===month||monthOf(i.due)===month);
  const events=visible.flatMap(i=>[[i.issued,'Emisión',i],[i.paid,'Cobro',i],[i.due,'Vencimiento',i]]).filter(([d])=>monthOf(d)===month).sort((a,b)=>a[0].localeCompare(b[0]));
  const current=data.invoices.find(i=>i.id===selected) ?? visible[0] ?? data.invoices[0];
  let calc=empty('Añade facturas a Notion para simular sus cobros.');
  if(current){
    const q=quote(current,data.invoices,settings);
    calc='<label class="field">Factura<select id="invoice">'+data.invoices.map(i=>'<option value="'+esc(i.id)+'" '+(current.id===i.id?'selected':'')+'>'+esc(i.client)+' · '+dateLabel(i.issued)+' · '+money(i.amount)+'</option>').join('')+'</select></label>'+[['Facturado',fmt(current.amount,'EUR')],['Bruto OneSafe',fmt(q.gross,'USD')],['Conversión',fmt(q.conversion,'USD')],['Transferencia a Mercury',fmt(q.transfer,'USD')],['Neto final en Mercury',fmt(q.net,'USD')+' / '+fmt(q.eur,'EUR')],['Total perdido',percent(q.lost)]].map(([a,b])=>'<div class="row item"><span>'+a+'</span><strong class="num">'+b+'</strong></div>').join('')+'<p class="muted">Simulación con el cambio y las comisiones de Ajustes.</p>';
  }
  return card('Facturas del periodo',table(['Cliente','Emisión','Cobro','Estado','Importe',''],visible.map(i=>[esc(i.client),dateLabel(i.issued),dateLabel(i.paid),badge(i),money(i.amount),'<button class="link" data-invoice="'+esc(i.id)+'">Simular</button>'])))+'<div class="grid two">'+card('Línea de tiempo',events.length?events.map(([d,type,i])=>'<div class="row item"><span><small>'+dateLabel(d)+'</small><br>'+esc(i.client)+'</span><span class="pill">'+type+'</span></div>').join(''):empty('Sin eventos en este periodo.'))+card('Simulador por factura',calc)+'</div>';
}
function fees(s){
  const year=month.slice(0,4), list=data.invoices.filter(i=>i.paid?.slice(0,4)===year && monthOf(i.paid)<=month);
  const conv=rows=>sum(rows,i=>quote(i,data.invoices,settings).conversion)/settings.rate;
  const transfer=rows=>sum(rows,i=>quote(i,data.invoices,settings).transfer)/settings.rate;
  return '<div class="grid kpis">'+kpi('Comisiones del mes',money(s.fees))+kpi('Conversión del mes',money(conv(s.paid)))+kpi('Transferencias del mes',money(transfer(s.paid)))+kpi('Acumulado '+year,money(conv(list)+transfer(list)))+'</div>'+card('Comisiones por mes',chart(months(month,Number(month.slice(5))).map(m=>{const {paid}=monthly(withCash(),m,settings);return {m,values:[conv(paid),transfer(paid)]}}),['Conversión','Transferencia'])+'<p class="muted">Estimaciones sobre facturas con fecha de pago, calculadas con los parámetros actuales.</p>');
}
function expenses(s){
  const b=data.budgets.filter(i=>!i.month||i.month===month);
  const cats=[...new Set([...b,...s.movements].map(i=>i.category))].sort();
  const comparison=card('Gasto por categoría',table(['Categoría','Gastado','Presupuesto','Disponible','Uso'],cats.map(c=>{
    const spent=sum(s.movements.filter(i=>i.category===c),i=>i.currency==='USD'?i.amount/settings.rate:i.amount), limit=sum(b.filter(i=>i.category===c),i=>i.amount);
    return [esc(c),money(spent),limit?money(limit):'—',limit?money(limit-spent):'—',limit?track(spent/limit*100,spent>limit)+percent(spent/limit*100):'—'];
  })));
  if(!live)return comparison;
  return comparison+['movements','budgets'].filter(kind=>!sources.includes(kind)).map(kind=>{
    const spending=kind==='movements';
    const rows=data[kind];
    return '<div class="section">'+card(spending?'Registrar gasto':'Presupuesto mensual',
      '<form id="'+kind+'"><div class="grid fields"><label class="field">Categoría<input name="category" required maxlength="80"></label><label class="field">'+(spending?'Importe':'Importe en EUR')+'<input name="amount" type="number" min="0" step=".01" required></label>'+
      (spending?'<label class="field">Moneda<select name="expenseCurrency"><option>USD</option><option>EUR</option></select></label><label class="field">Fecha<input type="date" name="date" required value="'+(month===monthOf(today)?today:month+'-01')+'"></label>':'')+
      '</div><button class="primary">'+(spending?'Añadir gasto':'Guardar para '+labelMonth(month))+'</button></form><p class="muted">Guardado en este navegador.</p>'+
      table(['Categoría','Importe',spending?'Fecha':'Mes',''],rows.filter(row=>spending?monthOf(row.date)===month:row.month===month).map(row=>[esc(row.category),spending?fmt(row.amount,row.currency||'EUR'):money(row.amount),spending?dateLabel(row.date):labelMonth(row.month),'<button type="button" data-remove-kind="'+kind+'" data-id="'+esc(row.id)+'">Quitar</button>'])))+'</div>';
  }).join('');

}
const accountDefaults=()=>[
  {name:'Imagin',currency:'EUR',balance:5200},
  {name:'Ahorro en Mercury',currency:'USD',balance:7600},
  {name:'Interactive Brokers',currency:'EUR',balance:8450},
  {name:'Otros',currency:'EUR',balance:600}
];
const profile=()=>live?'real':'demo';
const demoHistory=()=>Object.fromEntries(months(monthOf(today)).slice(0,5).map((m,i)=>[m,15300+i*1050]));
let accounts=read('accounts.demo',accountDefaults()), goal=read('goal.demo',25000), history=read('history.demo',demoHistory());
const imaginDeposits=()=>sum(cashRows().filter(row=>row.type==='imagin'),row=>row.cents)/100;
function mercuryBalanceForm(snapshot){
  return '<form id="mercuryTotal"><label class="field">Saldo total de la cuenta en USD<input type="number" min="0" step=".01" name="usd" required value="'+(snapshot?.usd??'')+'"></label><button class="primary">Guardar saldo total</button></form>';
}
const savingAdjustments=()=>read('savingAdjustments.'+profile(),[0,0]);
const fixedUnit=i=>i===0?'EUR':'USD';
const adjustedBalance=(a,i)=>i<2
  ? (a.currency===fixedUnit(i)?a.balance:i===0?a.balance/settings.rate:a.balance*settings.rate)
    +(savingAdjustments()[i]||0)/100+(i===0?imaginDeposits():0)
  : a.balance;
const savingEUR=(a,i)=>(i<2?fixedUnit(i):a.currency)==='USD'?adjustedBalance(a,i)/settings.rate:adjustedBalance(a,i);
const savingTotal=()=>accounts.reduce((total,a,i)=>total+savingEUR(a,i),0);
function savingCard(i){
  const name=i===0?'Ahorro en Imagin':'Ahorro en Mercury', unit=fixedUnit(i);
  const balance=adjustedBalance(accounts[i],i);
  return card(name,'<p><strong class="num">'+fmt(balance,unit)+'</strong>'+(i===1?'<br><small>Equivalente: '+fmt(balance/settings.rate,'EUR')+'</small>':'')+'</p><form data-saving="'+i+'"><label class="field">Importe en '+unit+'<input name="amount" type="number" min=".01" step=".01" required></label><div class="actions"><button class="primary" name="direction" value="add">Añadir ahorro</button><button name="direction" value="subtract">Retirar ahorro</button></div></form>');
}
function savings(){
  const total=savingTotal();
  const liquid=total-(accounts[2].currency==='USD'?accounts[2].balance/settings.rate:accounts[2].balance);
  const avg=sum(months(shift(month,-1),3),m=>monthly(withCash(),m,settings).spent)/3;
  const snapshot=read('mercuryTotal.'+profile(),null);
  const mercuryForm=live?card('Saldo total de Mercury',mercuryBalanceForm(snapshot)):'';
  const values=months().map(m=>({m,values:[history[m]??0]}));
  return '<div class="grid kpis">'+kpi('Ahorro total',fmt(total,'EUR'))+kpi('Fondo de emergencia',avg?new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}).format(liquid/avg)+' meses':'—','Saldo sin inversiones / gasto medio de los 3 meses previos')+'</div>'+mercuryForm+'<div class="grid two">'+savingCard(0)+savingCard(1)+'</div><form id="accounts" class="card"><h2>Ahorros por cuenta</h2><div class="grid fields">'+accounts.map((a,i)=>'<div class="card"><label class="field">Cuenta<input name="name'+i+'" required maxlength="80" value="'+esc(a.name)+'"></label><label class="field">'+(i===0?'Saldo base de Imagin':'Saldo')+'<input name="balance'+i+'" type="number" step=".01" min="0" required value="'+a.balance+'"></label><label class="field">Moneda de la cuenta<select name="unit'+i+'"><option '+(a.currency==='EUR'?'selected':'')+'>EUR</option><option '+(a.currency==='USD'?'selected':'')+'>USD</option></select></label><p>'+fmt(adjustedBalance(a,i),i<2?fixedUnit(i):a.currency)+'</p>'+(i===0&&imaginDeposits()?'<small>Incluye '+fmt(imaginDeposits(),'EUR')+' ingresados desde Efectivo. Introduce arriba el saldo previo a esos ingresos.</small>':'')+(i>=3?'<button type="button" data-remove="'+i+'">Quitar</button>':'')+'</div>').join('')+'</div><div class="actions"><button type="button" id="add">+ Añadir cuenta</button><button class="primary">Guardar saldos</button></div></form><div class="grid two">'+card('Evolución del ahorro',Object.keys(history).some(m=>months().includes(m))?chart(values,['Saldo registrado'])+'<p class="muted">Los meses sin registro se muestran sin barra.</p>':empty('Guarda un saldo mensual para iniciar el historial.') )+card('Objetivo de ahorro','<form id="goal"><label class="field">Meta en euros<input type="number" min="1" step=".01" name="goal" value="'+goal+'" required></label><p>'+money(total)+' de '+money(goal)+'</p>'+track(total/goal*100)+'<p>'+percent(total/goal*100)+'</p><button>Guardar objetivo</button></form>')+'</div>';
}
const settingsFields=[['rate','1 EUR en USD',.0001,1000],['conversion','Conversión (%)',0,100],['conversionFixed','Conversión fija (USD)',0,100000],['transfer','Transferencia (%)',0,100],['transferFixed','Transferencia fija por lote (USD)',0,100000],['tax','Reserva fiscal (%)',0,100],['refresh','Sincronización (minutos)',1,120]];
function backupPanel(){
  return '<details class="section card"><summary>Copia de seguridad</summary><p>Descarga un respaldo o recupera una copia anterior. La sincronización entre navegadores es automática.</p><div class="actions"><button type="button" id="exportBackup">Descargar copia</button><label class="field">Importar copia<input id="importBackup" type="file" accept=".json,application/json"></label></div></details>';
}
function exportBackup(){
  const values=Object.fromEntries(backupKeys.map(key=>[key,read(key,null)]).filter(([,value])=>value!==null));
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,values},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='margen-copia-'+localDay()+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importBackup(input){
  try{
    const file=input.files[0];
    if(!file)return;
    const {version,values}=JSON.parse(await file.text());
    if(version!==1||!values||Array.isArray(values)||typeof values!=='object'||!Object.keys(values).length||Object.keys(values).some(key=>!backupKeys.includes(key)))throw Error();
    for(const [key,value] of Object.entries(values)){
      const current=read(key,null);
      const list=['accounts.real','movements.real','budgets.real','cash.real','mercuryDeposits.real','savingAdjustments.real'].includes(key);
      if(list&&!Array.isArray(value)||value===null||current!==null&&typeof value!==typeof current)throw Error();
    }
    if(Object.keys(values).some(key=>localStorage.getItem('margen.'+key)!==null)&&!window.confirm('La copia sustituirá los datos correspondientes de este navegador. ¿Continuar?'))return;
    for(const [key,value] of Object.entries(values))save(key,value);
    location.reload();
  }catch{setNotice('No se pudo importar. Selecciona un archivo descargado desde Margen.')}
  finally{input.value=''}
}
function options(){
  return '<div id="cloudResolution" class="actions" '+(cloudConflict?'':'hidden')+'><button type="button" id="keepLocal">Conservar cambios de este navegador</button><button type="button" id="keepCloud">Usar cambios compartidos</button></div>'+backupPanel()+card('Cambio y comisiones','<form id="settings"><div class="grid fields">'+settingsFields.map(([key,label,min,max])=>'<label class="field">'+label+'<input name="'+key+'" type="number" min="'+min+'" max="'+max+'" step="'+(key==='refresh'?'1':key==='rate'?'any':'.01')+'" required value="'+settings[key]+'"></label>').join('')+'</div><div class="actions"><button class="primary">Guardar ajustes</button><button type="button" id="rate">Consultar Frankfurter</button></div><p class="muted">Para agrupar transferencias, asigna el mismo lote en Notion. La cuota se reparte según el saldo tras la conversión. Sin lote, se calcula una transferencia por factura.</p></form>')+'<div class="section">'+card('Conexión con Notion','<form id="access"><label class="field">Clave de acceso al panel<input name="access" type="password" autocomplete="current-password" required></label><p><label><input type="checkbox" name="remember"> Recordarme en este dispositivo durante 30 días</label></p><div class="actions"><button>Conectar y sincronizar</button><button type="button" id="disconnect">Desconectar</button></div></form>')+'</div>';
}
let access=sessionStorage.getItem('margen.access')||'';
let remembered=read('remembered',false),authBusy=false;
const hasAccess=()=>Boolean(access||remembered);
let loadError=false,cloudTimer,cloudConflict=false;
const cloud=createCloud({
  read,write,
  changed(){
    if(!live)return;
    loadAccounts();
    settings={...defaults,...read('settings',{})};
    currency=read('currency','EUR');
    document.documentElement.dataset.theme=read('dark',false)?'dark':'light';
    for(const kind of ['movements','budgets'])if(!sources.includes(kind))data[kind]=read(kind+'.real',[]);
    if(!document.activeElement?.closest('form'))view();
  },
  status(message,conflict){
    cloudConflict=conflict;
    $('cloudNotice').textContent=message;
    const resolution=$('cloudResolution');
    if(resolution)resolution.hidden=!conflict;
  }
});
function syncCloud(){if(live&&!document.hidden)cloud.sync(access)}
function setNotice(message){$('notice').textContent=message}
function view(){
  const tab=(Object.hasOwn(tabs,location.hash.slice(1))||location.hash==='#mercury')?location.hash.slice(1):'resumen';
  $('nav').innerHTML=Object.entries(tabs).map(([key,name],i)=>'<a href="#'+key+'" '+(key===tab?'aria-current="page"':'')+'>'+['◈','▤','⇄','◇','▥','◉','⚙'][i]+' &nbsp;'+name+'</a>').join('');
  $('source').textContent=live?'● Notion conectado':hasAccess()?(loadError?'● Notion sin conectar':'● Cargando datos de Notion'):'● Datos de ejemplo';
  $('currency').textContent=currency==='EUR'?'EUR €':'USD $';
  if(hasAccess()&&!live&&tab!=='ajustes'){
    $('content').innerHTML=card(loadError?'No se pudieron cargar tus datos':'Cargando datos de Notion',empty(loadError?'Pulsa Sincronizar para volver a intentarlo o revisa la conexión en Ajustes.':'Tus cifras aparecerán al terminar la sincronización.'));
    return;
  }
  const result=monthly(withCash(),month,settings);
  const descriptions={resumen:'Ingresos, gastos y capacidad de ahorro.',facturas:'Emisión, vencimientos y ruta del dinero hasta Mercury.',comisiones:'Costes estimados de conversión y transferencia.',ahorros:'Saldos, evolución mensual y objetivos.',gastos:'Compara tus movimientos con el presupuesto del mes.',efectivo:'Saldo, dinero reservado y gastos en efectivo.',ajustes:'Configura el cambio, las comisiones y la sincronización.',mercury:'Transferencias abonadas en la cuenta.'};
  $('content').innerHTML='<div class="heading hero"><div><h1>'+(tabs[tab]||'Abonos en Mercury')+'</h1><p class="muted">'+descriptions[tab]+'</p></div>'+(tab==='ajustes'?'':'<label class="field">Periodo<input id="month" type="month" min="1900-01" max="9999-12" value="'+month+'"></label>')+'</div>'+({resumen:overview,facturas:invoices,comisiones:fees,ahorros:savings,gastos:expenses,efectivo:cashView,ajustes:options,mercury:deposits}[tab])(result);
}
function loadAccounts(){
  accounts=read('accounts.'+profile(),live?accountDefaults().map(a=>({...a,balance:0})):accountDefaults());
  goal=read('goal.'+profile(),25000);
  history=read('history.'+profile(),live?{}:demoHistory());
}
async function sync(manual=false){
  if(syncing)return;
  if(!hasAccess()){if(manual)setNotice('Introduce la clave del panel en Ajustes para conectar con Notion.');return}
  syncing=true;
  loadError=false;
  if(!live)view();
  $('sync').disabled=true;
  try{
    const response=await fetch('/.netlify/functions/notion',{headers:access?{Authorization:'Bearer '+access}:{},cache:'no-store'});
    const payload=await response.json();
    if(response.status===401&&remembered&&!access){remembered=false;write('remembered',false);live=false;data=demo(today);loadAccounts();}
    if(!response.ok)throw Error(payload.error||'No se pudo sincronizar.');
    const first=!live;
    sources=payload.sources;
    data=payload.data;
    for(const kind of ['movements','budgets'])if(!sources.includes(kind))data[kind]=read(kind+'.real',[]);
    live=true;
    if(first)loadAccounts();
    syncCloud();
    setNotice('Última sincronización · '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})+(payload.warnings.length?' · '+payload.warnings.join(' '):''));
    if(manual||first||!['#ajustes','#ahorros','#gastos','#mercury','#efectivo'].includes(location.hash)&&!document.querySelector('details[open] #mercuryTotal'))view();
  }catch(error){loadError=true;setNotice('Sincronización fallida · '+error.message);if(!live)view()}
  finally{syncing=false;$('sync').disabled=false}
}
function schedule(){
  clearInterval(timer);
  timer=setInterval(()=>{if(!document.hidden)sync()},settings.refresh*60000);
}
function collectAccounts(form){
  const fields=new FormData(form);
  return accounts.map((_,i)=>({name:String(fields.get('name'+i)).trim()||'Otros',balance:Number(fields.get('balance'+i)),currency:fields.get('unit'+i)}));
}
document.addEventListener('change',event=>{
  if(event.target.id==='importBackup')importBackup(event.target);
  if(event.target.id==='month' && event.target.validity.valid && event.target.value){month=event.target.value;view()}
  if(event.target.id==='invoice'){selected=event.target.value;view();$('invoice')?.focus()}
});
document.addEventListener('click',async event=>{
  const btn=event.target.closest('button');
  if(!btn)return;
  if(btn.id==='exportBackup')exportBackup();
  if(btn.id==='keepLocal'||btn.id==='keepCloud'){cloud.resolve(btn.id==='keepLocal');syncCloud()}
  if(btn.id==='currency'){currency=currency==='EUR'?'USD':'EUR';save('currency',currency);view()}
  if(btn.id==='theme'){const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';save('dark',dark)}
  if(btn.id==='sync')await sync(true);
  if(btn.dataset.cashSpend!==undefined){const form=$('cash');form.elements.type.value='expense';form.elements.category.value=btn.dataset.cashSpend;form.elements.amount.focus()}
  if(btn.dataset.cashRemove){
    const rows=cashRows().filter(row=>row.id!==btn.dataset.cashRemove);
    if(adjustedBalance(accounts[0],0)-(imaginDeposits()-sum(rows.filter(row=>row.type==='imagin'),row=>row.cents)/100)<-.005||!validCash(rows)){setNotice('Quita primero los movimientos que usan ese dinero.');return}
    save('cash.'+profile(),rows);setNotice('Movimiento eliminado.');view();
  }
  if(btn.dataset.depositRemove&&live){save('mercuryDeposits.real',mercuryDeposits().filter(row=>row.id!==btn.dataset.depositRemove));view()}
  if(btn.dataset.removeKind && live && !sources.includes(btn.dataset.removeKind)){
    const kind=btn.dataset.removeKind;
    data[kind]=data[kind].filter(row=>row.id!==btn.dataset.id);
    save(kind+'.real',data[kind]);view();
  }
  if(btn.id==='disconnect'){
    if(syncing||authBusy)return;
    authBusy=true;
    try{
      if(remembered){
        const response=await fetch('/.netlify/functions/panel-session',{method:'DELETE'});
        if(!response.ok)throw Error();
      }
      remembered=false;write('remembered',false);
      access='';sessionStorage.removeItem('margen.access');$('cloudNotice').textContent='';live=false;data=demo(today);loadAccounts();setNotice('Sesión cerrada.');view();
    }catch{setNotice('No se pudo cerrar la sesión. Vuelve a intentarlo.')}
    finally{authBusy=false}
  }
  if(btn.dataset.invoice){selected=btn.dataset.invoice;view();$('invoice')?.focus()}
  if(btn.id==='add'||btn.dataset.remove!==undefined){
    accounts=collectAccounts($('accounts'));
    if(btn.id==='add')accounts.push({name:'Otros',balance:0,currency:'EUR'});
    else accounts.splice(Number(btn.dataset.remove),1);
    view();
  }
  if(btn.id==='rate'){
    btn.disabled=true;
    try{
      const response=await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD',{signal:AbortSignal.timeout(8000)});
      const quote=await response.json();
      if(!response.ok||!Number.isFinite(quote.rates?.USD)||quote.rates.USD<=0)throw Error();
      const input=$('settings')?.elements.rate;
      if(input){input.value=quote.rates.USD;setNotice('Tipo de referencia del '+quote.date+'. Pulsa Guardar ajustes para aplicarlo.')}
    }catch{setNotice('Frankfurter no está disponible. Puedes introducir el cambio manualmente.')}
    finally{btn.disabled=false}
  }
});
document.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.target, fields=new FormData(form);
  if(['movements','budgets'].includes(form.id) && live && !sources.includes(form.id)){
    const kind=form.id, category=String(fields.get('category')).trim(), amount=Number(fields.get('amount'));
    if(!category)return;
    const spending=kind==='movements';
    const date=String(fields.get('date')??'');
    const row={id:crypto.randomUUID(),category,amount,...(spending?{date,currency:fields.get('expenseCurrency')}:{month})};
    if(!spending)data[kind]=data[kind].filter(item=>item.month!==month||item.category!==category);
    data[kind].push(row);save(kind+'.real',data[kind]);
    if(spending)month=monthOf(date);
    view();
  }
  if(form.dataset.saving!==undefined){
    const index=Number(form.dataset.saving), cents=Math.round(Number(fields.get('amount'))*100);
    if(!Number.isSafeInteger(cents)||cents<=0)return;
    const delta=event.submitter?.value==='subtract'?-cents:cents;
    if(Math.round(adjustedBalance(accounts[index],index)*100)+delta<0){setNotice('El importe supera el ahorro disponible.');return}
    const adjustments=savingAdjustments();
    adjustments[index]+=delta;
    save('savingAdjustments.'+profile(),adjustments);
    history[monthOf(localDay())]=savingTotal();
    save('history.'+profile(),history);setNotice('Ahorro actualizado.');view();
  }
  if(form.id==='cash'){
    const type=String(fields.get('type')),currency='EUR',date=String(fields.get('date'));
    const category=['deposit','imagin'].includes(type)?'':String(fields.get('category')).trim();
    if((type==='allocate'||type==='release')&&!category){setNotice('Indica la categoría.');return}
    const cents=Math.round(Number(fields.get('amount'))*100);
    if(!Number.isSafeInteger(cents)||cents<=0)return;
    const rows=[...cashRows(),{id:crypto.randomUUID(),type,currency,date,category,cents,note:String(fields.get('note')).trim()}];
    if(!validCash(rows)){setNotice('Saldo insuficiente en esa categoría o en el efectivo sin asignar para esa fecha.');return}
    save('cash.'+profile(),rows);month=monthOf(date);setNotice('Movimiento guardado.');view();
  }
  if(form.id==='mercuryDeposit' &&live){
    const date=String(fields.get('date')), usd=Number(fields.get('usd')), note=String(fields.get('note')).trim();
    save('mercuryDeposits.real',[...mercuryDeposits(),{id:crypto.randomUUID(),date,usd,note}]);
    month=monthOf(date);setNotice('Abono en Mercury guardado.');view();
  }
  if(form.id==='settings'){settings=Object.fromEntries(settingsFields.map(([key])=>[key,Number(fields.get(key))]));save('settings',settings);schedule();setNotice('Ajustes guardados.');view()}
  if(form.id==='mercuryTotal'){save('mercuryTotal.'+profile(),{usd:Number(fields.get('usd')),date:localDay()});setNotice('Saldo total de Mercury guardado.');view()}
  if(form.id==='accounts'){
    const next=collectAccounts(form);
    if(next.slice(0,2).some((a,i)=>adjustedBalance(a,i)<-.005)){setNotice('El saldo base dejaría un ahorro negativo.');return}
    accounts=next;
    history[month]=savingTotal();
    save('accounts.'+profile(),accounts);save('history.'+profile(),history);
    setNotice('Saldos guardados para '+labelMonth(month)+'.');view();
  }
  if(form.id==='goal'){goal=Number(fields.get('goal'));save('goal.'+profile(),goal);setNotice('Objetivo guardado.');view()}
  if(form.id==='access'){
    if(syncing||authBusy)return;
    authBusy=true;
    try{
      const key=String(fields.get('access')).trim();
      const keep=fields.has('remember');
      if(keep||remembered){
        const response=await fetch('/.netlify/functions/panel-session',{method:keep?'POST':'DELETE',headers:keep?{Authorization:'Bearer '+key}:{}});
        if(!response.ok)throw Error(response.status===401?'Clave del panel incorrecta.':'No se pudo actualizar la sesión.');
      }
      remembered=keep;write('remembered',keep);
      access=keep?'':key;
      if(keep)sessionStorage.removeItem('margen.access');
      else sessionStorage.setItem('margen.access',access);
      form.reset();
      await sync(true);
    }catch(error){setNotice(error.message)}
    finally{authBusy=false}
  }
});
window.addEventListener('hashchange',view);
document.documentElement.dataset.theme=read('dark',false)?'dark':'light';
view();schedule();sync();
setInterval(syncCloud,15000);
window.addEventListener('online',syncCloud);
document.addEventListener('visibilitychange',syncCloud);
