import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.js";
import { createApi } from "../src/api.js";

function fixture() {
  const db=openDatabase(":memory:");
  const api=createApi(db);
  const call=(method,path,body={})=>api.handle(method,path,body);
  return {db,api,call};
}

test("health, menu and inventory return fresh seeded data",()=>{
  const {db,call}=fixture();
  try {
    assert.equal(call("GET","/api/health").body.app,"Freshscale ResApp");
    assert.equal(call("GET","/api/menu").body.length,8);
    assert.equal(call("GET","/api/inventory").body.items.length,14);
    assert.equal(call("GET","/api/state").body.metrics.low_stock,3);
  } finally { db.close(); }
});

test("creating an order consumes recipe ingredients once and returns same order for repeated id",()=>{
  const {db,call}=fixture();
  try {
    const before=call("GET","/api/inventory").body.items.find(i=>i.name==="Rice & dal batter").quantity;
    const body={id:"TEST-ORDER-1",order_type:"Dine in",table_name:"T01",items:[{menu_item_id:1,quantity:2}]};
    const created=call("POST","/api/orders",body);
    assert.equal(created.status,201);
    assert.equal(created.body.status,"New");
    assert.equal(created.body.total,180);
    const after=call("GET","/api/inventory").body.items.find(i=>i.name==="Rice & dal batter").quantity;
    assert.equal(after,Math.round((before-.5)*100)/100);
    assert.equal(call("POST","/api/orders",body).body.id,"TEST-ORDER-1");
    assert.equal(call("GET","/api/inventory").body.items.find(i=>i.name==="Rice & dal batter").quantity,after);
  } finally { db.close(); }
});

test("order stock deduction rolls back if any recipe ingredient is short",()=>{
  const {db,call}=fixture();
  try {
    const potato=db.prepare("SELECT quantity FROM ingredients WHERE name='Potato'").get().quantity;
    db.prepare("UPDATE ingredients SET quantity=0 WHERE name='Potato'").run();
    const result=call("POST","/api/orders",{id:"NO-STOCK",order_type:"Takeaway",items:[{menu_item_id:1,quantity:1}]});
    assert.equal(result.status,409);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE id='NO-STOCK'").get().n,0);
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE name='Rice & dal batter'").get().quantity,8);
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE name='Potato'").get().quantity,0);
    assert.ok(potato>0);
  } finally { db.close(); }
});

test("only valid kitchen transitions are accepted and cancellation restores stock",()=>{
  const {db,call}=fixture();
  try {
    const before=db.prepare("SELECT quantity FROM ingredients WHERE name='Chicken'").get().quantity;
    call("POST","/api/orders",{id:"CANCEL-ME",order_type:"Takeaway",items:[{menu_item_id:7,quantity:1}]});
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE name='Chicken'").get().quantity,Math.round((before-.2)*100)/100);
    assert.equal(call("PATCH","/api/orders/CANCEL-ME/status",{status:"Cancelled"}).body.status,"Cancelled");
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE name='Chicken'").get().quantity,before);
    assert.equal(call("PATCH","/api/orders/CANCEL-ME/status",{status:"Paid"}).status,409);
    assert.equal(call("PATCH","/api/orders/missing/status",{status:"Ready"}).status,404);
  } finally { db.close(); }
});

test("purchase receiving updates inventory once and rejects empty purchase lines",()=>{
  const {db,call}=fixture();
  try {
    assert.equal(call("POST","/api/purchases",{supplier:"Test supplier",items:[]}).status,400);
    const created=call("POST","/api/purchases",{id:"PO-TEST",supplier:"Test supplier",items:[{ingredient_id:1,quantity:4,unit_cost:100}]});
    assert.equal(created.status,201);
    const before=db.prepare("SELECT quantity FROM ingredients WHERE id=1").get().quantity;
    assert.equal(call("POST","/api/purchases/PO-TEST/receive").body.status,"Received");
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE id=1").get().quantity,before+4);
    call("POST","/api/purchases/PO-TEST/receive");
    assert.equal(db.prepare("SELECT quantity FROM ingredients WHERE id=1").get().quantity,before+4);
  } finally { db.close(); }
});

test("manual inventory adjustments reject negative stock",()=>{
  const {db,call}=fixture();
  try {
    const result=call("POST","/api/inventory/3/adjust",{delta:-999,note:"test"});
    assert.equal(result.status,409);
    assert.equal(call("POST","/api/inventory/3/adjust",{delta:1,note:"count correction"}).status,200);
  } finally { db.close(); }
});
