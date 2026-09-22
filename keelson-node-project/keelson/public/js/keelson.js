/* Keelson - progressive enhancement only. Every page works without this. */
(function () {
  "use strict";

  /* --- route lines: measure each path so the draw finishes on time ------ */
  document.querySelectorAll(".route-draw").forEach(function (path) {
    try {
      var len = path.getTotalLength();
      if (len > 0) path.style.setProperty("--len", len);
    } catch (e) { /* older engines: the line simply appears undrawn */ }
  });

  /* --- masthead gets a rule once the page scrolls ---------------------- */
  var head = document.querySelector(".masthead");
  if (head) {
    var onScroll = function () {
      head.classList.toggle("is-stuck", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* --- mobile navigation ------------------------------------------------ */
  var toggle = document.querySelector(".navtoggle");
  var nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* --- sample tracking number ------------------------------------------ */
  var sample = document.getElementById("usesample");
  if (sample) {
    sample.addEventListener("click", function () {
      var input = document.getElementById("number");
      if (!input) return;
      input.value = sample.dataset.number;
      input.focus();
    });
  }

  /* --- copy the tracking link ------------------------------------------ */
  var copy = document.getElementById("copylink");
  if (copy && navigator.clipboard) {
    copy.addEventListener("click", function () {
      navigator.clipboard.writeText(copy.dataset.url).then(function () {
        var was = copy.textContent;
        copy.textContent = "Link copied";
        setTimeout(function () { copy.textContent = was; }, 1800);
      });
    });
  }

  /* --- live freight estimate on the booking forms ---------------------- */
  var form = document.getElementById("bookform");
  if (form) {
    var origin = document.getElementById("origin");
    var dest = document.getElementById("dest");
    var service = document.getElementById("service");
    var weight = document.getElementById("weight");
    var out = {
      cost: document.getElementById("q-cost"),
      service: document.getElementById("q-service"),
      distance: document.getElementById("q-distance"),
      days: document.getElementById("q-days")
    };
    var timer = null;

    var blank = function () {
      out.cost.textContent = "—";
      out.service.textContent = "—";
      out.distance.textContent = "—";
      out.days.textContent = "—";
    };

    var quote = function () {
      if (!origin.value || !dest.value || origin.value === dest.value ||
          !weight.value || Number(weight.value) <= 0) {
        blank();
        return;
      }
      var url = "/api/quote?origin=" + encodeURIComponent(origin.value) +
                "&dest=" + encodeURIComponent(dest.value) +
                "&service=" + encodeURIComponent(service.value) +
                "&weight=" + encodeURIComponent(weight.value);
      fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok) { blank(); return; }
          out.cost.textContent = "$" + d.cost.toLocaleString(undefined, {
            minimumFractionDigits: 2, maximumFractionDigits: 2
          });
          out.service.textContent = d.service;
          out.distance.textContent = d.distance_km.toLocaleString() + " km";
          out.days.textContent = d.days + (d.days === 1 ? " day" : " days");
        })
        .catch(blank);
    };

    var debounced = function () {
      clearTimeout(timer);
      timer = setTimeout(quote, 250);
    };

    [origin, dest, service].forEach(function (el) {
      if (el) el.addEventListener("change", debounced);
    });
    if (weight) weight.addEventListener("input", debounced);
    quote();
  }
})();

/* Live tracking -------------------------------------------------------------
   Two clocks run here. A local one recomputes the marker's position every few
   seconds from the same formula the server uses, so the shipment creeps along
   between requests. A slower one polls the server for checkpoints and status.
   Without JavaScript the page still shows a correct position at load time. */
