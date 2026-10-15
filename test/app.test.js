import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
const readme=await readFile(new URL("../README.md",import.meta.url),"utf8");
test("Freshscale app has independent branding",()=>{assert.match(html,/Freshscale ResApp/);assert.doesNotMatch(html,/Spice Route|ResApp dashboard/);});
test("restaurant workspaces are present",()=>{for(const s of ['function pos()','function kitchen()','function tables()','function inventory()','function purchasing()','function team()','function reports()'])assert.ok(html.includes(s),s);});
test("prototype limits are documented",()=>{assert.match(readme,/not production-ready/i);assert.match(readme,/authentication/i);});
