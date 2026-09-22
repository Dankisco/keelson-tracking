# Keelson

A freight tracking and logistics site — public tracking, customer accounts, and
a staff operations panel. **Node.js + Express + SQLite.**

## Running it

```bash
npm install
npm run seed
npm start
```

Then open http://localhost:5000

`npm run dev` restarts on file changes. `npm run seed` creates
`instance/keelson.db` and fills it with 16 demo shipments across every status —
**re-running it wipes the database and starts clean**, so only run it again when
you want fresh demo data.

Requires **Node 22.5 or newer** for the built-in `node:sqlite` module.

## Demo sign-ins

| Role | Email | Password |
|------|-------|----------|
| Operations (staff) | admin@keelson.com | keelson123 |
| Customer | wade@northbeamtrading.com | demo1234 |

The other seeded customers (`esther@kirosupply.com`, `devon@atlasparts.eu`,
`arlene@verdantfoods.com`) also use `demo1234`.

## Dependencies

Three, all pure JavaScript — nothing to compile, so `npm install` cannot fail
over missing build tools:

| Package | Why |
|---------|-----|
| `express` | routing and middleware |
| `nunjucks` | templates (a JavaScript port of Jinja2) |
| `cookie-session` | signed cookie sessions |

SQLite comes from Node's own `node:sqlite`, and password hashing from
`node:crypto` — no `better-sqlite3`, no `bcrypt`.

## What's in it

**Public** — no sign-in needed
- Tracking by number, with route map, stepped progress, checkpoint history and ETA
- The tracking page updates itself — see **Live tracking** below
- A help page: statuses explained, customs, claims, and how to spot a fake
  tracking link
- Shareable tracking link and a print stylesheet
- `GET /api/track/:number` returns the same data as JSON

**Customer accounts**
- Register, sign in, sign out; passwords hashed with scrypt
- Dashboard with counts, status filters and search
- Book a shipment, with a live cost and transit-time estimate

**Operations panel** (`/admin`, staff only)
- Every shipment, filterable by status and searchable by number, port or customer
- Create shipments against any customer account
- Add checkpoints — the newest one sets the shipment's status and appears on the
  customer's tracking page immediately
- Edit cargo, cost, ETA and consignee details; report or clear a position
- Customer list with shipment counts

## How a shipment moves

Six stages, in order: `booked → collected → in_transit → customs →
out_for_delivery → delivered`.

Three states interrupt rather than advance: `delayed`, `exception`, `cancelled`.
A shipment in one of those holds its place on the bar at the last stage it
actually completed, so the customer still sees how far it got.

## Live tracking

The tracking page updates itself. A customer can leave it open and the shipment
keeps moving without a refresh.

**Where the position comes from**, in order of preference:

1. **A reported fix.** If `shipments.current_lat` / `current_lng` are set, that
   is what the map shows, labelled *Reported position*.
2. **An estimate.** Otherwise the position is interpolated along the route from
   elapsed time, labelled *Estimated position*, with a note on the page saying
   it is derived from the schedule and not a satellite fix.

The estimate is **bounded by checkpoints**: elapsed time moves the marker, but
it can never travel past the next confirmed checkpoint.

**Two clocks run in the browser.** Every 5 seconds the page recomputes the
position locally using the same formula as the server (`fractionNow` in
`public/js/keelson.js` mirrors `decorate` in `lib/shipments.js` — change one,
change the other). Every 25 seconds it polls `/api/track/:number` for new
checkpoints, status and ETA. Without JavaScript the page still renders a
correct position at load.

### Feeding real positions

Ops can enter a fix by hand in the operations panel under **Report a position**.
Clearing both fields returns the map to the estimate.

For an automated feed — telematics box, AIS, driver app — there is a POST
endpoint, **disabled unless you set a token**:

```bash
KEELSON_FEED_TOKEN=some-long-random-string npm start
```

```bash
curl -X POST http://localhost:5000/api/position/KLN186091390 \
  -H "X-Keelson-Token: some-long-random-string" \
  -H "Content-Type: application/json" \
  -d '{"lat": 36.14, "lng": -5.35}'
```

With no token set it returns 404, so it cannot be probed on a default install.

**What this is not:** there is no GPS, AIS or carrier integration built in. The
map shows a genuine measured position only when something feeds one in.

## Layout

```
server.js               every route
schema.sql              tables
seed.js                 demo data
lib/
  db.js                 node:sqlite connection, migration, query helpers
  shipments.js          stages, geometry, the position estimate
  auth.js               scrypt password hashing
  views.js              nunjucks setup, filters, globals
  company.js            YOUR company details - see below
views/                  nunjucks templates
public/                 css, client JavaScript, images
tools/
  smoke.mjs             behaviour tests against a running server
  brand_trailer.py      paints the logo onto the lorry photo (Python + Pillow)
  port_templates.py     the Jinja2 -> Nunjucks translation, kept for reference
  Archivo.ttf           the brand font, for the trailer artwork
instance/keelson.db     the database (created by npm run seed)
```

## The logo on the lorry

The KEELSON logo on the trailer is painted into the image file, not overlaid in
CSS — a CSS overlay would drift off the trailer every time the hero re-crops at
a different screen width.

```bash
python tools/brand_trailer.py
```

This one script is Python, because it uses Pillow for the perspective transform;
it is a build-time tool and the site itself does not need Python. It always
works from `public/img/_freight-land-original.webp`, so re-running never stacks
logos. To move or resize the artwork, edit `QUAD` at the top of the script.

## Testing

With the server running:

```bash
node tools/smoke.mjs
```

Thirteen checks covering registration, booking, checkpoints, position
reporting, and the rules that matter — that validation rejects bad input, that
customers cannot reach staff pages, and that progress stays inside the band its
checkpoints allow.

## Filling in the company details

Everything the site claims about who Keelson is comes from `lib/company.js`.
**Anything left as `null` simply doesn't appear** — the row, line or block is
skipped and the surrounding copy still reads correctly. Fill a value in and it
shows up on its own, in the footer and on the help page.

`claim_window` and `liability_cover` are contractual terms — take them from your
actual trading conditions, not from an estimate.

## Trust content on the landing page

The figures under the hero are counted from the database on every request:
shipments under way, checkpoints logged in the last seven days, distinct ports
and countries. They are real counts, which is the point — so they will read as
demo numbers until there is real traffic.

Deliberately **not** included: an on-time percentage, customer counts, review
scores or testimonials. Those would be fabrications until you have the data.

## Design notes

Orange marks one thing and one thing only: position and progress. It is never
decoration. The same orange line is the route arc on the map, the fill on the
stepped progress bar, and the spine of the checkpoint timeline.

The world map is real geometry — Natural Earth 110m land data, public domain,
projected equirectangularly into a 1000×460 viewBox and filled with a dot
pattern. See `ATTRIBUTION.md`.

## Before this goes live

- Set `KEELSON_SECRET` to a long random value. The fallback in `server.js` is a
  development placeholder, and anyone who knows it can forge a session.
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Run behind a reverse proxy over HTTPS, and set `NODE_ENV=production` so the
  session cookie is marked `secure`.
- Add CSRF protection to the forms before accepting real customer data.
- The freight rates in `lib/shipments.js` are invented. Replace them with your
  real tariff before quoting anyone.
- Check the photograph licensing in `ATTRIBUTION.md`.
