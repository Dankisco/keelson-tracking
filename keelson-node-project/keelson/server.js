/** Keelson - freight tracking and logistics platform. */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieSession from 'cookie-session';
import express from 'express';

import { checkPassword, hashPassword } from './lib/auth.js';
import { COMPANY } from './lib/company.js';
import { all, ensureSchema, get, run } from './lib/db.js';
import {
  ALL_STATUSES, FLAG_STATES, LOCATION_INDEX, LOCATIONS, SERVICES, STAGES,
  decorate, fmtDate, haversineKm, quote, toIso
} from './lib/shipments.js';
import { configureViews } from './lib/views.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5000;

ensureSchema();

const app = express();
app.disable('x-powered-by');
configureViews(app);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));

const SECRET = process.env.KEELSON_SECRET || 'dev-secret-change-in-production';
if (SECRET === 'dev-secret-change-in-production' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: KEELSON_SECRET is unset. Set it before running in production.');
}
app.use(cookieSession({
  name: 'keelson',
  keys: [SECRET],
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000
}));

// --------------------------------------------------------------------------
// Request context: the signed-in user, and one-shot flash messages
// --------------------------------------------------------------------------

app.use((req, res, next) => {
  req.user = null;
  if (req.session?.userId) {
    req.user = get(
      'SELECT id, email, name, company, role FROM users WHERE id = ?',
      req.session.userId
    ) ?? null;
  }

  req.flash = (message, category = 'info') => {
    req.session.flashes = [...(req.session.flashes || []), { message, category }];
  };
  const flashes = req.session?.flashes || [];
  if (flashes.length) req.session.flashes = [];

  res.locals.user = req.user;
  res.locals.flashes = flashes;
  res.locals.nav = req.path;
  // Absolute origin, for the shareable "copy tracking link" button.
  res.locals.base_url = `${req.protocol}://${req.get('host')}`;
  res.locals.year = new Date().getFullYear();
  next();
});

