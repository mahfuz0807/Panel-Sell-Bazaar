const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "store.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'buyer',
 balance REAL NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 description TEXT DEFAULT '',
 badge TEXT DEFAULT 'NEW',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 price REAL NOT NULL,
 FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 package_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 payment_method TEXT DEFAULT 'balance',
 payment_ref TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(package_id) REFERENCES packages(id)
);

CREATE TABLE IF NOT EXISTS payment_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 bkash TEXT DEFAULT '',
 nagad TEXT DEFAULT '',
 rocket TEXT DEFAULT '',
 instructions TEXT DEFAULT 'Send payment and submit transaction details.'
);

CREATE TABLE IF NOT EXISTS fund_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 method TEXT NOT NULL,
 amount REAL NOT NULL,
 sender_number TEXT NOT NULL,
 trxid TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS blocked_emails (
 email TEXT PRIMARY KEY,
 blocked_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

if (!db.prepare("SELECT id FROM payment_settings WHERE id=1").get()) {
 db.prepare("INSERT INTO payment_settings(id) VALUES(1)").run();
}

const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";

if (!adminEmail || !adminPassword) {
 console.warn("Set ADMIN_EMAIL and ADMIN_PASSWORD in Render Environment Variables.");
} else if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
 const hash = bcrypt.hashSync(adminPassword, 12);
 db.prepare(
  "INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')"
 ).run("Administrator", adminEmail, hash);
}

if (!db.prepare("SELECT id FROM products LIMIT 1").get()) {
 const p = db.prepare(
  "INSERT INTO products(name,description,badge) VALUES(?,?,?)"
 ).run(
  "Premium Digital Panel",
  "Premium digital product package with fast delivery and support.",
  "HOT"
 );

 const add = db.prepare(
  "INSERT INTO packages(product_id,name,price) VALUES(?,?,?)"
 );

 [["1 hour",20],["3 hour",38],["6 hour",65],["12 hour",110]]
  .forEach(x => add.run(p.lastInsertRowid, x[0], x[1]));
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

if (!process.env.SESSION_SECRET) {
 console.warn("SESSION_SECRET is missing. Configure it in Render.");
}

app.use(session({
 store: new SQLiteStore({
  db: "sessions.sqlite",
  dir: DATA_DIR,
  table: "sessions"
 }),
 secret: process.env.SESSION_SECRET || "unsafe-development-secret",
 resave: false,
 saveUninitialized: false,
 cookie: {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000
 }
}));

app.use(express.static(path.join(__dirname, "public")));

function user(req, res, next) {
 if (!req.session.user) {
  return res.status(401).json({ error: "Login required" });
 }

 const current = db.prepare(
  "SELECT id,role FROM users WHERE id=?"
 ).get(req.session.user.id);

 if (!current) {
  return req.session.destroy(() =>
   res.status(401).json({ error: "Login required" })
  );
 }

 req.session.user.role = current.role;
 next();
}

function adminOnly(req, res, next) {
 user(req, res, () => {
  if (req.session.user.role !== "admin") {
   return res.status(403).json({ error: "Admin only" });
  }
  next();
 });
}

app.get("/api/me", (req, res) => {
 if (!req.session.user) return res.json({ user: null });

 const u = db.prepare(
  "SELECT id,name,email,role,balance FROM users WHERE id=?"
 ).get(req.session.user.id);

 res.json({ user: u || null });
});

app.post("/api/register", (req, res) => {
 const name = String(req.body.name || "").trim();
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");

 if (!name || !email || password.length < 6) {
  return res.status(400).json({
   error: "Name, email and 6+ character password required"
  });
 }

 if (db.prepare("SELECT email FROM blocked_emails WHERE email=?").get(email)) {
  return res.status(403).json({
   error: "এই ইমেইলটি ব্লক করা হয়েছে। নতুন অ্যাকাউন্ট করা যাবে না।"
  });
 }

 try {
  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
   "INSERT INTO users(name,email,password) VALUES(?,?,?)"
  ).run(name, email, hash);

  req.session.user = { id: result.lastInsertRowid, role: "buyer" };

  req.session.save(err => {
   if (err) return res.status(500).json({ error: "Session error" });
   res.json({ ok: true });
  });
 } catch (err) {
  res.status(400).json({ error: "Email already registered" });
 }
});

app.post("/api/login", (req, res) => {
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");

 if (db.prepare("SELECT email FROM blocked_emails WHERE email=?").get(email)) {
  return res.status(403).json({
   error: "এই ইমেইলটি ব্লক করা হয়েছে। লগইন করা যাবে না।"
  });
 }

 const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);

 if (!u || !bcrypt.compareSync(password, u.password)) {
  return res.status(401).json({ error: "Invalid email or password" });
 }

 req.session.regenerate(err => {
  if (err) return res.status(500).json({ error: "Session error" });

  req.session.user = { id: u.id, role: u.role };

  req.session.save(err => {
   if (err) return res.status(500).json({ error: "Session error" });
   res.json({ ok: true, role: u.role });
  });
 });
});

