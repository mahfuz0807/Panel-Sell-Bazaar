const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("store.db");
const PORT = process.env.PORT || 3000;

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'buyer',balance REAL NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,description TEXT DEFAULT '',badge TEXT DEFAULT 'NEW',active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS packages(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,name TEXT NOT NULL,price REAL NOT NULL,FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,package_id INTEGER NOT NULL,amount REAL NOT NULL,status TEXT NOT NULL DEFAULT 'pending',payment_method TEXT DEFAULT 'balance',payment_ref TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(package_id) REFERENCES packages(id));
CREATE TABLE IF NOT EXISTS payment_settings(id INTEGER PRIMARY KEY CHECK(id=1),bkash TEXT DEFAULT '',nagad TEXT DEFAULT '',rocket TEXT DEFAULT '',instructions TEXT DEFAULT 'Send the exact amount to the selected number, then submit your sender number and transaction ID. Admin will verify manually.');
CREATE TABLE IF NOT EXISTS fund_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,method TEXT NOT NULL,amount REAL NOT NULL,sender_number TEXT NOT NULL,trxid TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS blocked_emails(email TEXT PRIMARY KEY,blocked_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

if (!db.prepare("SELECT id FROM payment_settings WHERE id=1").get()) {
    db.prepare("INSERT INTO payment_settings(id) VALUES(1)").run();
}

const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisPassword";

if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')")
        .run("Administrator", adminEmail, hash);
}

if (!db.prepare("SELECT id FROM products LIMIT 1").get()) {
    const p = db.prepare("INSERT INTO products(name,description,badge) VALUES(?,?,?)")
        .run("Premium Digital Panel", "Premium digital product package with fast delivery and support.", "HOT");

    const add = db.prepare("INSERT INTO packages(product_id,name,price) VALUES(?,?,?)");

    [["1 hour", 20], ["3 hour", 38], ["6 hour", 65], ["12 hour", 110]]
        .forEach(x => add.run(p.lastInsertRowid, x[0], x[1]));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

// FIX: Frontend files are served from the project root
app.use(express.static(__dirname));

function user(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: "Login required" });
    next();
}

function adminOnly(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin")
        return res.status(403).json({ error: "Admin only" });
    next();
}

app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.json({ user: null });

    const u = db.prepare("SELECT id,name,email,role,balance FROM users WHERE id=?")
        .get(req.session.user.id);

    res.json({ user: u });
});

app.post("/api/register", (req, res) => {
    const { name, email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password || password.length < 6)
        return res.status(400).json({ error: "Name, email and 6+ character password required" });

    if (db.prepare("SELECT email FROM blocked_emails WHERE email=?").get(normalizedEmail))
        return res.status(403).json({ error: "এই ইমেইলটি অ্যাডমিন ব্লক করেছেন। নতুন অ্যাকাউন্ট করা যাবে না।" });

    try {
        const hash = bcrypt.hashSync(password, 12);

        const r = db.prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)")
            .run(name, normalizedEmail, hash);

        req.session.user = { id: r.lastInsertRowid, role: "buyer" };
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: "Email already registered" });
    }
});

app.post("/api/login", (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (db.prepare("SELECT email FROM blocked_emails WHERE email=?").get(email))
        return res.status(403).json({ error: "এই ইমেইলটি অ্যাডমিন ব্লক করেছেন। লগইন করা যাবে না।" });

    const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);

    if (!u || !bcrypt.compareSync(req.body.password || "", u.password))
        return res.status(401).json({ error: "Invalid email or password" });

    req.session.user = { id: u.id, role: u.role };
    res.json({ ok: true, role: u.role });
});

app.post("/api/logout", (req, res) =>
    req.session.destroy(() => res.json({ ok: true }))
);

app.get("/api/products", (req, res) => {
    const products = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY id DESC").all();
    const packs = db.prepare("SELECT * FROM packages").all();

    res.json(products.map(p => ({
        ...p,
        packages: packs.filter(x => x.product_id === p.id)
    })));
});

app.post("/api/orders", user, (req, res) => {
    const pack = db.prepare("SELECT * FROM packages WHERE id=?").get(req.body.package_id);

    if (!pack) return res.status(404).json({ error: "Package not found" });

    const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.session.user.id);

    if ((u.balance || 0) < pack.price)
        return res.status(400).json({ error: "Insufficient balance. Add funds first." });

    const tx = db.transaction(() => {
        db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(pack.price, u.id);

        return db.prepare("INSERT INTO orders(user_id,package_id,amount,status) VALUES(?,?,?,'paid')")
            .run(u.id, pack.id, pack.price);
    });

    res.json({ ok: true, order_id: tx().lastInsertRowid });
});

app.get("/api/orders", user, (req, res) =>
    res.json(db.prepare(`
        SELECT o.*,p.name product_name,pk.name package_name
        FROM orders o
        JOIN packages pk ON pk.id=o.package_id
        JOIN products p ON p.id=pk.product_id
        WHERE o.user_id=?
        ORDER BY o.id DESC
    `).all(req.session.user.id))
);

app.get("/api/payment-settings", (req, res) => {
    const s = db.prepare("SELECT bkash,nagad,rocket,instructions FROM payment_settings WHERE id=1").get();
    res.json(s);
});

app.post("/api/fund-requests", user, (req, res) => {
    const method = String(req.body.method || "").toLowerCase();
    const amount = Number(req.body.amount);
    const sender = String(req.body.sender_number || "").trim();
    const trxid = String(req.body.trxid || "").trim();

    if (!["bkash", "nagad", "rocket"].includes(method) ||
        !Number.isFinite(amount) || amount <= 0 || !sender || !trxid)
        return res.status(400).json({ error: "Method, amount, sender number and transaction ID are required" });

    const r = db.prepare("INSERT INTO fund_requests(user_id,method,amount,sender_number,trxid) VALUES(?,?,?,?,?)")
        .run(req.session.user.id, method, amount, sender, trxid);

    res.json({
        ok: true,
        id: r.lastInsertRowid,
        message: "Fund request submitted. Admin will verify it manually."
    });
});