function loginRequired(req, res, next) {
  if (!req.user) {
    req.flash('Sign in to continue.', 'info');
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function adminRequired(req, res, next) {
  if (!req.user) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  if (req.user.role !== 'admin') {
    req.flash('That area is for Keelson staff.', 'error');
    return res.redirect('/dashboard');
  }
  next();
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const nowIso = () => toIso(new Date());

function newTrackingNumber() {
  for (;;) {
    const num = 'KLN' + Array.from({ length: 9 },
      () => crypto.randomInt(0, 10)).join('');
    if (!get('SELECT 1 FROM shipments WHERE tracking_number = ?', num)) return num;
  }
}

function newContainerNo(service) {
  const prefix = { sea: 'KLNU', air: 'AWB', land: 'KLNT' }[service];
  return prefix + ' ' + Array.from({ length: 6 },
    () => crypto.randomInt(0, 10)).join('');
}

const cleanNumber = (n) => String(n || '').trim().toUpperCase().replace(/[\s-]/g, '');

function fetchShipment({ trackingNumber = null, shipmentId = null }) {
  const row = trackingNumber
    ? get('SELECT * FROM shipments WHERE UPPER(tracking_number) = ?',
          cleanNumber(trackingNumber))
    : get('SELECT * FROM shipments WHERE id = ?', shipmentId);
  if (!row) return null;
  const events = all(
    'SELECT * FROM events WHERE shipment_id = ? ORDER BY datetime(occurred_at) DESC, id DESC',
    row.id
  );
  return decorate(row, events);
}

/** Figures for the landing page, all counted from the database. */
function networkStats() {
  const weekAgo = toIso(new Date(Date.now() - 7 * 86400000));
  return {
    moving: get("SELECT COUNT(*) c FROM shipments WHERE status NOT IN ('delivered','cancelled')").c,
    ports: get('SELECT COUNT(*) c FROM (SELECT origin_city AS city FROM shipments UNION SELECT dest_city FROM shipments)').c,
    countries: get('SELECT COUNT(*) c FROM (SELECT origin_country AS country FROM shipments UNION SELECT dest_country FROM shipments)').c,
    checkpoints_week: get('SELECT COUNT(*) c FROM events WHERE occurred_at >= ?', weekAgo).c
  };
}

// --------------------------------------------------------------------------
// Public
// --------------------------------------------------------------------------

app.get('/', (req, res) => {
  const rows = all(
    "SELECT * FROM shipments" +
    " WHERE status IN ('collected','in_transit','customs','out_for_delivery','delayed')" +
    ' ORDER BY datetime(created_at) DESC LIMIT 6'
  );
  const live = rows.map((r) => decorate(r));
  const featured = live.find((s) => s.status === 'in_transit') || live[0] || null;
  const sample = get("SELECT tracking_number FROM shipments WHERE status='in_transit' LIMIT 1");
  res.render('index.html', {
    live,
    hero_routes: live.slice(0, 5),
    featured,
    stats: networkStats(),
    sample: sample ? sample.tracking_number : null
  });
});

app.get('/help', (req, res) => res.render('help.html', { stats: networkStats() }));

app.get('/track', (req, res) => {
  const num = String(req.query.number || '').trim();
  if (!num) {
    req.flash('Enter a tracking number to search.', 'error');
    return res.redirect('/');
  }
  res.redirect('/track/' + encodeURIComponent(cleanNumber(num)));
});

app.get('/track/:number', (req, res) => {
  const shipment = fetchShipment({ trackingNumber: req.params.number });
  res.status(shipment ? 200 : 404)
     .render('track.html', { shipment, queried: req.params.number });
});

app.get('/api/track/:number', (req, res) => {
  const s = fetchShipment({ trackingNumber: req.params.number });
  if (!s) {
    return res.status(404).json({ found: false, tracking_number: req.params.number });
  }
  res.json({
    found: true,
    tracking_number: s.tracking_number,
    status: s.status,
    status_label: s.status_label,
    status_tone: s.is_delivered ? 'done'
      : s.is_flag ? 'flag'
      : s.status === 'booked' ? '' : 'moving',
    percent: s.percent,
    stage_index: s.stage_index,
    origin: `${s.origin_city}, ${s.origin_country}`,
    destination: `${s.dest_city}, ${s.dest_country}`,
    service: s.service_label,
    eta: s.eta_fmt,
    eta_iso: s.eta,
    days_left: s.days_left,
    is_delivered: s.is_delivered,
    delivered_fmt: s.delivered_fmt,

    // Everything the page needs to keep the marker moving between polls.
    live: {
      fraction: s.fraction,
      floor_t: s.floor_t,
      ceil_t: s.ceil_t,
      departed_at: s.departed_at,
      server_time: nowIso(),
      position_source: s.position_source,
      position: s.position_fmt,
      origin_xy: s.origin_xy,
      dest_xy: s.dest_xy,
      current_xy: s.current_xy,
      distance_km: s.distance_km,
      covered_km: s.covered_km,
      remaining_km: s.remaining_km
    },

    events: s.events.map((e) => ({
      status: e.status_label,
      status_key: e.status,
      location: e.location,
      country: e.country,
      occurred_at: e.occurred_at,
      occurred_fmt: e.occurred_fmt,
      is_flag: e.is_flag,
      note: e.note
    }))
  });
});

/**
 * Where a telematics box, an AIS feed or a driver app reports position.
 * Disabled unless KEELSON_FEED_TOKEN is set in the environment.
 */
app.post('/api/position/:number', (req, res) => {
  const token = process.env.KEELSON_FEED_TOKEN;
  if (!token) {
    return res.status(404).json({ ok: false, error: 'position feed is not enabled' });
  }
  const sent = Buffer.from(String(req.get('X-Keelson-Token') || ''));
  const want = Buffer.from(token);
  const ok = sent.length === want.length && crypto.timingSafeEqual(sent, want);
  if (!ok) return res.status(401).json({ ok: false, error: 'unauthorised' });

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, error: 'lat and lng are required numbers' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ ok: false, error: 'coordinates out of range' });
  }

  const num = cleanNumber(req.params.number);
  const row = get('SELECT id FROM shipments WHERE UPPER(tracking_number) = ?', num);
  if (!row) return res.status(404).json({ ok: false, error: 'no such shipment' });

  run('UPDATE shipments SET current_lat=?, current_lng=? WHERE id=?', lat, lng, row.id);
  res.json({ ok: true, tracking_number: num, lat, lng });
});

app.get('/api/quote', (req, res) => {
  const origin = LOCATION_INDEX[req.query.origin];
  const dest = LOCATION_INDEX[req.query.dest];
  const service = String(req.query.service || 'sea');
  const weight = Number(req.query.weight);
  if (!origin || !dest || !SERVICES[service] || !Number.isFinite(weight)) {
    return res.status(400).json({ ok: false });
  }
  const q = quote(origin, dest, service, weight);
  res.json({
    ok: true, cost: q.cost, distance_km: q.distanceKm,
    days: q.days, service: q.label
  });
});

// --------------------------------------------------------------------------
// Accounts
// --------------------------------------------------------------------------

