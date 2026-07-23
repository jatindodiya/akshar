const express = require('express');
const bcrypt = require('bcryptjs');
const { readDB, writeDB, uid } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function safeUser(u) {
  return { uid: u.id, name: u.name, role: u.role, email: u.email, loginId: u.email };
}

// GET /api/users  — any signed-in user can see the team list (read-only for non-admins on the frontend)
router.get('/', (req, res) => {
  const db = readDB();
  res.json({ users: db.users.map(safeUser) });
});

// POST /api/users  — admin adds a teammate with a temp password
router.post('/', requireAdmin, async (req, res) => {
  const db = readDB();
  const { name, email, role, password } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name aur email zaroori' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password min 6' });
  const em = email.trim().toLowerCase();
  if (db.users.some(u => u.email === em)) return res.status(400).json({ error: 'Ye email pehle se registered hai.' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uid('u'), name: name.trim(), email: em, role: role || 'Staff', passwordHash: hash };
  db.users.push(user);
  writeDB(db);
  res.json({ user: safeUser(user) });
});

// POST /api/users/:id/reset-password  — admin sets a new temp password directly (no email server configured)
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password min 6' });
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  writeDB(db);
  res.json({ ok: true });
});

// DELETE /api/users/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const db = readDB();
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Apne aap ko delete nahi kar sakte' });
  db.users = db.users.filter(u => u.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
