/**
 * Shipment vocabulary, geometry and progress.
 *
 * The position logic here is the single source of truth. public/js/keelson.js
 * repeats the same formula in the browser so the marker keeps moving between
 * polls; if you change `fractionFor` below, change it there too.
 */

// The linear pipeline every shipment walks.
export const STAGES = [
  { key: 'booked', label: 'Booked' },
  { key: 'collected', label: 'Collected' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'customs', label: 'Customs clearance' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' }
];
export const STAGE_KEYS = STAGES.map((s) => s.key);

// States that interrupt the pipeline rather than advance it.
export const FLAG_STATES = {
  delayed: 'Delayed',
  exception: 'Exception',
  cancelled: 'Cancelled'
};

export const ALL_STATUSES = {
  ...Object.fromEntries(STAGES.map((s) => [s.key, s.label])),
  ...FLAG_STATES
};

export const SERVICES = {
  sea: { label: 'Sea freight', speedKmh: 37, rate: 0.55 },
  air: { label: 'Air freight', speedKmh: 800, rate: 4.2 },
  land: { label: 'Land freight', speedKmh: 65, rate: 1.1 }
};

// Ports and hubs offered in the shipment form. Coordinates drive the map.
export const LOCATIONS = [
  { city: 'Shanghai', country: 'China', lat: 31.23, lng: 121.47 },
  { city: 'Rotterdam', country: 'Netherlands', lat: 51.92, lng: 4.48 },
  { city: 'Singapore', country: 'Singapore', lat: 1.29, lng: 103.85 },
  { city: 'Los Angeles', country: 'United States', lat: 33.74, lng: -118.27 },
  { city: 'Hamburg', country: 'Germany', lat: 53.55, lng: 9.99 },
  { city: 'Jebel Ali', country: 'UAE', lat: 25.01, lng: 55.06 },
  { city: 'Santos', country: 'Brazil', lat: -23.96, lng: -46.33 },
  { city: 'New York', country: 'United States', lat: 40.67, lng: -74.04 },
  { city: 'Busan', country: 'South Korea', lat: 35.1, lng: 129.04 },
  { city: 'Nhava Sheva', country: 'India', lat: 18.95, lng: 72.95 },
  { city: 'Antwerp', country: 'Belgium', lat: 51.26, lng: 4.4 },
  { city: 'Durban', country: 'South Africa', lat: -29.87, lng: 31.03 },
  { city: 'Sydney', country: 'Australia', lat: -33.86, lng: 151.21 },
  { city: 'Felixstowe', country: 'United Kingdom', lat: 51.96, lng: 1.35 },
  { city: 'Tokyo', country: 'Japan', lat: 35.65, lng: 139.76 },
  { city: 'Hong Kong', country: 'Hong Kong', lat: 22.3, lng: 114.17 },
  { city: 'Colombo', country: 'Sri Lanka', lat: 6.93, lng: 79.84 },
  { city: 'Valencia', country: 'Spain', lat: 39.45, lng: -0.33 }
];
export const LOCATION_INDEX = Object.fromEntries(LOCATIONS.map((l) => [l.city, l]));

// Plain-language meaning of every status, for customers reading a tracking page.
export const STATUS_HELP = {
  booked:
    'We have your booking and the paperwork. The cargo is still with you until collection.',
  collected: 'The cargo is with us and has been received at the origin terminal.',
  in_transit: 'On the vessel, aircraft or vehicle, moving between terminals.',
  customs:
    'Lodged with customs at the destination. Waits here are normal and are not under our control.',
  out_for_delivery:
    'On a vehicle for the final leg. Someone should be available to take delivery and sign.',
  delivered:
    'Signed for. The name of the person who signed is shown on the tracking page.',
  delayed:
    'Still moving, but it will arrive later than planned. The reason is written on the most recent checkpoint.',
  exception:
    'Something needs attention, usually documentation. We will have contacted the booking account already.',
  cancelled: 'The booking was withdrawn before the cargo moved.'
};

// --------------------------------------------------------------------------
// Geometry. Map viewport must match views/partials/worldmap.html
// --------------------------------------------------------------------------

const MAP_W = 1000.0;
const MAP_H = 460.0;
const LAT_TOP = 83.0;
const LAT_BOT = -56.0;

const round = (n, places = 2) => Number(n.toFixed(places));

/** Equirectangular projection into the map's SVG coordinate space. */
export function project(lat, lng) {
  const x = ((lng + 180.0) / 360.0) * MAP_W;
  const clamped = Math.max(LAT_BOT, Math.min(LAT_TOP, lat));
  const y = ((LAT_TOP - clamped) / (LAT_TOP - LAT_BOT)) * MAP_H;
  return [round(x), round(y)];
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const [p1, l1, p2, l2] = [rad(lat1), rad(lng1), rad(lat2), rad(lng2)];
  const dLat = p2 - p1;
  const dLng = l2 - l1;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 6371.0 * 2 * Math.asin(Math.sqrt(a));
}

// --------------------------------------------------------------------------
// Dates. Stored as naive local ISO strings, matching the Python build.
// --------------------------------------------------------------------------

export function toIso(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

export function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso, withTime = true) {
  const d = parseIso(iso);
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  const base = `${p(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${base}, ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// --------------------------------------------------------------------------
// Presentation
// --------------------------------------------------------------------------

function firstEventTime(events) {
  const times = (events || []).map((e) => parseIso(e.occurred_at)).filter(Boolean);
  return times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null;
}

export function decorateEvent(row) {
  return {
    ...row,
    status_label: ALL_STATUSES[row.status] ?? row.status,
    occurred_fmt: fmtDate(row.occurred_at),
    is_flag: row.status in FLAG_STATES
  };
}

/** Turn a shipment row into everything the templates need to draw it. */
export function decorate(row, events = null) {
  const s = { ...row };
  const status = s.status;
  s.status_label = ALL_STATUSES[status] ?? status;
  s.is_flag = status in FLAG_STATES;
  s.service_label = SERVICES[s.service]?.label ?? s.service;

  // Where on the pipeline are we? A flagged shipment holds at its last
  // completed stage rather than dropping off the bar entirely.
  let idx;
  if (STAGE_KEYS.includes(status)) {
    idx = STAGE_KEYS.indexOf(status);
  } else {
    idx = 0;
    for (const ev of events || []) {
      if (STAGE_KEYS.includes(ev.status)) {
        idx = Math.max(idx, STAGE_KEYS.indexOf(ev.status));
      }
    }
  }
  s.stage_index = idx;
  s.is_delivered = status === 'delivered';

  // --- how far along, as a continuous fraction --------------------------
  // Checkpoints set the floor and ceiling; elapsed time moves the shipment
  // within that band. So the marker creeps along minute by minute, but can
  // never claim to have passed a checkpoint it has not actually reached.
  const last = STAGES.length - 1;
  const floorT = idx / last;
  const ceilT = Math.min(1.0, (idx + 1) / last);

  const departed = firstEventTime(events) || parseIso(s.created_at);
  const eta = parseIso(s.eta);
  let timeT = floorT;
  if (departed && eta && eta > departed) {
    const elapsed = Date.now() - departed.getTime();
    const total = eta.getTime() - departed.getTime();
    timeT = Math.min(1, Math.max(0, elapsed / total));
  }

  let t;
  if (s.is_delivered) t = 1.0;
  else if (status === 'cancelled') t = floorT;
  else t = Math.min(ceilT, Math.max(floorT, timeT));

  s.fraction = round(t, 5);
  s.percent = Math.round(t * 100);
  s.departed_at = departed ? toIso(departed) : null;
  s.floor_t = round(floorT, 5);
  s.ceil_t = round(ceilT, 5);

  s.steps = STAGES.map((stage, i) => ({
    key: stage.key,
    label: stage.label,
    done: i <= idx,
    current: i === idx
  }));

  const [ox, oy] = project(s.origin_lat, s.origin_lng);
  const [dx, dy] = project(s.dest_lat, s.dest_lng);
  s.origin_xy = [ox, oy];
  s.dest_xy = [dx, dy];

  // Arc control point - bowed toward the poles so the route reads as a
  // great-circle rather than a straight ruler line.
  const mx = (ox + dx) / 2;
  const my = (oy + dy) / 2;
  const bow = Math.min(90.0, Math.abs(dx - ox) * 0.22 + 18);
  const ctrlY = my - bow;
  s.arc_d = `M${ox},${oy} Q${round(mx)},${round(ctrlY)} ${dx},${dy}`;

  // Where it is now. A position reported by the vehicle, the vessel's AIS or
  // a dispatcher always wins; otherwise we estimate it from the arc.
  const cx = (1 - t) ** 2 * ox + 2 * (1 - t) * t * mx + t ** 2 * dx;
  const cy = (1 - t) ** 2 * oy + 2 * (1 - t) * t * ctrlY + t ** 2 * dy;

  if (s.current_lat !== null && s.current_lat !== undefined &&
      s.current_lng !== null && s.current_lng !== undefined) {
    s.current_xy = project(s.current_lat, s.current_lng);
    s.position_source = 'reported';
    s.position_fmt = `${s.current_lat.toFixed(3)}, ${s.current_lng.toFixed(3)}`;
  } else {
    s.current_xy = [round(cx), round(cy)];
    s.position_source = 'estimated';
    s.position_fmt = null;
  }

  // The travelled leg, as its own path: split the quadratic at t
  // (de Casteljau) so the orange only covers ground already crossed.
  const ax = ox + (mx - ox) * t;
  const ay = oy + (ctrlY - oy) * t;
  s.arc_done_d = `M${ox},${oy} Q${round(ax)},${round(ay)} ${round(cx)},${round(cy)}`;

  s.distance_km = Math.round(
    haversineKm(s.origin_lat, s.origin_lng, s.dest_lat, s.dest_lng)
  );
  s.covered_km = Math.round(s.distance_km * t);
  s.remaining_km = Math.max(0, s.distance_km - s.covered_km);

  s.created_fmt = fmtDate(s.created_at, false);
  s.eta_fmt = fmtDate(s.eta, false);
  s.delivered_fmt = fmtDate(s.delivered_at);

  // Days remaining, counted from today.
  s.days_left = null;
  if (s.eta && !s.is_delivered) {
    const etaDate = parseIso(s.eta);
    if (etaDate) {
      const ms = startOfDay(etaDate) - startOfDay(new Date());
      s.days_left = Math.round(ms / 86400000);
    }
  }

  if (events !== null) {
    s.events = events.map(decorateEvent);
    s.last_event = s.events[0] ?? null;
  }
  return s;
}

/** Freight rate and transit time. The rates are placeholders - see README. */
export function quote(origin, dest, service, weightKg) {
  const km = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
  const cfg = SERVICES[service];
  const cost = 85 + (km / 1000.0) * cfg.rate * Math.max(weightKg, 1) ** 0.62;
  const days = Math.max(
    1,
    Math.round(km / cfg.speedKmh / 24) + (service === 'sea' ? 3 : 1)
  );
  return { distanceKm: Math.round(km), cost: round(cost), days, label: cfg.label };
}
