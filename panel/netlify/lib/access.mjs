import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const name='__Host-margen_session';
const lifetime=30*24*60*60;
const digest=value=>createHash('sha256').update(value).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
const sign=(payload,key)=>createHmac('sha256',key).update('margen-session-v1:'+payload).digest('base64url');
const attributes='Path=/; HttpOnly; Secure; SameSite=Strict';
export const clearSession=()=>name+'=; Max-Age=0; '+attributes;
export const validKey=key=>typeof key==='string'&&key.length>=24;
export function sessionCookie(key){
  const payload=(Math.floor(Date.now()/1000)+lifetime)+'.'+randomBytes(18).toString('base64url');
  return name+'='+payload+'.'+sign(payload,key)+'; Max-Age='+lifetime+'; '+attributes;
}
export function authorized(authorization,cookie,key){
  if(!validKey(key))return false;
  if(authorization)return equal(authorization,'Bearer '+key);
  const value=(cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(name+'='))?.slice(name.length+1);
  const match=value?.match(/^(\d{10,12})\.([\w-]{24})\.([\w-]{43})$/);
  if(!match||Number(match[1])<=Math.floor(Date.now()/1000))return false;
  return equal(match[3],sign(match[1]+'.'+match[2],key));
}