app.route('/register')
  .get((req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('register.html', { form: {} });
  })
  .post((req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const company = String(req.body.company || '').trim();
    const password = String(req.body.password || '');

    const errors = [];
    if (!name) errors.push('Enter your name.');
    if (!email.includes('@')) errors.push('Enter a valid email address.');
    if (password.length < 8) errors.push('Use at least 8 characters for your password.');
    if (!errors.length && get('SELECT 1 FROM users WHERE email = ?', email)) {
      errors.push('That email already has an account. Sign in instead.');
    }
    if (errors.length) {
      errors.forEach((e) => req.flash(e, 'error'));
      return res.render('register.html', { form: req.body });
    }

    run('INSERT INTO users (email, password_hash, name, company, role, created_at)' +
        " VALUES (?,?,?,?,'customer',?)",
        email, hashPassword(password), name, company, nowIso());
    req.session.userId = get('SELECT id FROM users WHERE email = ?', email).id;
    req.flash('Account created. Book your first shipment to get a tracking number.', 'success');
    res.redirect('/dashboard');
  });

app.route('/login')
  .get((req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('login.html', { form: {}, next: req.query.next || '' });
  })
  .post((req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const row = get('SELECT * FROM users WHERE email = ?', email);
    if (!row || !checkPassword(row.password_hash, password)) {
      req.flash("That email and password don't match an account.", 'error');
      return res.render('login.html', { form: req.body, next: req.body.next || '' });
    }
    req.session.userId = row.id;
    const next = req.query.next || req.body.next;
    if (next && String(next).startsWith('/')) return res.redirect(String(next));
    res.redirect(row.role === 'admin' ? '/admin' : '/dashboard');
  });

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// --------------------------------------------------------------------------
// Customer
// --------------------------------------------------------------------------

app.get('/dashboard', loginRequired, (req, res) => {
  const statusFilter = String(req.query.status || '');
  const q = String(req.query.q || '').trim();

  let sql = 'SELECT * FROM shipments WHERE user_id = ?';
  const params = [req.user.id];
  if (statusFilter in ALL_STATUSES) {
    sql += ' AND status = ?';
    params.push(statusFilter);
  }
  if (q) {
    sql += ' AND (tracking_number LIKE ? OR origin_city LIKE ? OR dest_city LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY datetime(created_at) DESC';

  const shipments = all(sql, ...params).map((r) => decorate(r));
  const rows = all('SELECT status FROM shipments WHERE user_id = ?', req.user.id);
  res.render('dashboard.html', {
    shipments,
    status_filter: statusFilter,
    q,
    stats: {
      total: rows.length,
      active: rows.filter((r) => !['delivered', 'cancelled'].includes(r.status)).length,
      delivered: rows.filter((r) => r.status === 'delivered').length,
      attention: rows.filter((r) => r.status in FLAG_STATES).length
    }
  });
});

function parseShipmentForm(body) {
  const errors = [];
  const origin = LOCATION_INDEX[body.origin];
  const dest = LOCATION_INDEX[body.dest];
  const service = String(body.service || 'sea');

  if (!origin) errors.push('Choose a collection port.');
  if (!dest) errors.push('Choose a delivery port.');
  if (body.origin && body.origin === body.dest) {
    errors.push('Collection and delivery ports must be different.');
  }
  if (!SERVICES[service]) errors.push('Choose a freight service.');

  const weight = Number(body.weight_kg);
  if (!Number.isFinite(weight) || weight <= 0) errors.push('Enter a weight above zero.');
  const pieces = Number.parseInt(body.pieces ?? '1', 10);
  if (!Number.isInteger(pieces) || pieces < 1) {
    errors.push('A shipment needs at least one piece.');
  }
  if (errors.length) return { errors };

  const q = quote(origin, dest, service, weight);
  return {
    errors: [],
    data: {
      origin, dest, service,
      cargo_type: String(body.cargo_type || 'General cargo').trim() || 'General cargo',
      weight_kg: weight,
      pieces,
      cost_usd: q.cost,
      days: q.days,
      shipper_name: String(body.shipper_name || '').trim(),
      recipient_name: String(body.recipient_name || '').trim(),
      recipient_email: String(body.recipient_email || '').trim(),
      recipient_addr: String(body.recipient_addr || '').trim(),
      notes: String(body.notes || '').trim()
    }
  };
}

function createShipment(data, userId = null) {
  const num = newTrackingNumber();
  const created = new Date();
  const eta = new Date(created.getTime() + data.days * 86400000);
  const { origin: o, dest: d } = data;

  run(
    'INSERT INTO shipments' +
    ' (tracking_number, container_no, user_id,' +
    '  origin_city, origin_country, origin_lat, origin_lng,' +
    '  dest_city, dest_country, dest_lat, dest_lng,' +
    '  service, status, cargo_type, weight_kg, pieces, cost_usd,' +
    '  shipper_name, recipient_name, recipient_email, recipient_addr,' +
    '  notes, created_at, eta)' +
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'booked',?,?,?,?,?,?,?,?,?,?,?)",
    num, newContainerNo(data.service), userId,
    o.city, o.country, o.lat, o.lng, d.city, d.country, d.lat, d.lng,
    data.service, data.cargo_type, data.weight_kg, data.pieces, data.cost_usd,
    data.shipper_name, data.recipient_name, data.recipient_email,
    data.recipient_addr, data.notes, toIso(created), toIso(eta)
  );

  const sid = get('SELECT id FROM shipments WHERE tracking_number = ?', num).id;
  run('INSERT INTO events (shipment_id, status, location, country, note,' +
      " occurred_at, created_at) VALUES (?,'booked',?,?,?,?,?)",
      sid, o.city, o.country, 'Booking confirmed. Awaiting collection.',
      toIso(created), nowIso());
  return { num, sid };
}