app.get("/api/fund-requests", user, (req, res) =>
    res.json(db.prepare(`
        SELECT id,method,amount,sender_number,trxid,status,created_at,reviewed_at
        FROM fund_requests
        WHERE user_id=?
        ORDER BY id DESC
    `).all(req.session.user.id))
);

app.get("/api/admin/users", adminOnly, (req, res) =>
    res.json(db.prepare("SELECT id,name,email,role,balance,created_at FROM users ORDER BY id DESC").all())
);

// Delete user and permanently block the email
app.delete("/api/admin/users/:id", adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT id,email,role FROM users WHERE id=?").get(id);

    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "admin")
        return res.status(400).json({ error: "Admin account cannot be deleted" });

    try {
        const tx = db.transaction(() => {
            db.prepare("INSERT OR IGNORE INTO blocked_emails(email) VALUES(?)")
                .run(target.email.toLowerCase());

            db.prepare("DELETE FROM orders WHERE user_id=?").run(id);
            db.prepare("DELETE FROM fund_requests WHERE user_id=?").run(id);
            db.prepare("DELETE FROM users WHERE id=?").run(id);
        });

        tx();
        res.json({ ok: true, message: "User deleted and email permanently blocked." });
    } catch (e) {
        res.status(500).json({ error: "Could not delete user: " + e.message });
    }
});

app.get("/api/admin/orders", adminOnly, (req, res) =>
    res.json(db.prepare(`
        SELECT o.*,u.email,p.name product_name,pk.name package_name
        FROM orders o
        JOIN users u ON u.id=o.user_id
        JOIN packages pk ON pk.id=o.package_id
        JOIN products p ON p.id=pk.product_id
        ORDER BY o.id DESC
    `).all())
);

app.get("/api/admin/fund-requests", adminOnly, (req, res) =>
    res.json(db.prepare(`
        SELECT f.*,u.name,u.email
        FROM fund_requests f
        JOIN users u ON u.id=f.user_id
        ORDER BY f.id DESC
    `).all())
);

app.get("/api/admin/payment-settings", adminOnly, (req, res) =>
    res.json(db.prepare("SELECT * FROM payment_settings WHERE id=1").get())
);

app.put("/api/admin/payment-settings", adminOnly, (req, res) => {
    const { bkash = "", nagad = "", rocket = "", instructions = "" } = req.body;

    db.prepare("UPDATE payment_settings SET bkash=?,nagad=?,rocket=?,instructions=? WHERE id=1")
        .run(String(bkash), String(nagad), String(rocket), String(instructions));

    res.json({ ok: true });
});

app.post("/api/admin/fund-requests/:id/approve", adminOnly, (req, res) => {
    const tx = db.transaction(() => {
        const f = db.prepare("SELECT * FROM fund_requests WHERE id=?").get(req.params.id);

        if (!f) throw Error("Request not found");
        if (f.status !== "pending") throw Error("Request already reviewed");

        db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(f.amount, f.user_id);

        db.prepare("UPDATE fund_requests SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(f.id);

        return f;
    });

    try {
        tx();
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post("/api/admin/fund-requests/:id/reject", adminOnly, (req, res) => {
    const f = db.prepare("SELECT * FROM fund_requests WHERE id=?").get(req.params.id);

    if (!f) return res.status(404).json({ error: "Request not found" });
    if (f.status !== "pending")
        return res.status(400).json({ error: "Request already reviewed" });

    db.prepare("UPDATE fund_requests SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(f.id);

    res.json({ ok: true });
});

app.post("/api/admin/products", adminOnly, (req, res) => {
    const { name, description, badge = "NEW", packages = [] } = req.body;

    if (!name) return res.status(400).json({ error: "Product name required" });

    const tx = db.transaction(() => {
        const r = db.prepare("INSERT INTO products(name,description,badge) VALUES(?,?,?)")
            .run(name, description || "", badge);

        const add = db.prepare("INSERT INTO packages(product_id,name,price) VALUES(?,?,?)");

        for (const x of packages) add.run(r.lastInsertRowid, x.name, Number(x.price));

        return r.lastInsertRowid;
    });

    res.json({ ok: true, id: tx() });
});

app.put("/api/admin/products/:id", adminOnly, (req, res) => {
    db.prepare("UPDATE products SET name=?,description=?,badge=?,active=? WHERE id=?")
        .run(req.body.name, req.body.description || "", req.body.badge || "NEW", req.body.active ? 1 : 0, req.params.id);

    res.json({ ok: true });
});

app.delete("/api/admin/products/:id", adminOnly, (req, res) => {
    db.prepare("DELETE FROM packages WHERE product_id=?").run(req.params.id);
    db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);

    res.json({ ok: true });
});

app.post("/api/admin/packages", adminOnly, (req, res) => {
    const { product_id, name, price } = req.body;

    const r = db.prepare("INSERT INTO packages(product_id,name,price) VALUES(?,?,?)")
        .run(product_id, name, Number(price));

    res.json({ ok: true, id: r.lastInsertRowid });
});

// FIX: Serve index.html from the project root
app.get("*", (req, res) =>
    res.sendFile(path.join(__dirname, "index.html"))
);

app.listen(PORT, () =>
    console.log(`Panel Sell Bazaar running on http://localhost:${PORT}`)
);