app.post("/api/logout", (req, res) => {
 req.session.destroy(() => {
  res.clearCookie("connect.sid");
  res.json({ ok: true });
 });
});

app.get("/api/products", (req, res) => {
 const products = db.prepare(
  "SELECT * FROM products WHERE active=1 ORDER BY id DESC"
 ).all();

 const packages = db.prepare("SELECT * FROM packages").all();

 res.json(products.map(p => ({
  ...p,
  packages: packages.filter(x => x.product_id === p.id)
 })));
});

app.post("/api/orders", user, (req, res) => {
 const packageId = Number(req.body.package_id);
 const pack = db.prepare("SELECT * FROM packages WHERE id=?").get(packageId);

 if (!pack) return res.status(404).json({ error: "Package not found" });

 const buyer = db.prepare(
  "SELECT * FROM users WHERE id=?"
 ).get(req.session.user.id);

 if (buyer.balance < pack.price) {
  return res.status(400).json({ error: "Insufficient balance. Add funds first." });
 }

 try {
  const transaction = db.transaction(() => {
   const update = db.prepare(
    "UPDATE users SET balance=balance-? WHERE id=? AND balance>=?"
   ).run(pack.price, buyer.id, pack.price);

   if (!update.changes) throw new Error("Insufficient balance");

   return db.prepare(
    "INSERT INTO orders(user_id,package_id,amount,status) VALUES(?,?,?,'paid')"
   ).run(buyer.id, pack.id, pack.price);
  });

  res.json({ ok: true, order_id: transaction().lastInsertRowid });
 } catch (err) {
  res.status(400).json({ error: err.message });
 }
});

app.get("/api/orders", user, (req, res) => {
 res.json(db.prepare(`
  SELECT o.*,p.name product_name,pk.name package_name
  FROM orders o
  JOIN packages pk ON pk.id=o.package_id
  JOIN products p ON p.id=pk.product_id
  WHERE o.user_id=?
  ORDER BY o.id DESC
 `).all(req.session.user.id));
});

app.get("/api/payment-settings", (req, res) => {
 res.json(db.prepare(
  "SELECT bkash,nagad,rocket,instructions FROM payment_settings WHERE id=1"
 ).get());
});

app.post("/api/fund-requests", user, (req, res) => {
 const method = String(req.body.method || "").toLowerCase();
 const amount = Number(req.body.amount);
 const sender = String(req.body.sender_number || "").trim();
 const trxid = String(req.body.trxid || "").trim();

 if (!["bkash","nagad","rocket"].includes(method) ||
     !Number.isFinite(amount) || amount <= 0 || !sender || !trxid) {
  return res.status(400).json({
   error: "Method, amount, sender number and transaction ID are required"
  });
 }

 const result = db.prepare(
  "INSERT INTO fund_requests(user_id,method,amount,sender_number,trxid) VALUES(?,?,?,?,?)"
 ).run(req.session.user.id, method, amount, sender, trxid);

 res.json({ ok: true, id: result.lastInsertRowid });
});

app.get("/api/fund-requests", user, (req, res) => {
 res.json(db.prepare(`
  SELECT id,method,amount,sender_number,trxid,status,created_at,reviewed_at
  FROM fund_requests WHERE user_id=? ORDER BY id DESC
 `).all(req.session.user.id));
});

/* Admin: user list */
app.get("/api/admin/users", adminOnly, (req, res) => {
 res.json(db.prepare(
  "SELECT id,name,email,role,balance,created_at FROM users ORDER BY id DESC"
 ).all());
});

/* Admin: delete user and block email */
app.delete("/api/admin/users/:id", adminOnly, (req, res) => {
 const id = Number(req.params.id);
 const target = db.prepare(
  "SELECT id,email,role FROM users WHERE id=?"
 ).get(id);

 if (!target) return res.status(404).json({ error: "User not found" });
 if (target.role === "admin") {
  return res.status(400).json({ error: "Admin account cannot be deleted" });
 }

 try {
  db.transaction(() => {
   db.prepare(
    "INSERT OR IGNORE INTO blocked_emails(email) VALUES(?)"
   ).run(target.email.toLowerCase());

   db.prepare("DELETE FROM orders WHERE user_id=?").run(id);
   db.prepare("DELETE FROM fund_requests WHERE user_id=?").run(id);
   db.prepare("DELETE FROM users WHERE id=?").run(id);
  })();

  res.json({ ok: true, message: "User deleted and email blocked." });
 } catch (err) {
  res.status(500).json({ error: "Could not delete user" });
 }
});

