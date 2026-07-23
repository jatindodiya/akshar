const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { readDB, writeDB, uid } = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function safeUser(u) {
  return { uid: u.id, name: u.name, role: u.role, email: u.email, loginId: u.email };
}
function sign(u) {
  return jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '30d' });
}

// GET /api/auth/users-exist  — used to decide whether to show "create admin account" link
router.get('/users-exist', (req, res) => {
  const db = readDB();
  res.json({ exists: db.users.length > 0 });
});

// POST /api/auth/signup  — only works for the very first user (becomes Admin)
router.post('/signup', async (req, res) => {
  const db = readDB();
  if (db.users.length > 0) {
    return res.status(400).json({ error: 'Admin account already exists — ask your admin to add you as a user.' });
  }
  const { name, email, password } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Naam daalo.' });
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email format galat hai.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password min 6 characters.' });

  const hash = await bcrypt.hash(password, 10);
  const user = { id: uid('u'), name: name.trim(), email: email.trim().toLowerCase(), role: 'Admin', passwordHash: hash };
  db.users.push(user);
  writeDB(db);
  res.json({ token: sign(user), user: safeUser(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const db = readDB();
  const { email, password } = req.body || {};
  const user = db.users.find(u => u.email === String(email || '').trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Ye email registered nahi hai.' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Galat email ya password.' });
  res.json({ token: sign(user), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  const ok = await bcrypt.compare(oldPassword || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password galat hai.' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
