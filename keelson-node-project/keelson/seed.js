/**
 * Create the Keelson database and fill it with demo shipments.
 *
 *   npm run seed
 *
 * Re-running drops everything and starts clean.
 */
import { DB_PATH, get, resetSchema, run } from './lib/db.js';
import { hashPassword } from './lib/auth.js';
import {
  LOCATION_INDEX, SERVICES, haversineKm, toIso
} from './lib/shipments.js';

// A small seeded PRNG, so the demo data is the same between runs.
let seed = 7;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const randInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Each demo shipment: route, service, cargo, weight, and where it has got to.
// How long ago it was booked is derived from that, so an in-transit shipment
// always has an arrival date in the future.
const PLAN = [
  ['Shanghai', 'Rotterdam', 'sea', 'Electronics', 1200, 'in_transit'],
  ['Busan', 'Los Angeles', 'sea', 'Automotive parts', 8400, 'customs'],
  ['Hong Kong', 'Felixstowe', 'air', 'Medical devices', 340, 'out_for_delivery'],
  ['Nhava Sheva', 'Hamburg', 'sea', 'Textiles', 5600, 'in_transit'],
  ['Singapore', 'Sydney', 'air', 'Semiconductors', 95, 'delivered'],
  ['Santos', 'Valencia', 'sea', 'Coffee, green beans', 19000, 'delayed'],
  ['Jebel Ali', 'Durban', 'sea', 'Industrial pumps', 3200, 'collected'],
  ['Tokyo', 'New York', 'air', 'Precision instruments', 210, 'in_transit'],
  ['Antwerp', 'Colombo', 'sea', 'Chemicals, class 8', 7100, 'booked'],
  ['Los Angeles', 'Tokyo', 'air', 'Aerospace components', 480, 'delivered'],
  ['Hamburg', 'Nhava Sheva', 'land', 'Machinery', 2400, 'exception'],
  ['Rotterdam', 'Valencia', 'land', 'Refrigerated produce', 1800, 'out_for_delivery'],
  ['Colombo', 'Felixstowe', 'sea', 'Tea, bulk', 11200, 'in_transit'],
  ['Sydney', 'Singapore', 'sea', 'Wool bales', 6400, 'delivered'],
  ['New York', 'Antwerp', 'air', 'Pharmaceuticals', 120, 'customs'],
  ['Durban', 'Shanghai', 'sea', 'Ferrochrome', 24000, 'booked']
];

// How much of the journey is behind a shipment sitting at each status.
const ELAPSED = {
  booked: 0.03,
  collected: 0.12,
  in_transit: 0.5,
  customs: 0.82,
  out_for_delivery: 0.94,
  delivered: 1.0,
  delayed: 0.62,
  exception: 0.45
};

const CUSTOMERS = [
  ['Wade Warren', 'wade@northbeamtrading.com', 'Northbeam Trading'],
  ['Esther Howard', 'esther@kirosupply.com', 'Kiro Supply Co'],
  ['Devon Lane', 'devon@atlasparts.eu', 'Atlas Parts BV'],
  ['Arlene McCoy', 'arlene@verdantfoods.com', 'Verdant Foods']
];

const PIPELINE = ['booked', 'collected', 'in_transit', 'customs',
                  'out_for_delivery', 'delivered'];

const NOTES = {
  booked: 'Booking confirmed. Awaiting collection.',
  collected: 'Collected from shipper and received at origin terminal.',
  in_transit: 'Departed origin terminal.',
  customs: 'Lodged with customs for import clearance.',
  out_for_delivery: 'On vehicle for final delivery.',
  delivered: 'Delivered and signed for.',
  delayed: 'Held at port. Berth congestion is delaying onward movement.',
  exception: 'Documentation query raised. Our team has contacted the shipper.'
};

const SIGNERS = ['R. Okafor', 'M. Dubois', 'K. Tanaka', 'L. Hendriks', 'P. Silva'];
const WAYPOINTS = ['Port of Singapore', 'Suez Canal', 'Panama Canal',
                   'Strait of Malacca', 'Gibraltar', 'Cape Town anchorage'];

const days = (n) => n * 86400000;

