/* ============================================================
   Simple file-based database.
   No external database server needed — everything is stored in
   data/db.json on disk. Good enough for a small team dashboard.
   Swap this file out later for a real database (Postgres/Mongo)
   without touching the routes, as long as you keep the same
   function names (readDB / writeDB).
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function today() { return new Date().toISOString().slice(0, 10); }
function daysOffset(off) { return new Date(Date.now() - off * 864e5).toISOString().slice(0, 10); }
function daysOffsetFuture(off) { return new Date(Date.now() + off * 864e5).toISOString().slice(0, 10); }

function seedData() {
  const products = [
    { id: uid('p'), name: 'LABSA 90% (Linear Alkyl Benzene Sulphonic Acid)', cas: '27176-87-0', hsn: '34021190', classification: 'Corrosive (Class 8)', haz: true, unit: 'MT', rate: 1250, currency: 'USD', packing: '220 kg HDPE drums', msds: null, coa: null },
    { id: uid('p'), name: 'Toluene (Industrial Grade)', cas: '108-88-3', hsn: '29023000', classification: 'Flammable (Class 3)', haz: true, unit: 'MT', rate: 900, currency: 'USD', packing: 'ISO tank / drums', msds: null, coa: null },
    { id: uid('p'), name: 'Coal Tar Pitch', cas: '65996-93-2', hsn: '27081010', classification: 'Carcinogen — handle with care', haz: true, unit: 'MT', rate: 520, currency: 'USD', packing: 'Jumbo bags / bulk', msds: null, coa: null },
    { id: uid('p'), name: 'Caustic Soda Flakes', cas: '1310-73-2', hsn: '28151200', classification: 'Corrosive (Class 8)', haz: true, unit: 'MT', rate: 610, currency: 'USD', packing: '25 kg bags', msds: null, coa: null },
  ];
  const clients = [
    { id: uid('c'), company: 'Al Noor Trading LLC', contact: 'Mr. Hamid', country: 'UAE', email: 'buy@alnoor.ae', phone: '+971 ', address: 'Dubai, UAE', notes: 'Regular LABSA buyer' },
    { id: uid('c'), company: 'Global Chem Imports', contact: 'Ms. Chen', country: 'Singapore', email: 'proc@globalchem.sg', phone: '+65 ', address: 'Singapore', notes: '' },
    { id: uid('c'), company: 'Kenya Detergents Ltd', contact: 'Mr. Otieno', country: 'Kenya', email: 'info@kenyadet.co.ke', phone: '+254 ', address: 'Mombasa, Kenya', notes: 'Needs COA every batch' },
  ];
  const deals = [
    {
      id: uid('d'), no: 'AXR-INQ-0001', date: daysOffset(9), clientId: clients[0].id, port: 'Jebel Ali, UAE', currency: 'USD', incoterm: 'CIF', stage: 'sent',
      items: [{ productId: products[0].id, qty: 24, unit: 'MT', rate: 1240 }],
      quoteNo: 'AXR-QTN-0001', quoteDate: daysOffset(6), validity: 15, quotedBy: 'Export Manager',
      shipping: {}, payment: {}, followups: [{ date: daysOffset(6), note: 'Quotation emailed for 24 MT LABSA CIF Jebel Ali' }], lost: false, lostReason: ''
    },
    {
      id: uid('d'), no: 'AXR-INQ-0002', date: daysOffset(4), clientId: clients[2].id, port: 'Mombasa, Kenya', currency: 'USD', incoterm: '', stage: 'inquiry',
      items: [{ productId: products[2].id, qty: 100, unit: 'MT', rate: '' }],
      quoteNo: '', quoteDate: '', validity: 15, quotedBy: '', shipping: {}, payment: {}, followups: [], lost: false, lostReason: ''
    },
    {
      id: uid('d'), no: 'AXR-INQ-0003', date: daysOffset(2), clientId: clients[1].id, port: 'Singapore', currency: 'USD', incoterm: 'CIF', stage: 'converted',
      items: [{ productId: products[1].id, qty: 20, unit: 'MT', rate: 895 }],
      quoteNo: 'AXR-QTN-0002', quoteDate: daysOffset(2), validity: 15, quotedBy: 'Director',
      shipping: { company: '', blNo: '', etd: '', eta: daysOffsetFuture(18), pol: 'Nhava Sheva', pod: 'Singapore', status: 'Booking pending' },
      payment: { invoiceNo: '', amount: 17900, terms: '30% adv / 70% BL', dueDate: daysOffsetFuture(25), received: 0, status: 'Advance pending' },
      followups: [{ date: daysOffset(2), note: 'PO received. Advance invoice to be raised.' }], lost: false, lostReason: ''
    },
  ];
  const settings = {
    company: 'Akshar Chemical India Pvt. Ltd.',
    brand: 'Akshar International',
    address: 'Mira Road (East), Thane, Maharashtra, India',
    gstin: '', iec: '', email: 'sales@aksharinternational.in', phone: '+91 ',
    website: 'aksharinternational.in',
    bank: 'Bank: __________   A/C: __________   IFSC: __________   SWIFT: __________',
    seniors: ['Director', 'Export Manager'],
    quoteTerms: 'Prices are Ex-Works unless stated. Validity 15 days. Payment: 30% advance, balance against BL copy. Subject to stock availability.',
    incoterms: ['EXW', 'FOB', 'CIF', 'CFR', 'FCA', 'DAP'],
    inqCounter: 3, quoteCounter: 1
  };
  return { users: [], products, clients, deals, settings };
}

function ensureDB() {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    writeDB(seedData());
  }
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try { return JSON.parse(raw); }
  catch (e) { return seedData(); }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readDB, writeDB, uid, today };