app.get("/api/admin/orders", adminOnly, (req, res) => {
 res.json(db.prepare(`
  SELECT o.*,u.email,p.name product_name,pk.name package_name
  FROM orders o
  JOIN users u ON u.id=o.user_id
  JOIN packages pk ON pk.id=o.package_id
  JOIN products p ON p.id=pk.product_id
  ORDER BY o.id DESC
 `).all());
});

app.get("/api/admin/fund-requests", adminOnly, (req, res) => {
 res.json(db.prepare(`
  SELECT f.*,u.name,u.email
  FROM fund_requests f
  JOIN users u ON u.id=f.user_id
  ORDER BY f.id DESC
 `).all());
});

app.get("/api/admin/payment-settings", adminOnly, (req, res) => {
 res.json(db.prepare("SELECT * FROM payment_settings WHERE id=1").get());
});

app.put("/api/admin/payment-settings", adminOnly, (req, res) => {
 const {
  bkash = "",
  nagad = "",
  rocket = "",
  instructions = ""
 } = req.body;

 db.prepare(
  "UPDATE payment_settings SET bkash=?,nagad=?,rocket=?,instructions=? WHERE id=1"
 ).run(String(bkash), String(nagad), String(rocket), String(instructions));

 res.json({ ok: true });
});

app.post("/api/admin/fund-requests/:id/approve", adminOnly, (req, res) => {
 try {
  db.transaction(() => {
   const fund = db.prepare(
    "SELECT * FROM fund_requests WHERE id=?"
   ).get(req.params.id);

   if (!fund) throw new Error("Request not found");
   if (fund.status !== "pending") throw new Error("Request already reviewed");

   db.prepare("UPDATE users SET balance=balance+? WHERE id=?")
    .run(fund.amount, fund.user_id);

   db.prepare(
    "UPDATE fund_requests SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?"
   ).run(fund.id);
  })();

  res.json({ ok: true });
 } catch (err) {
  res.status(400).json({ error: err.message });
 }
});

app.post("/api/admin/fund-requests/:id/reject", adminOnly, (req, res) => {
 const fund = db.prepare(
  "SELECT * FROM fund_requests WHERE id=?"
 ).get(req.params.id);

 if (!fund) return res.status(404).json({ error: "Request not found" });
 if (fund.status !== "pending") {
  return res.status(400).json({ error: "Request already reviewed" });
 }

 db.prepare(
  "UPDATE fund_requests SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?"
 ).run(fund.id);

 res.json({ ok: true });
});

app.post("/api/admin/products", adminOnly, (req, res) => {
 const { name, description = "", badge = "NEW", packages = [] } = req.body;

 if (!String(name || "").trim()) {
  return res.status(400).json({ error: "Product name required" });
 }

 try {
  const id = db.transaction(() => {
   const result = db.prepare(
    "INSERT INTO products(name,description,badge) VALUES(?,?,?)"
   ).run(name, description, badge);

   const add = db.prepare(
    "INSERT INTO packages(product_id,name,price) VALUES(?,?,?)"
   );

   for (const pack of packages) {
    const price = Number(pack.price);
    if (!pack.name || !Number.isFinite(price) || price < 0) {
     throw new Error("Invalid package details");
    }
    add.run(result.lastInsertRowid, pack.name, price);
   }

   return result.lastInsertRowid;
  })();

  res.json({ ok: true, id });
 } catch (err) {
  res.status(400).json({ error: err.message });
 }
});

app.put("/api/admin/products/:id", adminOnly, (req, res) => {
 const { name, description = "", badge = "NEW", active } = req.body;

 db.prepare(
  "UPDATE products SET name=?,description=?,badge=?,active=? WHERE id=?"
 ).run(name, description, badge, active ? 1 : 0, req.params.id);

 res.json({ ok: true });
});

app.delete("/api/admin/products/:id", adminOnly, (req, res) => {
 try {
  db.transaction(() => {
   db.prepare("DELETE FROM packages WHERE product_id=?").run(req.params.id);
   db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  })();

  res.json({ ok: true });
 } catch (err) {
  res.status(400).json({ error: "Could not delete product" });
 }
});

app.post("/api/admin/packages", adminOnly, (req, res) => {
 const { product_id, name, price } = req.body;
 const value = Number(price);

 if (!name || !Number.isFinite(value) || value < 0) {
  return res.status(400).json({ error: "Invalid package details" });
 }

 const result = db.prepare(
  "INSERT INTO packages(product_id,name,price) VALUES(?,?,?)"
 ).run(product_id, name, value);

 res.json({ ok: true, id: result.lastInsertRowid });
});

app.get("*", (req, res) => {
 res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
 console.log(`Panel Sell Bazaar running on port ${PORT}`);
});