app.route('/shipments/new')
  .get(loginRequired, (req, res) => res.render('shipment_new.html', { form: {} }))
  .post(loginRequired, (req, res) => {
    const { errors, data } = parseShipmentForm(req.body);
    if (errors.length) {
      errors.forEach((e) => req.flash(e, 'error'));
      return res.render('shipment_new.html', { form: req.body });
    }
    const { num } = createShipment(data, req.user.id);
    req.flash(`Shipment booked. Tracking number ${num}.`, 'success');
    res.redirect('/track/' + num);
  });

// --------------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------------

app.get('/admin', adminRequired, (req, res) => {
  const statusFilter = String(req.query.status || '');
  const q = String(req.query.q || '').trim();

  let sql = 'SELECT s.*, u.name AS customer_name, u.email AS customer_email' +
            ' FROM shipments s LEFT JOIN users u ON u.id = s.user_id WHERE 1=1';
  const params = [];
  if (statusFilter in ALL_STATUSES) {
    sql += ' AND s.status = ?';
    params.push(statusFilter);
  }
  if (q) {
    sql += ' AND (s.tracking_number LIKE ? OR s.origin_city LIKE ?' +
           ' OR s.dest_city LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
    for (let i = 0; i < 5; i++) params.push(`%${q}%`);
  }
  sql += ' ORDER BY datetime(s.created_at) DESC';

  const shipments = all(sql, ...params).map((r) => decorate(r));
  const counts = Object.fromEntries(Object.keys(ALL_STATUSES).map((k) => [k, 0]));
  for (const r of all('SELECT status, COUNT(*) c FROM shipments GROUP BY status')) {
    counts[r.status] = r.c;
  }

  res.render('admin/dashboard.html', {
    shipments, counts, status_filter: statusFilter, q,
    stats: {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      moving: (counts.collected || 0) + (counts.in_transit || 0) +
              (counts.customs || 0) + (counts.out_for_delivery || 0),
      delivered: counts.delivered || 0,
      attention: Object.keys(FLAG_STATES).reduce((a, k) => a + (counts[k] || 0), 0),
      customers: get("SELECT COUNT(*) c FROM users WHERE role='customer'").c
    }
  });
});

app.route('/admin/shipments/new')
  .get(adminRequired, (req, res) => res.render('admin/shipment_new.html', {
    form: {},
    customers: all("SELECT id, name, email FROM users WHERE role='customer' ORDER BY name")
  }))
  .post(adminRequired, (req, res) => {
    const { errors, data } = parseShipmentForm(req.body);
    if (errors.length) {
      errors.forEach((e) => req.flash(e, 'error'));
      return res.render('admin/shipment_new.html', {
        form: req.body,
        customers: all("SELECT id, name, email FROM users WHERE role='customer' ORDER BY name")
      });
    }
    const uid = req.body.user_id ? Number(req.body.user_id) : null;
    const { num, sid } = createShipment(data, uid);
    req.flash(`Shipment ${num} created.`, 'success');
    res.redirect('/admin/shipments/' + sid);
  });