(function () {
  "use strict";

  var root = document.getElementById("tracklive");
  if (!root) return;

  var TICK_MS = 5000;     // recompute position locally
  var POLL_MS = 25000;    // ask the server for new checkpoints

  var settled = root.dataset.settled === "1";
  var number = root.dataset.number;
  var distance = Number(root.dataset.distance) || 0;

  var state = {
    floor: Number(root.dataset.floor) || 0,
    ceil: Number(root.dataset.ceil) || 1,
    fraction: Number(root.dataset.fraction) || 0,
    departed: Date.parse(root.dataset.departed) || null,
    eta: Date.parse(root.dataset.eta) || null,
    source: root.dataset.source,
    skew: 0               // server clock minus ours
  };

  var el = {
    covered: document.getElementById("live-covered"),
    when: document.getElementById("live-when"),
    stateLabel: document.getElementById("live-state"),
    pill: document.getElementById("live-pill"),
    timeline: document.getElementById("live-timeline"),
    fill: document.querySelector(".rail-fill"),
    nodes: document.querySelectorAll(".rail-node"),
    steps: document.querySelectorAll(".steplist span"),
    vessel: document.querySelectorAll(".vessel-dot, .vessel-halo"),
    done: document.querySelector(".route-line")
  };

  var origin = null, dest = null, ctrl = null;
  var ghost = document.querySelector(".route-ghost");
  if (ghost) {
    // "M x,y Q cx,cy X,Y" - the same quadratic the server drew.
    var n = ghost.getAttribute("d").match(/-?\d+(\.\d+)?/g);
    if (n && n.length >= 6) {
      origin = { x: +n[0], y: +n[1] };
      ctrl = { x: +n[2], y: +n[3] };
      dest = { x: +n[4], y: +n[5] };
    }
  }

  /* The load-in animation pins stroke-dasharray to the path's length at that
     moment. Once it has played we drop the dashes, otherwise the line renders
     clipped as the path grows. */
  var drawDone = false;
  function releaseDash() {
    if (drawDone) return;
    drawDone = true;
    if (el.done) {
      el.done.style.strokeDasharray = "none";
      el.done.style.strokeDashoffset = "0";
    }
  }
  if (el.done) {
    el.done.addEventListener("animationend", releaseDash);
    setTimeout(releaseDash, 2400);   // reduced motion: no animation fires
  } else {
    drawDone = true;
  }

  function pointAt(t) {
    var u = 1 - t;
    return {
      x: u * u * origin.x + 2 * u * t * ctrl.x + t * t * dest.x,
      y: u * u * origin.y + 2 * u * t * ctrl.y + t * t * dest.y
    };
  }

  /* The server's formula, repeated here so the marker moves between polls. */
  function fractionNow() {
    if (settled) return 1;
    if (!state.departed || !state.eta || state.eta <= state.departed) {
      return state.fraction;
    }
    var now = Date.now() + state.skew;
    var t = (now - state.departed) / (state.eta - state.departed);
    return Math.min(state.ceil, Math.max(state.floor, Math.min(1, Math.max(0, t))));
  }

  function agoText(ms) {
    var s = Math.round(ms / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    return m === 1 ? "1 min ago" : m + " min ago";
  }

  var lastSync = Date.now();

  function render() {
    var t = fractionNow();

    if (el.covered && distance) {
      el.covered.textContent = Math.round(distance * t).toLocaleString();
    }
    if (el.fill) el.fill.style.setProperty("--pct", (t * 100).toFixed(2) + "%");

    // Only redraw the marker when we are estimating; a reported fix stays put.
    if (origin && dest && ctrl && state.source !== "reported") {
      var p = pointAt(t);
      el.vessel.forEach(function (c) {
        c.setAttribute("cx", p.x.toFixed(2));
        c.setAttribute("cy", p.y.toFixed(2));
      });
      if (el.done && drawDone) {
        var a = { x: origin.x + (ctrl.x - origin.x) * t,
                  y: origin.y + (ctrl.y - origin.y) * t };
        el.done.setAttribute("d", "M" + origin.x + "," + origin.y +
          " Q" + a.x.toFixed(2) + "," + a.y.toFixed(2) +
          " " + p.x.toFixed(2) + "," + p.y.toFixed(2));
      }
    }

    if (el.when) el.when.textContent = agoText(Date.now() - lastSync);
  }

  /* Keep the stepped rail and its labels in step with the status. */
  function markStage(idx) {
    if (typeof idx !== "number") return;
    el.nodes.forEach(function (n, i) {
      n.classList.toggle("done", i <= idx);
      n.classList.toggle("current", i === idx);
    });
    el.steps.forEach(function (sp, i) {
      sp.classList.toggle("done", i <= idx);
    });
  }

  function drawEvents(events) {
    if (!el.timeline || !events) return;
    if (el.timeline.children.length === events.length) return;  // nothing new
    el.timeline.innerHTML = events.map(function (e, i) {
      var cls = (i === 0 ? "latest " : "") + (e.is_flag ? "flagged" : "");
      var where = e.location + (e.country ? ", " + e.country : "");
      return '<li class="' + cls.trim() + '">' +
        '<div class="tl-top"><b>' + esc(e.status) + '</b>' +
        '<span class="tl-when">' + esc(e.occurred_fmt) + "</span></div>" +
        '<div class="tl-where">' + esc(where) + "</div>" +
        (e.note ? '<p class="tl-note">' + esc(e.note) + "</p>" : "") +
        "</li>";
    }).join("");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;",
               '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function poll() {
    fetch("/api/track/" + encodeURIComponent(number), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.found) return;
        var live = d.live || {};
        state.floor = live.floor_t;
        state.ceil = live.ceil_t;
        state.fraction = live.fraction;
        state.departed = Date.parse(live.departed_at) || state.departed;
        state.eta = Date.parse(d.eta_iso) || state.eta;
        state.skew = (Date.parse(live.server_time) || Date.now()) - Date.now();

        // A position arriving from a feed takes over from the estimate.
        if (live.position_source !== state.source) {
          state.source = live.position_source;
          if (el.stateLabel) {
            el.stateLabel.textContent = state.source === "reported"
              ? "Reported position" : "Estimated position";
          }
        }
        if (state.source === "reported" && live.current_xy) {
          el.vessel.forEach(function (c) {
            c.setAttribute("cx", live.current_xy[0]);
            c.setAttribute("cy", live.current_xy[1]);
          });
        }

        if (el.pill) {
          el.pill.innerHTML = '<span class="pill ' + esc(d.status_tone) +
            '"><i></i>' + esc(d.status_label) + "</span>";
        }
        markStage(d.stage_index);
        drawEvents(d.events);

        if (d.is_delivered) settled = true;
        lastSync = Date.now();
        render();
      })
      .catch(function () { /* offline: keep showing the last good state */ });
  }

  render();
  if (!settled) {
    setInterval(render, TICK_MS);
    setInterval(poll, POLL_MS);
    poll();
  }
})();
