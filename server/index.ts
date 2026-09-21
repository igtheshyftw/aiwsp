import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as workspace from '../app/api/workspace/route';
import * as attachment from '../app/api/attachment/route';
import {initializeWorkspace,publicOrigin} from '../lib/server';
import {closeDatabase} from './storage';

await initializeWorkspace();
const assets=fileURLToPath(new URL('./client/',import.meta.url));
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/',publicOrigin);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return}
  if(url.pathname.startsWith('/api/')){
   const route=url.pathname==='/api/workspace'?workspace:url.pathname==='/api/attachment'?attachment:null;
   if(!route){res.writeHead(404);res.end();return}
   if(req.method!=='GET'&&req.method!=='POST'){res.writeHead(405,{Allow:'GET, POST'});res.end();return}
   const limit=url.pathname==='/api/attachment'?11_000_000:100_000;
   if(Number(req.headers['content-length']||0)>limit){res.writeHead(413);res.end('Request too large');return}
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(v&&!k.startsWith('oai-')&&!k.startsWith('cf-'))headers.set(k,Array.isArray(v)?v.join(','):v)}
   headers.set('cf-connecting-ip',req.socket.remoteAddress||'visitor');
   const request=new Request(new URL(url.pathname+url.search,publicOrigin),{method:req.method,headers,...(req.method==='POST'?{body:new Uint8Array(Buffer.concat(chunks))}:{})});
   const result=await route[req.method as 'GET'|'POST'](request);
   res.statusCode=result.status;result.headers.forEach((value,key)=>res.setHeader(key,value));
   res.end(Buffer.from(await result.arrayBuffer()));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  const decoded=decodeURIComponent(url.pathname);const path=resolve(assets,'.'+decoded);
  if(path!==resolve(assets)&&!path.startsWith(resolve(assets)+sep)){res.writeHead(404);res.end();return}
  let target=path;
  try{if(!(await stat(target)).isFile())target=resolve(assets,'index.html')}catch{if(extname(decoded)){res.writeHead(404);res.end();return}target=resolve(assets,'index.html')}
  res.setHeader('Content-Type',mime[extname(target)]||'application/octet-stream');
  res.setHeader('Cache-Control',target.includes(sep+'assets'+sep)?'public, max-age=31536000, immutable':'no-cache');
  const bytes=await readFile(target);res.writeHead(200);res.end(req.method==='HEAD'?undefined:bytes);
 }catch(error){console.error('Request failed:',error instanceof Error?error.message:'Unknown error');if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"Unable to complete the request."}')}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('AiWSP listening on port '+(process.env.PORT||3000)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{closeDatabase();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()});