function main() {
  resetSchema();
  const now = new Date();

  // ---- users ------------------------------------------------------------
  run('INSERT INTO users (email, password_hash, name, company, role, created_at)' +
      " VALUES (?,?,?,?,'admin',?)",
      'admin@keelson.com', hashPassword('keelson123'),
      'Operations Desk', 'Keelson', toIso(new Date(now - days(400))));

  const customerIds = [];
  for (const [name, email, company] of CUSTOMERS) {
    run('INSERT INTO users (email, password_hash, name, company, role, created_at)' +
        " VALUES (?,?,?,?,'customer',?)",
        email, hashPassword('demo1234'), name, company,
        toIso(new Date(now - days(randInt(60, 360)))));
    customerIds.push(get('SELECT id FROM users WHERE email=?', email).id);
  }

  // The first customer owns the demo dashboard, so give them a good spread.
  const owners = [...Array(6).fill(customerIds[0]),
                  ...customerIds.slice(1), ...customerIds.slice(1),
                  ...customerIds.slice(1)];

  // ---- shipments --------------------------------------------------------
  PLAN.forEach(([oCity, dCity, service, cargo, weight, status], i) => {
    const o = LOCATION_INDEX[oCity];
    const d = LOCATION_INDEX[dCity];
    const km = haversineKm(o.lat, o.lng, d.lat, d.lng);
    const cfg = SERVICES[service];
    const cost = 85 + (km / 1000) * cfg.rate * Math.max(weight, 1) ** 0.62;
    const transitDays = Math.max(
      1, Math.round(km / cfg.speedKmh / 24) + (service === 'sea' ? 3 : 1)
    );

    const num = 'KLN' + Array.from({ length: 9 }, () => randInt(0, 9)).join('');
    const owner = owners[i % owners.length];

    let created, eta, deliveredAt = null, signedBy = null;
    if (status === 'delivered') {
      // Landed a while back, so the history reads as finished.
      created = new Date(now - days(transitDays + randInt(2, 18)));
      eta = new Date(created.getTime() + days(transitDays));
      deliveredAt = toIso(new Date(eta.getTime() - randInt(2, 30) * 3600000));
      signedBy = pick(SIGNERS);
    } else {
      const elapsed = transitDays * ELAPSED[status];
      created = new Date(now - days(elapsed) - randInt(0, 12) * 3600000);
      eta = new Date(created.getTime() + days(transitDays));
      if (status === 'delayed' || status === 'exception') {
        eta = new Date(eta.getTime() + days(randInt(3, 8)));
      }
    }

    run(
      'INSERT INTO shipments' +
      ' (tracking_number, container_no, user_id,' +
      '  origin_city, origin_country, origin_lat, origin_lng,' +
      '  dest_city, dest_country, dest_lat, dest_lng,' +
      '  service, status, cargo_type, weight_kg, pieces, cost_usd,' +
      '  shipper_name, recipient_name, recipient_email, recipient_addr,' +
      '  signed_by, notes, created_at, eta, delivered_at)' +
      ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      num, ({ sea: 'KLNU', air: 'AWB', land: 'KLNT' }[service]) + ' ' +
        Array.from({ length: 6 }, () => randInt(0, 9)).join(''),
      owner,
      o.city, o.country, o.lat, o.lng, d.city, d.country, d.lat, d.lng,
      service, status, cargo, weight, randInt(1, 40), Number(cost.toFixed(2)),
      'Northbeam Trading Ltd', 'Consignee on file', 'ops@example.com',
      `${d.city} terminal, ${d.country}`, signedBy, '',
      toIso(created), toIso(eta), deliveredAt
    );
    const sid = get('SELECT id FROM shipments WHERE tracking_number=?', num).id;

    // ---- checkpoint history ---------------------------------------------
    const isFlag = !PIPELINE.includes(status);
    const reached = isFlag ? PIPELINE.slice(0, 3)
                           : PIPELINE.slice(0, PIPELINE.indexOf(status) + 1);
    const endAt = Math.min(now.getTime(), eta.getTime());
    const span = endAt - created.getTime();

    reached.forEach((stage, stepI) => {
      const frac = reached.length > 1 ? stepI / (reached.length - 1) : 0;
      let when = new Date(created.getTime() + span * frac * 0.92);
      if (stage === 'delivered' && deliveredAt) when = new Date(deliveredAt);

      let loc, country;
      if (stage === 'in_transit') {
        loc = pick(WAYPOINTS);
        country = 'In transit';
      } else if (['customs', 'out_for_delivery', 'delivered'].includes(stage)) {
        loc = d.city; country = d.country;
      } else {
        loc = o.city; country = o.country;
      }

      let note = NOTES[stage];
      if (stage === 'delivered' && signedBy) {
        note = `Delivered and signed for by ${signedBy}.`;
      }
      run('INSERT INTO events (shipment_id, status, location, country, note,' +
          ' occurred_at, created_at) VALUES (?,?,?,?,?,?,?)',
          sid, stage, loc, country, note, toIso(when), toIso(when));
    });

    if (isFlag) {
      const when = new Date(created.getTime() + span * 0.75);
      run('INSERT INTO events (shipment_id, status, location, country, note,' +
          ' occurred_at, created_at) VALUES (?,?,?,?,?,?,?)',
          sid, status, d.city, d.country, NOTES[status], toIso(when), toIso(when));
    }
  });

  const counts = {
    users: get('SELECT COUNT(*) c FROM users').c,
    shipments: get('SELECT COUNT(*) c FROM shipments').c,
    events: get('SELECT COUNT(*) c FROM events').c
  };

  console.log('Database ready at', DB_PATH);
  console.log(`  ${counts.users} users, ${counts.shipments} shipments, ${counts.events} checkpoints`);
  console.log();
  console.log('Sign in as staff:     admin@keelson.com / keelson123');
  console.log('Sign in as customer:  wade@northbeamtrading.com / demo1234');
  console.log();
  console.log('Sample tracking numbers:');
  const samples = [];
  for (const r of [1, 2, 3, 4, 5, 6]) {
    const row = get('SELECT tracking_number, status, origin_city, dest_city' +
                    ' FROM shipments WHERE id=?', r);
    if (row) samples.push(row);
  }
  for (const r of samples) {
    console.log(`  ${r.tracking_number}  ${r.status.padEnd(16)} ${r.origin_city} -> ${r.dest_city}`);
  }
}

main();
