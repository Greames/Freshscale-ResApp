import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./src/db.js";
import { createApi } from "./src/api.js";

const ROOT = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon" };
const MAX_BODY = 1024 * 1024;

async function readJson(req) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body exceeds 1 MB"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 }); }
}
function sendJson(res,status,body) {
  res.writeHead(status, { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff" });
  res.end(JSON.stringify(body));
}
function makeServer(db) {
  const api=createApi(db);
  return http.createServer(async(req,res)=>{
    const url=new URL(req.url||"/","http://localhost");
    if(url.pathname.startsWith("/api/")) {
      let body={};
      try { if(!["GET","HEAD"].includes(req.method||"GET")) body=await readJson(req); }
      catch(error) { sendJson(res,error.status||400,{error:error.message});return; }
      const result=api.handle(req.method||"GET",url.pathname,body);
      sendJson(res,result.status,result.body);
      return;
    }
    if(!["GET","HEAD"].includes(req.method||"GET")) { res.writeHead(405,{"content-type":"text/plain; charset=utf-8","allow":"GET, HEAD"});res.end("Method not allowed");return; }
    let pathname;
    try { pathname=decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname); }
    catch { res.writeHead(400);res.end("Bad path");return; }
    const file=resolve(ROOT,"."+pathname);
    if(file!==ROOT&&!file.startsWith(ROOT+sep)){res.writeHead(403);res.end("Forbidden");return;}
    try {
      const data=await readFile(file);
      res.writeHead(200,{"content-type":TYPES[extname(file)]||"application/octet-stream","x-content-type-options":"nosniff","cache-control":extname(file)===".html"?"no-cache":"public, max-age=300"});
      res.end(req.method==="HEAD"?undefined:data);
    } catch {
      res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});
      res.end("Not found");
    }
  });
}
export async function start({port=Number(process.env.PORT||3000),dbFile=process.env.DB_PATH||"./data/freshscale.sqlite"}={}) {
  const db=openDatabase(dbFile), server=makeServer(db);
  await new Promise((resolvePromise,reject)=>{server.once("error",reject);server.listen(port,"0.0.0.0",resolvePromise);});
  return {server,db};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const {server}=await start();
  console.log(`Freshscale ResApp listening on port ${server.address().port}`);
}
