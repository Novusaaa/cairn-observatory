import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const resolved=path.resolve(root,filename);if(!resolved.startsWith(root)){res.writeHead(403);res.end();return}const data=await readFile(resolved);res.writeHead(200,{'Content-Type':mime[path.extname(resolved)]??'application/octet-stream','Cache-Control':'no-cache'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}
});
const port=Number(process.env.PORT??4173);server.listen(port,'127.0.0.1',()=>console.log(`Cairn · Local: http://127.0.0.1:${port}`));
