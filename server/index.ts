import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import './db';
import {api,upload,download} from './api';
import {initialize,publicOrigin} from './auth';
import {closeDatabase} from './storage';
import {startJobs} from './jobs';
import {startDelivery} from './outbox';

await initialize();
if(process.env.DISABLE_JOBS!=='1')startJobs();
startDelivery();
const assets=fileURLToPath(new URL('./client/',import.meta.url));
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url||'/',publicOrigin);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return}
  if(url.pathname.startsWith('/api/')){
   const handler=url.pathname==='/api/ims'&&req.method==='POST'?api:url.pathname==='/api/upload'&&req.method==='POST'?upload:url.pathname==='/api/file'&&req.method==='GET'?download:null;
   if(!handler){res.writeHead(404);res.end();return}
   const limit=url.pathname==='/api/upload'?11_000_000:200_000;
   if(Number(req.headers['content-length']||0)>limit){res.writeHead(413);res.end('Request too large');return}
   const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(v&&!k.startsWith('oai-')&&!k.startsWith('cf-'))headers.set(k,Array.isArray(v)?v.join(','):v)}
   headers.set('x-client-ip',req.socket.remoteAddress||'visitor');
   const request=new Request(new URL(url.pathname+url.search,publicOrigin),{method:req.method,headers,...(req.method==='POST'?{body:new Uint8Array(Buffer.concat(chunks))}:{})});
   const result=await handler(request);
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
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('IMS listening on port '+(process.env.PORT||3000)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{closeDatabase();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()});
