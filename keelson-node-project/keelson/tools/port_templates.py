"""Translate the Jinja2 templates to Nunjucks.

Run from keelson-node/:  python tools/port_templates.py

Nunjucks is a JavaScript port of Jinja2, so the structure carries over intact.
What differs is Flask's helpers (url_for, get_flashed_messages, request) and a
handful of Python expressions. Each rule below fixes one of those.
"""
import os
import re

VIEWS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "views")

# --- Flask's url_for, which Express does not have --------------------------
URLS = [
    (r"url_for\('static', filename='([^']+)'\)", r"/static/\1"),
    (r"url_for\('index'\)", "/"),
    (r"url_for\('help_page'\)", "/help"),
    (r"url_for\('login'\)", "/login"),
    (r"url_for\('logout'\)", "/logout"),
    (r"url_for\('register'\)", "/register"),
    (r"url_for\('dashboard'\)", "/dashboard"),
    (r"url_for\('shipment_new'\)", "/shipments/new"),
    (r"url_for\('track_redirect'\)", "/track"),
    (r"url_for\('admin_dashboard'\)", "/admin"),
    (r"url_for\('admin_customers'\)", "/admin/customers"),
    (r"url_for\('admin_shipment_new'\)", "/admin/shipments/new"),
    # ones that take arguments
    (r"url_for\('track', tracking_number=([a-zA-Z_.]+), _external=true\)",
     r"{{ base_url }}/track/{{ \1 }}"),
    (r"url_for\('track', tracking_number=([a-zA-Z_.]+)\)", r"/track/{{ \1 }}"),
    (r"url_for\('admin_shipment_edit', shipment_id=([a-zA-Z_.]+)\)",
     r"/admin/shipments/{{ \1 }}"),
    # filter links, where Flask dropped a None argument from the query string
    (r"url_for\('(dashboard|admin_dashboard)', status=key, q=q or none\)",
     r"{{ '\1' | route }}?status={{ key }}{{ q | qs('q') }}"),
    (r"url_for\('(dashboard|admin_dashboard)', q=q or none\)",
     r"{{ '\1' | route }}{{ q | qs('q', true) }}"),
]

# --- everything else -------------------------------------------------------
RULES = [
    # STAGES is a list of objects now, not a list of tuples.
    (r"\{% for key, label in STAGES %\}", "{% for stage in STAGES %}{% set key = stage.key %}{% set label = stage.label %}"),
    # Nunjucks iterates a plain object as key, value.
    (r"FLAG_STATES\.items\(\)", "FLAG_STATES"),
    (r"SERVICES\.items\(\)", "SERVICES"),
    # LOCATIONS is a list of objects now.
    (r"\{% for city, country, lat, lng in LOCATIONS %\}",
     "{% for loc in LOCATIONS %}{% set city = loc.city %}{% set country = loc.country %}"),
    # Python's format mini-language has no Nunjucks equivalent.
    (r"'\{:,\.0f\}'\.format\(([^)]+)\)", r"\1 | num"),
    (r"'\{:,\.2f\}'\.format\(([^)]+)\)", r"\1 | num(2)"),
    (r"'\{:,\}'\.format\(([^)]+)\)", r"\1 | num"),
    # Python slicing.
    (r"shipment\.eta\[:10\]", "shipment.eta | head(10)"),
    # None vs null.
    (r"\bis not none\b", "!== null"),
    (r"\bis none\b", "=== null"),
    # Flask request helpers.
    (r"request\.args\.get\('next'\)", "next"),
    (r"\{% if request\.blueprint === null and request\.endpoint and request\.endpoint\.startswith\('admin'\) %\}",
     "{% if nav.startsWith('/admin') %}"),
    (r"request\.endpoint == 'index'", "nav == '/'"),
    (r"request\.endpoint == 'help_page'", "nav == '/help'"),
    (r"request\.endpoint == 'dashboard'", "nav == '/dashboard'"),
    (r"request\.endpoint == 'shipment_new'", "nav == '/shipments/new'"),
    (r"request\.endpoint == 'login'", "nav == '/login'"),
    # Calling .split on a string works in Nunjucks, but a filter is clearer.
    (r"user\.name\.split\(' '\)\[0\]", "user.name | firstword"),
    # Flask's form.get(key, default).
    (r"form\.get\('([a-z_]+)', '([^']*)'\)", r"form.\1 or '\2'"),
    (r"form\.get\('([a-z_]+)', (\d+)\)", r"form.\1 or \2"),
    (r"form\.get\('([a-z_]+)'\)", r"form.\1"),
]

FLASHES = re.compile(
    r"\{% with messages = get_flashed_messages\(with_categories=true\) %\}.*?\{% endwith %\}",
    re.S)

FLASHES_NEW = """{% if flashes and flashes.length %}
  <div class="wrap"><div class="flashes">
    {% for f in flashes %}
      <div class="flash {{ f.category }}"><i></i><span>{{ f.message }}</span></div>
    {% endfor %}
  </div></div>
{% endif %}"""


def port(text):
    for pattern, repl in URLS + RULES:
        text = re.sub(pattern, repl, text)
    text = FLASHES.sub(FLASHES_NEW, text)
    # A url_for(...) inside {{ }} that became a bare path needs the braces gone.
    text = re.sub(r"\{\{ (/[a-z/]*(?:\{\{ [a-zA-Z_.]+ \}\})?[a-z/.]*) \}\}", r"\1", text)
    text = text.replace("{{ {{", "{{").replace("}} }}", "}}")
    return text


def main():
    changed = 0
    for root, _dirs, files in os.walk(VIEWS):
        for name in sorted(files):
            if not name.endswith(".html"):
                continue
            path = os.path.join(root, name)
            original = open(path, encoding="utf-8").read()
            ported = port(original)
            if ported != original:
                open(path, "w", encoding="utf-8").write(ported)
                changed += 1
                print("ported", os.path.relpath(path, VIEWS).replace("\\", "/"))
    print("\n%d template(s) changed" % changed)


if __name__ == "__main__":
    main()
