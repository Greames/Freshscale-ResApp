import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const root=join(fileURLToPath(new URL(".",import.meta.url)),"public");
const port=Number(process.env.PORT||3000);
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8"};
export const server=http.createServer(async(req,res)=>{const url=new URL(req.url||"/","http://localhost");if(url.pathname==="/api/health"){res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify({status:"ok",app:"Freshscale ResApp",mode:"prototype"}));return;}const path=url.pathname==="/"?"/index.html":decodeURIComponent(url.pathname);const file=join(root,normalize(path).replace(/^([.][.][/\\\\])+/, ""));if(!file.startsWith(root)){res.writeHead(403);res.end("Forbidden");return;}try{const data=await readFile(file);res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream","x-content-type-options":"nosniff"});res.end(data);}catch{res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});res.end("Not found");}});
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])server.listen(port,"0.0.0.0",()=>console.log(`Freshscale ResApp on http://localhost:${port}`));
