# Akshar Export Dashboard — Backend + Frontend (Separate Files)

Yeh original single-file dashboard ab do alag parts mein split hai:

```
akshar-dashboard/
  backend/     ← Node.js + Express API (Firebase ki jagah aap ka apna server)
  frontend/    ← HTML + CSS + JS (browser mein chalta hai)
```

Firebase completely hata diya gaya hai. Login, users, products, clients, deals, settings — sab kuch ab aapke apne backend server par store hota hai (ek simple `db.json` file mein), koi external cloud service ki zaroorat nahi.

---

## 1) Backend chalao (pehle yeh karo)

```bash
cd backend
npm install
cp .env.example .env
```

`.env` file kholo aur `JWT_SECRET` ko koi bhi lamba random string bana do (login tokens sign karne ke liye use hota hai).

Phir server start karo:

```bash
npm start
```

Terminal mein yeh dikhega:
```
Akshar Export Dashboard API running on http://localhost:4000
```

Pehli baar chalne par `backend/data/db.json` file automatically ban jayegi, jisme sample products/clients/deals pehle se seed hoke aa jayenge (jaisa original app mein tha).

> Users (login accounts) khali start hote hain — pehla banda jo "Create admin account" se signup karega, wahi **Admin** ban jayega. Baaki sab staff ko Admin apne "Users & Access" settings panel se add karega.

---

## 2) Frontend kholo

`frontend/index.html` seedha double-click karke browser mein khol sakte ho, ya koi simple static server use karo:

```bash
cd frontend
npx serve .
```

Frontend by default `http://localhost:4000/api` par backend ko call karta hai. Agar backend kisi doosre port/URL par chal raha hai, to `frontend/app.js` ke bilkul top par yeh line badal do:

```js
const API_BASE = 'http://localhost:4000/api';
```

---

## 3) Pehli baar login

1. Frontend kholo → "No users yet." dikhega → **Create the admin account** par click karo.
2. Apna naam, email, password (min 6 characters) daal ke account banao — yeh automatically **Admin** role milega.
3. Login ho jaoge, dashboard dikhega with sample data.
4. Settings → Users & Access se team ke aur logo ko add kar sakte ho.

---

## Deploy karne ke liye (jab team ke saath live use karna ho)

- **Backend**: kisi bhi Node.js hosting par (Render, Railway, a VPS, etc.) deploy karo. `.env` mein `JWT_SECRET` aur `CORS_ORIGIN` (apne frontend ka URL) set karna mat bhoolo.
- **Frontend**: kisi bhi static hosting par (Netlify, Vercel, GitHub Pages, ya seedha same VPS). Deploy karne se pehle `app.js` mein `API_BASE` ko apne live backend URL se update kar do.
- `backend/data/db.json` hi aapka database hai — isko regularly backup karte raho (ya Settings → "Export backup (JSON)" se bhi manual backup le sakte ho).

---

## File-by-file kya badla

| Original (single file)                          | Ab kahan hai                          |
|--------------------------------------------------|----------------------------------------|
| `<style>` block                                   | `frontend/style.css`                   |
| HTML body                                         | `frontend/index.html`                  |
| `<script>` (UI logic — dashboard, forms, tables)  | `frontend/app.js` (ismein koi badlaav nahi) |
| Firebase Auth (login/signup/users)                | `backend/routes/auth.js`, `routes/users.js` + JWT |
| Firestore (`products`/`clients`/`deals`/`settings`) real-time sync | `backend/routes/data.js` + `backend/db.js` (JSON file storage) |
| `FIREBASE_CONFIG` paste-config screen             | Hata diya — ab bas `API_BASE` URL set karna hai |