app.route('/admin/shipments/:id')
  .get(adminRequired, (req, res) => {
    const shipment = fetchShipment({ shipmentId: Number(req.params.id) });
    if (!shipment) {
      req.flash('No shipment with that id.', 'error');
      return res.redirect('/admin');
    }
    const customer = shipment.user_id
      ? get('SELECT name, email, company FROM users WHERE id=?', shipment.user_id)
      : null;
    res.render('admin/shipment_edit.html', { shipment, customer });
  })
  .post(adminRequired, (req, res) => {
    const id = Number(req.params.id);
    const action = req.body.action;

    if (action === 'add_event') {
      const status = String(req.body.status || '');
      const location = String(req.body.location || '').trim();
      if (!(status in ALL_STATUSES) || !location) {
        req.flash('A checkpoint needs a status and a location.', 'error');
      } else {
        const occurred = req.body.occurred_at
          ? toIso(new Date(req.body.occurred_at))
          : nowIso();
        const country = LOCATION_INDEX[location]?.country ?? '';
        run('INSERT INTO events (shipment_id, status, location, country, note,' +
            ' occurred_at, created_at) VALUES (?,?,?,?,?,?,?)',
            id, status, location, country,
            String(req.body.note || '').trim(), occurred, nowIso());

        // The newest checkpoint becomes the shipment's status.
        if (status === 'delivered') {
          const signed = String(req.body.signed_by || '').trim() || null;
          run('UPDATE shipments SET status=?, delivered_at=?, signed_by=? WHERE id=?',
              status, occurred, signed, id);
        } else {
          run('UPDATE shipments SET status=?, delivered_at=NULL WHERE id=?', status, id);
        }
        req.flash('Checkpoint added. Customers can see it now.', 'success');
      }

    } else if (action === 'update_details') {
      const weight = Number(req.body.weight_kg);
      const pieces = Number.parseInt(req.body.pieces ?? '1', 10);
      const cost = Number(req.body.cost_usd);
      if (![weight, cost].every(Number.isFinite) || !Number.isInteger(pieces)) {
        req.flash('Weight, pieces and cost must be numbers.', 'error');
        return res.redirect('/admin/shipments/' + id);
      }
      run('UPDATE shipments SET cargo_type=?, weight_kg=?, pieces=?, cost_usd=?,' +
          ' recipient_name=?, recipient_email=?, recipient_addr=?, notes=?, eta=?' +
          ' WHERE id=?',
          String(req.body.cargo_type || '').trim(), weight, pieces, cost,
          String(req.body.recipient_name || '').trim(),
          String(req.body.recipient_email || '').trim(),
          String(req.body.recipient_addr || '').trim(),
          String(req.body.notes || '').trim(),
          req.body.eta || null, id);
      req.flash('Shipment details saved.', 'success');

    } else if (action === 'report_position') {
      const latRaw = String(req.body.current_lat || '').trim();
      const lngRaw = String(req.body.current_lng || '').trim();
      if (!latRaw && !lngRaw) {
        run('UPDATE shipments SET current_lat=NULL, current_lng=NULL WHERE id=?', id);
        req.flash('Reported position cleared. The map is back to an estimate.', 'success');
      } else {
        const lat = Number(latRaw);
        const lng = Number(lngRaw);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          req.flash('Latitude and longitude must be numbers.', 'error');
          return res.redirect('/admin/shipments/' + id);
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          req.flash('Latitude must be between -90 and 90, longitude between -180 and 180.', 'error');
          return res.redirect('/admin/shipments/' + id);
        }
        run('UPDATE shipments SET current_lat=?, current_lng=? WHERE id=?', lat, lng, id);
        req.flash('Position reported. Customers see it on the map now.', 'success');
      }

    } else if (action === 'delete_event') {
      run('DELETE FROM events WHERE id=? AND shipment_id=?',
          Number(req.body.event_id), id);
      req.flash('Checkpoint removed.', 'success');
    }

    res.redirect('/admin/shipments/' + id);
  });

app.get('/admin/customers', adminRequired, (req, res) => {
  const customers = all(
    'SELECT u.id, u.name, u.email, u.company, u.created_at,' +
    ' COUNT(s.id) AS shipment_count,' +
    " SUM(CASE WHEN s.status NOT IN ('delivered','cancelled') THEN 1 ELSE 0 END) AS active" +
    ' FROM users u LEFT JOIN shipments s ON s.user_id = u.id' +
    " WHERE u.role = 'customer'" +
    ' GROUP BY u.id ORDER BY shipment_count DESC, u.name'
  ).map((c) => ({ ...c, created_fmt: fmtDate(c.created_at, false), active: c.active || 0 }));
  res.render('admin/customers.html', { customers });
});

// --------------------------------------------------------------------------

app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/mark.svg'));

app.use((req, res) => res.status(404).render('404.html'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('404.html');
});

app.listen(PORT, () => {
  console.log(`Keelson running on http://localhost:${PORT}`);
});

export default app;
