import nunjucks from 'nunjucks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPANY } from './company.js';
import {
  ALL_STATUSES, FLAG_STATES, LOCATIONS, SERVICES, STAGES, STATUS_HELP
} from './shipments.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function configureViews(app) {
  const env = nunjucks.configure(path.join(ROOT, 'views'), {
    autoescape: true,
    express: app,
    // noCache re-reads templates on every render in development. Nunjucks'
    // own `watch` needs chokidar; `npm run dev` uses node --watch instead.
    noCache: process.env.NODE_ENV !== 'production'
  });

  // Replaces Python's "{:,.0f}".format(n) and "{:,.2f}".format(n).
  env.addFilter('num', (value, places = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n.toLocaleString('en-GB', {
      minimumFractionDigits: places,
      maximumFractionDigits: places
    });
  });

  // Replaces Python's string slicing, e.g. shipment.eta[:10].
  env.addFilter('head', (value, n) =>
    typeof value === 'string' ? value.slice(0, n) : value);

  // First word of a name, for "Wade's shipments".
  env.addFilter('firstword', (value) => String(value || '').split(' ')[0]);

  // The routes the filter chips link back to.
  const ROUTES = { dashboard: '/dashboard', admin_dashboard: '/admin' };
  env.addFilter('route', (name) => ROUTES[name] ?? '/');

  /**
   * A query-string fragment, or nothing when the value is empty - Flask's
   * url_for dropped None arguments, and the chips rely on that.
   *   {{ q | qs('q') }}        -> "&q=cairo"   (appended to an existing ?...)
   *   {{ q | qs('q', true) }}  -> "?q=cairo"   (starts the query string)
   */
  env.addFilter('qs', (value, key, first = false) => {
    if (value === null || value === undefined || value === '') return '';
    return (first ? '?' : '&') + key + '=' + encodeURIComponent(String(value));
  });

  // Things every template can reach, the way Flask's context processor did.
  env.addGlobal('STAGES', STAGES);
  env.addGlobal('FLAG_STATES', FLAG_STATES);
  env.addGlobal('ALL_STATUSES', ALL_STATUSES);
  env.addGlobal('SERVICES', SERVICES);
  env.addGlobal('LOCATIONS', LOCATIONS);
  env.addGlobal('STATUS_HELP', STATUS_HELP);
  env.addGlobal('COMPANY', COMPANY);

  app.set('views', path.join(ROOT, 'views'));
  app.set('view engine', 'html');
  return env;
}
