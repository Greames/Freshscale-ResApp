import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(filename = process.env.DB_PATH || "./data/freshscale.sqlite") {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      price REAL NOT NULL CHECK(price >= 0), emoji TEXT NOT NULL DEFAULT '🍽️',
      description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, unit TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      minimum_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_quantity >= 0),
      unit_cost REAL NOT NULL DEFAULT 0 CHECK(unit_cost >= 0)
    );
    CREATE TABLE IF NOT EXISTS recipes (
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity REAL NOT NULL CHECK(quantity > 0),
      PRIMARY KEY(menu_item_id, ingredient_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, order_type TEXT NOT NULL CHECK(order_type IN ('Dine in','Takeaway','Delivery')),
      table_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('New','Preparing','Ready','Paid','Cancelled')),
      subtotal REAL NOT NULL CHECK(subtotal >= 0), tax REAL NOT NULL DEFAULT 0 CHECK(tax >= 0),
      total REAL NOT NULL CHECK(total >= 0), created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0),
      PRIMARY KEY(order_id, menu_item_id)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY, ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      order_id TEXT REFERENCES orders(id), movement_type TEXT NOT NULL,
      quantity_delta REAL NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(order_id, ingredient_id, movement_type)
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, supplier TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Awaiting approval',
      amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0), created_at TEXT NOT NULL DEFAULT (datetime('now')),
      received_at TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      purchase_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity REAL NOT NULL CHECK(quantity > 0), unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
      PRIMARY KEY(purchase_id, ingredient_id)
    );
  `);
  seedIfEmpty(db);
  return db;
}
function seedIfEmpty(db) {
  if (db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n) return;
  const menu = [
    [1,"Masala Dosa","South Indian",90,"🥞","Crisp dosa · potato masala"],
    [2,"Ghee Podi Idli","South Indian",80,"🥘","Soft idli · ghee podi"],
    [3,"Paneer Tikka Bowl","Mains",210,"🍲","Tandoor paneer · fresh salad"],
    [4,"Veg Biryani","Mains",180,"🍛","Dum rice · house spices"],
    [5,"Filter Coffee","Beverages",45,"☕","Strong South Indian filter"],
    [6,"Fresh Lime Soda","Beverages",60,"🍋","Sweet or salted · chilled"],
    [7,"Chicken 65","Starters",190,"🍗","Spiced · curry leaves"],
    [8,"Gulab Jamun","Desserts",70,"🍮","Warm syrup · two pieces"]
  ];
  const ingredients = [
    [1,"Basmati rice","kg",18,10,95],[2,"Rice & dal batter","kg",8,5,60],
    [3,"Potato","kg",3.2,5,32],[4,"Paneer","kg",2.4,3,320],[5,"Milk","L",12,6,58],
    [6,"Chicken","kg",4.5,4,230],[7,"Mixed vegetables","kg",6,4,75],[8,"Oil","L",5,3,145],
    [9,"Ghee","L",1.8,2,580],[10,"Curd","kg",4,2,70],[11,"Coffee decoction","L",2,1,180],
    [12,"Lime","pcs",16,10,4],[13,"Soda","L",7,3,30],[14,"Gulab jamun","pcs",32,12,12]
  ];
  const recipes = [[1,2,.25],[1,3,.12],[2,2,.2],[2,9,.015],[3,4,.18],[3,10,.06],[4,1,.22],[4,7,.15],[5,11,.04],[5,5,.1],[6,12,1],[6,13,.2],[7,6,.2],[7,8,.03],[8,14,2]];
  const insertMenu = db.prepare("INSERT INTO menu_items(id,name,category,price,emoji,description) VALUES(?,?,?,?,?,?)");
  const insertIngredient = db.prepare("INSERT INTO ingredients(id,name,unit,quantity,minimum_quantity,unit_cost) VALUES(?,?,?,?,?,?)");
  const insertRecipe = db.prepare("INSERT INTO recipes(menu_item_id,ingredient_id,quantity) VALUES(?,?,?)");
  db.transaction(() => { for (const row of menu) insertMenu.run(...row); for (const row of ingredients) insertIngredient.run(...row); for (const row of recipes) insertRecipe.run(...row); })();
}
export function resetDatabase(db) {
  db.exec("DELETE FROM purchase_items; DELETE FROM purchase_orders; DELETE FROM stock_movements; DELETE FROM order_items; DELETE FROM orders; DELETE FROM recipes; DELETE FROM ingredients; DELETE FROM menu_items;");
  seedIfEmpty(db);
}
