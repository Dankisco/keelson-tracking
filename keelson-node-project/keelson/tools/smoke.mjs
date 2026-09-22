/**
 * Behaviour tests against a running server.
 *
 *   npm run seed && node server.js      (in one terminal)
 *   node tools/smoke.mjs                (in another)
 *
 * Checks the write paths and the rules that matter: validation rejects bad
 * input, customers cannot reach staff pages, and progress stays inside the
 * band its checkpoints allow.
 */
const BASE = process.env.BASE || 'http://localhost:5000';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${label.padEnd(38)} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
  if (!ok) failures++;
}

/** A tiny cookie jar, so we can act as a signed-in user. */
function jar() {
  let cookie = '';
  return {
    async fetch(path, options = {}) {
      const res = await fetch(BASE + path, {
        ...options,
        redirect: 'manual',
        headers: { ...(options.headers || {}), ...(cookie ? { cookie } : {}) }
      });
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return res;
    },
    clear() { cookie = ''; }
  };
}

const form = (obj) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(obj).toString()
});

const session = jar();

// --- register a brand new customer ----------------------------------------
const email = `buyer${Date.now()}@example.com`;
let res = await session.fetch('/register', form({
  name: 'Test Buyer', company: 'Testing Ltd', email, password: 'hunter2hunter2'
}));
check('register a customer', res.status === 302, `-> ${res.headers.get('location')}`);

// --- that customer books a shipment ---------------------------------------
res = await session.fetch('/shipments/new', form({
  origin: 'Tokyo', dest: 'Hamburg', service: 'air',
  cargo_type: 'Test cargo', weight_kg: '500', pieces: '3',
  recipient_name: 'Someone'
}));
const booked = res.headers.get('location') || '';
check('book a shipment', res.status === 302 && booked.startsWith('/track/KLN'), booked);

const number = booked.replace('/track/', '');
let api = await (await session.fetch('/api/track/' + number)).json();
check('new shipment starts as booked', api.status === 'booked', number);
check('booking created a checkpoint', api.events.length === 1);

// --- validation actually rejects bad input --------------------------------
res = await session.fetch('/shipments/new', form({
  origin: 'Tokyo', dest: 'Tokyo', service: 'air', weight_kg: '-5', pieces: '0'
}));
check('rejects same port / bad weight', res.status === 200);  // re-renders form

// --- a customer cannot reach staff pages ----------------------------------
res = await session.fetch('/admin');
check('customer blocked from /admin', res.status === 302 &&
      res.headers.get('location') === '/dashboard');

// --- staff sign in and add a checkpoint -----------------------------------
session.clear();
res = await session.fetch('/login',
  form({ email: 'admin@keelson.com', password: 'keelson123' }));
check('staff sign in', res.status === 302 && res.headers.get('location') === '/admin');

// Find a shipment id from the operations table.
const idRes = await session.fetch('/admin');
const idMatch = (await idRes.text()).match(/\/admin\/shipments\/(\d+)/);
const sid = idMatch ? idMatch[1] : '1';

res = await session.fetch('/admin/shipments/' + sid, form({
  action: 'add_event', status: 'in_transit', location: 'Tokyo', note: 'Departed.'
}));
check('add a checkpoint', res.status === 302);

// --- report, then clear, a position ---------------------------------------
const track = (await (await session.fetch('/admin/shipments/' + sid)).text())
  .match(/KLN\d{9}/)?.[0];

res = await session.fetch('/admin/shipments/' + sid, form({
  action: 'report_position', current_lat: '36.14', current_lng: '-5.35'
}));
api = await (await session.fetch('/api/track/' + track)).json();
check('report a position', api.live.position_source === 'reported', api.live.position || '');

res = await session.fetch('/admin/shipments/' + sid, form({
  action: 'report_position', current_lat: '999', current_lng: '0'
}));
api = await (await session.fetch('/api/track/' + track)).json();
check('rejects out-of-range latitude', api.live.position_source === 'reported',
      'previous fix kept');

res = await session.fetch('/admin/shipments/' + sid, form({
  action: 'report_position', current_lat: '', current_lng: ''
}));
api = await (await session.fetch('/api/track/' + track)).json();
check('clearing returns to estimate', api.live.position_source === 'estimated');

// --- progress stays inside its checkpoint band ----------------------------
const L = api.live;
check('progress bounded by checkpoints',
      L.floor_t <= L.fraction && L.fraction <= L.ceil_t,
      `${L.floor_t} <= ${L.fraction} <= ${L.ceil_t}`);

// --- the position feed is off unless a token is set -----------------------
res = await fetch(`${BASE}/api/position/${track}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lat: 1, lng: 2 })
});
check('position feed disabled by default', res.status === 404);

console.log();
console.log(failures ? `${failures} FAILURE(S)` : 'all behaviour tests pass');
process.exit(failures ? 1 : 0);
