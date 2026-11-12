import {authorized,clearSession,sessionCookie,validKey} from '../lib/access.mjs';

export default async function handler(request){
  const reply=(status,cookie)=>new Response(null,{status,headers:{'Cache-Control':'private, no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
  if(request.method==='DELETE')return reply(204,clearSession());
  if(request.method!=='POST')return reply(405);
  const key=process.env.DASHBOARD_ACCESS_KEY;
  if(!validKey(key))return reply(503);
  const header=request.headers.get('authorization');
  if(!header||!authorized(header,null,key))return reply(401);
  return reply(204,sessionCookie(key));
}
