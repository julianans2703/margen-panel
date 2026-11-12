export const defaults = {rate:1.12, conversion:1.2, conversionFixed:0, transfer:0.35, transferFixed:3, tax:20, refresh:5};
export const sum = (rows, fn) => rows.reduce((total,row) => total + fn(row),0);
export const monthOf = date => date?.slice(0,7);
export const localDay = () => new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Madrid'}).format(new Date());
export function shift(month, by) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year,number-1+by,1)).toISOString().slice(0,7);
}
export function simulate(eur, settings) {
  const round = n => Math.round((n+Number.EPSILON)*100)/100;
  const gross = round(eur*settings.rate);
  const conversion = round(Math.min(gross,gross*settings.conversion/100+settings.conversionFixed));
  const available = round(gross-conversion);
  const transfer = round(Math.min(available,available*settings.transfer/100+settings.transferFixed));
  const net = round(available-transfer);
  return {gross,conversion,transfer,net,eur:net/settings.rate,lost:gross ? (gross-net)/gross*100 : 0};
}
export const status = (invoice, today = localDay()) => invoice.paid || invoice.settled ? 'Cobrada' : (invoice.late || (invoice.due && invoice.due < today)) ? 'Retrasada' : 'Pendiente';
export function monthly(data, month, settings) {
  const issued = data.invoices.filter(i => (i.month || monthOf(i.issued)) === month);
  const paid = data.invoices.filter(i => monthOf(i.paid) === month);
  const billed = sum(issued,i=>i.amount);
  const pending = sum(issued.filter(i=>status(i)!=='Cobrada'),i=>i.amount);
  const received = sum(paid,i=>quote(i,data.invoices,settings).eur);
  const fees = sum(paid,i=>{const s=quote(i,data.invoices,settings);return (s.conversion+s.transfer)/settings.rate});
  const movements = data.movements.filter(i=>monthOf(i.date)===month);
  const spent = sum(movements,i=>i.currency==='USD'?i.amount/settings.rate:i.amount);
  return {billed,pending,received,fees,spent,balance:received-spent,paid,issued,movements};
}
export function demo(today) {
  const current=monthOf(today), invoices=[], movements=[], budgets=[];
  const categories=[['Vivienda',1050],['Alimentación',475],['Transporte',220],['Ocio',320],['Servicios',190]];
  for(let i=-5;i<=0;i++){
    const m=shift(current,i);
    const amounts=[2900+i*110,1850+(i%3)*120,1450+i*85];
    for(const [j,client] of ['Estudio Norte','Forma Digital','Casa Atlántica'].entries()){
      const issued=m+'-01', paid=i<0 || j===0 ? m+'-02' : null;
      invoices.push({id:m+j,client,issued,paid,due:j===1?m+'-01':shift(m,1)+'-12',amount:amounts[j]});
    }
    categories.forEach(([category,amount],j)=>{
      budgets.push({category,month:m,amount});
      movements.push({category,date:m+'-01',amount:Math.round(amount*(.78+((i+j+9)%5)*.08))});
    });
  }
  invoices[0].batch=invoices[1].batch='demo-lote-1';
  return {invoices,movements,budgets};
}
export function quote(invoice, invoices, settings) {
  const result=simulate(invoice.amount,settings);
  const group=invoice.batch ? invoices.filter(i=>i.batch===invoice.batch) : [invoice];
  if(group.length<2) return result;
  const available=sum(group,i=>{const q=simulate(i.amount,settings);return q.gross-q.conversion});
  const totalFee=Math.round(Math.min(available,available*settings.transfer/100+settings.transferFixed)*100);
  const sorted=[...group].sort((a,b)=>a.id.localeCompare(b.id));
  let running=0;
  for(const row of sorted){
    const q=simulate(row.amount,settings);
    const before=available ? Math.round(running/available*totalFee) : 0;
    running+=q.gross-q.conversion;
    if(row.id===invoice.id){
      const transfer=(available ? Math.round(running/available*totalFee)-before : 0)/100;
      const net=Math.round((result.gross-result.conversion-transfer)*100)/100;
      return {...result,transfer,net,eur:net/settings.rate,lost:result.gross?(result.gross-net)/result.gross*100:0};
    }
  }
  return result;
}
