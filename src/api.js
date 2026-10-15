import { randomUUID } from "node:crypto";
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const cleanText = (v, max = 120) => typeof v === "string" ? v.trim().slice(0, max) : "";
const fail = (status, message) => ({ status, body: { error: message } });
const ok = (body, status = 200) => ({ status, body });
function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function menuItem(db, row) {
  const recipe = db.prepare(`SELECT i.id AS ingredient_id,i.name AS ingredient_name,i.unit,r.quantity
    FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.menu_item_id=? ORDER BY i.name`).all(row.id);
  return { ...row, active: Boolean(row.active), recipe };
}
function getOrder(db, id) {
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if (!row) return null;
  const items = db.prepare(`SELECT oi.menu_item_id,m.name,m.emoji,oi.quantity,oi.unit_price
    FROM order_items oi JOIN menu_items m ON m.id=oi.menu_item_id WHERE oi.order_id=? ORDER BY m.name`).all(id);
  return { ...row, items };
}
function inventory(db) {
  return db.prepare(`SELECT i.id,i.name,i.unit,i.quantity,i.minimum_quantity,i.unit_cost,
    ROUND(i.quantity*i.unit_cost,2) AS stock_value,
    CASE WHEN i.quantity<i.minimum_quantity THEN 'Low stock' ELSE 'In stock' END AS status
    FROM ingredients i ORDER BY i.name`).all();
}
function adjustStock(db, id, delta, note, movementType = "adjustment") {
  const item = db.prepare("SELECT * FROM ingredients WHERE id=?").get(id);
  if (!item) throw new Error("Ingredient not found");
  const next = round2(item.quantity + delta);
  if (next < 0) throw new Error(`Insufficient stock for ${item.name}; available ${item.quantity} ${item.unit}`);
  db.prepare("UPDATE ingredients SET quantity=? WHERE id=?").run(next, id);
  db.prepare("INSERT INTO stock_movements(id,ingredient_id,movement_type,quantity_delta,note) VALUES(?,?,?,?,?)")
    .run(randomUUID(), id, movementType, delta, note);
}
function createOrder(db, body) {
  const orderType = ["Dine in","Takeaway","Delivery"].includes(body.order_type) ? body.order_type : null;
  const tableName = cleanText(body.table_name || (orderType === "Dine in" ? "" : orderType), 32);
  if (!orderType) throw new Error("order_type must be Dine in, Takeaway, or Delivery");
  if (!tableName) throw new Error("table_name is required for dine-in orders");
  if (!Array.isArray(body.items) || !body.items.length) throw new Error("At least one order item is required");
  const grouped = new Map();
  for (const item of body.items) {
    const id = Number(item.menu_item_id), qty = Number(item.quantity);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1 || qty > 500) throw new Error("Each item needs a valid menu_item_id and positive integer quantity");
    grouped.set(id, (grouped.get(id) || 0) + qty);
  }
  return withTransaction(db, () => {
    const id = cleanText(body.id, 80) || `FS-${randomUUID().slice(0, 8).toUpperCase()}`;
    const existing = getOrder(db, id);
    if (existing) return existing;
    const lines = [...grouped].map(([menuId, quantity]) => {
      const item = db.prepare("SELECT * FROM menu_items WHERE id=? AND active=1").get(menuId);
      if (!item) throw new Error(`Menu item ${menuId} was not found or is inactive`);
      return { ...item, quantity };
    });
    const subtotal = round2(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
    const tax = 0; // Tax rules are intentionally not inferred; configure them before issuing real invoices.
    db.prepare("INSERT INTO orders(id,order_type,table_name,status,subtotal,tax,total) VALUES(?,?,?,'New',?,?,?)")
      .run(id, orderType, tableName, subtotal, tax, round2(subtotal + tax));
    const insertLine = db.prepare("INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price) VALUES(?,?,?,?)");
    const recipeRows = db.prepare("SELECT ingredient_id,quantity FROM recipes WHERE menu_item_id=?");
    const required = new Map();
    for (const line of lines) {
      insertLine.run(id, line.id, line.quantity, line.price);
      for (const recipe of recipeRows.all(line.id)) required.set(recipe.ingredient_id, (required.get(recipe.ingredient_id) || 0) + recipe.quantity * line.quantity);
    }
    for (const [ingredientId, rawUsed] of required) {
      const ingredient = db.prepare("SELECT * FROM ingredients WHERE id=?").get(ingredientId);
      const used = round2(rawUsed), remaining = round2(ingredient.quantity - used);
      if (remaining < 0) throw new Error(`Insufficient stock for ${ingredient.name}; need ${used} ${ingredient.unit}, have ${ingredient.quantity} ${ingredient.unit}`);
      db.prepare("UPDATE ingredients SET quantity=? WHERE id=?").run(remaining, ingredient.id);
      db.prepare("INSERT INTO stock_movements(id,ingredient_id,order_id,movement_type,quantity_delta,note) VALUES(?,?,?,'sale',?,?)")
        .run(randomUUID(), ingredient.id, id, -used, `Consumed for order ${id}`);
    }
    return getOrder(db, id);
  });
}
function cancelOrder(db, id) {
  return withTransaction(db, () => {
    const order = getOrder(db, id);
    if (!order) throw new Error("Order not found");
    if (order.status === "Cancelled") return order;
    if (order.status !== "New") throw new Error("Only new orders can be cancelled");
    const movements = db.prepare("SELECT * FROM stock_movements WHERE order_id=? AND movement_type='sale'").all(id);
    for (const move of movements) {
      const ingredient = db.prepare("SELECT quantity FROM ingredients WHERE id=?").get(move.ingredient_id);
      db.prepare("UPDATE ingredients SET quantity=? WHERE id=?").run(round2(ingredient.quantity - move.quantity_delta), move.ingredient_id);
      db.prepare("INSERT INTO stock_movements(id,ingredient_id,order_id,movement_type,quantity_delta,note) VALUES(?,?,?,'sale_reversal',?,?)")
        .run(randomUUID(), move.ingredient_id, id, -move.quantity_delta, `Reversed cancelled order ${id}`);
    }
    db.prepare("UPDATE orders SET status='Cancelled' WHERE id=?").run(id);
    return getOrder(db, id);
  });
}
function receivePurchase(db, id) {
  return withTransaction(db, () => {
    const purchase = db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id);
    if (!purchase) throw new Error("Purchase order not found");
    if (purchase.status === "Received") return purchase;
    const items = db.prepare("SELECT * FROM purchase_items WHERE purchase_id=?").all(id);
    if (!items.length) throw new Error("Add purchase items before receiving this order");
    for (const item of items) {
      const ingredient = db.prepare("SELECT quantity FROM ingredients WHERE id=?").get(item.ingredient_id);
      db.prepare("UPDATE ingredients SET quantity=?,unit_cost=? WHERE id=?").run(round2(ingredient.quantity + item.quantity), item.unit_cost, item.ingredient_id);
      db.prepare("INSERT INTO stock_movements(id,ingredient_id,movement_type,quantity_delta,note) VALUES(?,?, 'purchase_receipt',?,?)")
        .run(randomUUID(), item.ingredient_id, item.quantity, `Received purchase ${id}`);
    }
    db.prepare("UPDATE purchase_orders SET status='Received',received_at=datetime('now') WHERE id=?").run(id);
    return db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id);
  });
}
export function createApi(db) {
  return {
    handle(method, pathname, body = {}) {
      try {
        if (method === "GET" && pathname === "/api/health") return ok({ status: "ok", app: "Freshscale ResApp", mode: "api" });
        if (method === "GET" && pathname === "/api/state") return ok({
          menu: db.prepare("SELECT * FROM menu_items WHERE active=1 ORDER BY category,name").all().map(row => menuItem(db,row)),
          inventory: inventory(db),
          orders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").all().map(row => getOrder(db,row.id)),
          purchases: db.prepare("SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 100").all(),
          metrics: { open_orders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('Paid','Cancelled')").get().n, low_stock: db.prepare("SELECT COUNT(*) AS n FROM ingredients WHERE quantity<minimum_quantity").get().n }
        });
        if (method === "GET" && pathname === "/api/menu") return ok(db.prepare("SELECT * FROM menu_items WHERE active=1 ORDER BY category,name").all().map(row => menuItem(db,row)));
        if (method === "POST" && pathname === "/api/menu") {
          const name=cleanText(body.name,120), category=cleanText(body.category,60), price=Number(body.price);
          if (!name || !category || !Number.isFinite(price) || price<0) return fail(400,"name, category and a non-negative price are required");
          const result=db.prepare("INSERT INTO menu_items(name,category,price,emoji,description) VALUES(?,?,?,?,?)").run(name,category,price,cleanText(body.emoji,12)||"🍽️",cleanText(body.description,300));
          return ok(menuItem(db,db.prepare("SELECT * FROM menu_items WHERE id=?").get(Number(result.lastInsertRowid))),201);
        }
        const menuMatch=pathname.match(/^\/api\/menu\/(\d+)$/);
        if (method==="PATCH" && menuMatch) {
          const id=Number(menuMatch[1]), old=db.prepare("SELECT * FROM menu_items WHERE id=?").get(id);
          if(!old)return fail(404,"Menu item not found");
          const name=body.name===undefined?old.name:cleanText(body.name,120), category=body.category===undefined?old.category:cleanText(body.category,60), price=body.price===undefined?old.price:Number(body.price);
          if(!name||!category||!Number.isFinite(price)||price<0)return fail(400,"Invalid menu item fields");
          db.prepare("UPDATE menu_items SET name=?,category=?,price=?,emoji=?,description=?,active=? WHERE id=?").run(name,category,price,body.emoji===undefined?old.emoji:cleanText(body.emoji,12),body.description===undefined?old.description:cleanText(body.description,300),body.active===undefined?old.active:(body.active?1:0),id);
          return ok(menuItem(db,db.prepare("SELECT * FROM menu_items WHERE id=?").get(id)));
        }
        if (method === "GET" && pathname === "/api/inventory") return ok({ items: inventory(db) });
        const stockMatch=pathname.match(/^\/api\/inventory\/(\d+)\/adjust$/);
        if(method==="POST"&&stockMatch){
          const delta=Number(body.delta),note=cleanText(body.note,200);
          if(!Number.isFinite(delta)||delta===0)return fail(400,"delta must be a non-zero number");
          withTransaction(db,()=>adjustStock(db,Number(stockMatch[1]),delta,note||"Manual adjustment"));
          return ok(inventory(db).find(row=>row.id===Number(stockMatch[1])));
        }
        if (method === "GET" && pathname === "/api/orders") return ok(db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all().map(row=>getOrder(db,row.id)));
        if (method === "POST" && pathname === "/api/orders") return ok(createOrder(db,body),201);
        const orderMatch=pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
        if(method==="PATCH"&&orderMatch){
          const id=decodeURIComponent(orderMatch[1]),status=cleanText(body.status,20);
          if(!["New","Preparing","Ready","Paid","Cancelled"].includes(status))return fail(400,"Invalid order status");
          const existing=getOrder(db,id);if(!existing)return fail(404,"Order not found");
          if(status==="Cancelled")return ok(cancelOrder(db,id));
          if(existing.status==="Cancelled"||existing.status==="Paid")return fail(409,"A completed or cancelled order cannot change status");
          const transitions={New:["Preparing"],Preparing:["Ready"],Ready:["Paid"]};
          if(!transitions[existing.status]?.includes(status))return fail(409,`Cannot change order from ${existing.status} to ${status}`);
          db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,id);
          return ok(getOrder(db,id));
        }
        if(method==="GET"&&pathname==="/api/purchases")return ok(db.prepare("SELECT * FROM purchase_orders ORDER BY created_at DESC").all());
        if(method==="POST"&&pathname==="/api/purchases"){
          const supplier=cleanText(body.supplier,120);
          if(!supplier||!Array.isArray(body.items)||!body.items.length)return fail(400,"supplier and at least one purchase item are required");
          const id=cleanText(body.id,80)||`PO-${randomUUID().slice(0,8).toUpperCase()}`;
          const result=withTransaction(db,()=>{
            let amount=0;
            const lines=body.items.map(line=>{const ingredientId=Number(line.ingredient_id),quantity=Number(line.quantity),unitCost=Number(line.unit_cost);if(!Number.isInteger(ingredientId)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitCost)||unitCost<0)throw new Error("Invalid purchase line");if(!db.prepare("SELECT id FROM ingredients WHERE id=?").get(ingredientId))throw new Error("Ingredient not found");amount+=quantity*unitCost;return {ingredientId,quantity,unitCost};});
            db.prepare("INSERT INTO purchase_orders(id,supplier,status,amount) VALUES(?,?,'Awaiting approval',?)").run(id,supplier,round2(amount));
            const insert=db.prepare("INSERT INTO purchase_items(purchase_id,ingredient_id,quantity,unit_cost) VALUES(?,?,?,?)");
            lines.forEach(line=>insert.run(id,line.ingredientId,line.quantity,line.unitCost));
            return db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id);
          });
          return ok(result,201);
        }
        const receiveMatch=pathname.match(/^\/api\/purchases\/([^/]+)\/receive$/);
        if(method==="POST"&&receiveMatch)return ok(receivePurchase(db,decodeURIComponent(receiveMatch[1])));
        return fail(404,"Route not found");
      } catch(error) {
        const message=String(error?.message||"Unexpected error");
        const status=/not found/i.test(message)?404:/insufficient stock|already exists|constraint/i.test(message)?409:400;
        return fail(status,message);
      }
    }
  };
}
