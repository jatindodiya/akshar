const express = require('express');
const { readDB, writeDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const COLLECTIONS = ['products', 'clients', 'deals'];

// GET /api/data — everything the dashboard needs on load
router.get('/data', (req, res) => {
  const db = readDB();
  res.json({
    products: db.products,
    clients: db.clients,
    deals: db.deals,
    settings: db.settings
  });
});

// POST /api/sync — upsert whatever changed (mirrors the old Firestore batch push)
router.post('/sync', (req, res) => {
  const db = readDB();
  const { products, clients, deals, settings } = req.body || {};

  const upsert = (existing, incoming) => {
    if (!Array.isArray(incoming)) return existing;
    const byId = new Map(existing.map(o => [o.id, o]));
    incoming.forEach(o => { if (o && o.id) byId.set(o.id, o); });
    return Array.from(byId.values());
  };

  if (products) db.products = upsert(db.products, products);
  if (clients) db.clients = upsert(db.clients, clients);
  if (deals) db.deals = upsert(db.deals, deals);
  if (settings && typeof settings === 'object') db.settings = settings;

  writeDB(db);
  res.json({ ok: true });
});

// DELETE /api/:collection/:id
router.delete('/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(400).json({ error: 'Unknown collection' });
  const db = readDB();
  db[collection] = db[collection].filter(o => o.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
