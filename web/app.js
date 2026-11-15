/* Desk app (plan B): static files, reads JSON from ./d/{DATA_PATH}/ every 15s. Read-only. */
(function () {
  "use strict";
  var POLL_MS = 15000, STALE_S = 240;
  var LAYERS = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundled wallets", "Delegations"];
  var AGENTS = [
    ["scanner", "Scanner", 1], ["auditor", "Auditor", 2], ["analyst", "Analyst", 3], ["executor", "Executor", 4], ["risk", "Risk", 5]];
  var S = { nextPoll: Date.now() + POLL_MS, state: null, chart: null, activity: null, coin: {}, err: null, loaded: false, lastOk: 0 };
  var $view = document.getElementById("view");

  // ---- data path: arrives once as #d=<path>, then lives in localStorage (never sent anywhere else) ----
  (function () {
    // Accept ?d= (kept by iPhone "Add to Home Screen") or #d=. The URL is left as-is so the
    // home-screen copy keeps it (iOS home-screen apps get their own empty localStorage).
    var m = location.search.match(/[?&]d=([A-Za-z0-9_-]{32,})/) || location.hash.match(/[#&]d=([A-Za-z0-9_-]{32,})/);
    if (m) { try { localStorage.setItem("desk.d", m[1]); } catch (e) {} }
  })();
  function dataPath() { try { return localStorage.getItem("desk.d"); } catch (e) { return null; } }
  function url(f) { return "d/" + dataPath() + "/" + f + "?t=" + Date.now(); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function usd(n, d) { if (n == null || isNaN(n)) return "—"; var a = Math.abs(n); var s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e4 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(d == null ? 2 : d); return (n < 0 ? "-$" : "$") + s; }
  function pct(n) { if (n == null || isNaN(n)) return "—"; return (n > 0 ? "+" : "") + n.toFixed(1) + "%"; }
  function ago(ts) { if (!ts) return "never"; var s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? Math.round(s) + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; }
  function hhmm(ts) { var d = new Date(ts * 1000); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function price(p) { if (p == null) return "—"; return p < 0.001 ? "$" + p.toExponential(3) : "$" + p.toPrecision(4); }

  function getJSON(f) {
    return fetch(url(f), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? "no data yet (404)" : "HTTP " + r.status);
      return r.json();
    });
  }

  function load() {
    if (!dataPath()) { S.loaded = true; render(); return; }
    Promise.all([getJSON("state.json"), getJSON("chart.json"), getJSON("activity.json")]).then(function (a) {
      S.state = a[0]; S.chart = a[1]; S.activity = a[2]; S.err = null; S.loaded = true; S.lastOk = Date.now(); render();
    }).catch(function (e) { S.err = e.message || String(e); S.loaded = true; render(); });
    var m = route().coin; if (m) loadCoin(m);
  }
  function loadCoin(m) {
    getJSON("coin/" + m + ".json").then(function (c) { S.coin[m] = c; render(); })
      .catch(function (e) { S.coin[m] = { error: e.message }; render(); });
  }

  function route() {
    var h = location.hash.replace(/^#\/?/, ""); var p = h.split("/");
    if (p[0] === "coin" && p[1]) return { tab: "home", coin: p[1] };
    return { tab: ["home", "agents", "activity", "account"].indexOf(p[0]) >= 0 ? p[0] : "home" };
  }

  // ---- shell: header, banner, tabs ----
  function chrome() {
    var st = S.state, dot = document.getElementById("live-dot"), mode = document.getElementById("mode"), b = document.getElementById("banner");
    var r = route();
    Array.prototype.forEach.call(document.querySelectorAll(".tabs a"), function (a) { a.classList.toggle("on", a.dataset.tab === r.tab && !r.coin); });
    mode.textContent = st ? st.mode : "…"; mode.classList.toggle("live", !!st && st.mode === "LIVE");
    var stale0 = st && (Date.now() / 1000 - st.ts > STALE_S);
    dot.className = "dot " + (!st ? "" : (st.deskAlive && !stale0 ? "ok" : "bad"));
    var msg = "", info = false;
    var stale = st && (Date.now() / 1000 - st.ts > STALE_S);
    if (S.err || stale || (st && !st.deskAlive)) msg = offlineText();
    b.hidden = !msg; b.textContent = msg; b.className = "banner" + (info ? " info" : "");
  }

  function offlineText() {
    var n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
    var t = S.state ? new Date(S.state.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "never";
    return "Desk offline · retrying in " + n + "s · last update " + t;
  }
  function skeleton() {
    return '<div class="skel" style="height:150px;margin-bottom:10px"></div><div class="grid"><div class="skel" style="height:110px"></div><div class="skel" style="height:110px"></div><div class="skel" style="height:110px"></div><div class="skel" style="height:110px"></div></div>';
  }
  function emptyBox(icon, title, sub) { return '<div class="empty"><div class="ic">' + icon + '</div><div><b>' + esc(title) + '</b></div><div class="small">' + sub + '</div></div>'; }

  function render() {
    chrome();
    var r = route();
    if (!dataPath()) {
      if (document.getElementById("dcode")) return; // don't wipe what's being typed
      $view.innerHTML = '<div class="card">' + emptyBox("🔗", "Open your desk link", "Paste the private link (or code) the desk sent you on Telegram, then tap Save. You only do this once.") +
        '<div style="padding:0 16px 16px"><input id="dcode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste link here" style="width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #333;background:#111;color:#fff;font-size:16px">' +
        '<button id="dsave" style="margin-top:10px;width:100%;padding:12px;border-radius:12px;border:0;background:#22c55e;color:#000;font-weight:700;font-size:16px">Save</button><div id="derr" style="color:#f87171;margin-top:8px;font-size:14px"></div></div></div>';
      document.getElementById("dsave").onclick = function () {
        var v = document.getElementById("dcode").value.trim(); var mm = v.match(/(?:[?#&]d=)?([A-Za-z0-9_-]{32,})/);
        if (!mm) { document.getElementById("derr").textContent = "That doesn't look like the desk link. Copy the whole link from Telegram."; return; }
        try { localStorage.setItem("desk.d", mm[1]); } catch (e) {} location.reload();
      };
      return;
    }
    if (!S.loaded || (!S.state && !S.err)) { $view.innerHTML = skeleton(); return; }
    if (!S.state) { $view.innerHTML = '<div class="card">' + emptyBox("⚠️", offlineText(), "If the desk just started, the first publish can take 2–3 minutes.") + "</div>"; return; }
    if (r.coin) return renderCoin(r.coin);
    ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount })[r.tab]();
  }

  // ---- Home ----
  function renderHome() {
    var st = S.state, pts = (S.chart && S.chart.balance) || [];
    var start = (S.chart && S.chart.start) || st.stack, ch = st.stack - start;
    var h = '<div class="card hero"><div class="lbl">' + (st.mode === "PAPER" ? "Paper stack" : "Stack") + '</div>' +
      '<div class="big">' + usd(st.stack) + '</div><div class="' + (st.pnlToday >= 0 ? "up" : "down") + '">' + usd(st.pnlToday) + " today · " + st.closedToday + " closed</div>" +
      (pts.length > 1 ? '<canvas class="chart" id="bal"></canvas>' : '<div class="empty small" style="padding:22px 0">Balance line appears after the first few heartbeats.</div>') + "</div>";
    h += "<h2>Open positions</h2>";
    if (!st.positions.length) h += '<div class="card">' + emptyBox("🛡️", "Nothing open", "Risk guards every position from fill to exit. New buys show up here.") + "</div>";
    else h += '<div class="card">' + st.positions.map(posRow).join("") + "</div>";
    h += "<h2>Desk</h2>" + agentGrid();
    var acts = ((S.activity && S.activity.items) || []).slice(0, 6);
    h += '<h2>Activity <a class="small mut" href="#/activity" style="float:right;font-weight:400">See all ›</a></h2>';
    h += '<div class="card">' + (acts.length ? acts.map(actRow).join("") : emptyBox("🌙", "Nothing yet", "Scans, rejections, buys and sells land here as the desk works.")) + "</div>";
    $view.innerHTML = h;
    if (pts.length > 1) drawChart(document.getElementById("bal"), pts.map(function (p) { return p[1]; }), { color: ch >= 0 ? "#00d35a" : "#ff453a", base: start });
  }
  function posRow(p) {
    return '<a class="row" href="#/coin/' + esc(p.mint) + '"><div><div class="t">' + esc(p.name || p.mint.slice(0, 6)) + '</div><div class="s">' + usd(p.sizeUsd) + " · " + (p.trailActive ? "trailing" : "stop " + price(p.stopPrice)) + (p.status === "exiting" ? " · tap Sold on FOMO" : "") + '</div></div><div class="v ' + (p.pct >= 0 ? "up" : "down") + '">' + pct(p.pct) + "</div></a>";
  }

  function agentCard(key, label, n) {
    var a = S.state.agents[key] || {}, c = a.card || {}, set = (S.state.account.settings || {});
    var sv = function (grp, k) { var x = (set[grp] || []).filter(function (s) { return s.key === grp + "." + k; })[0]; return x ? x.value : null; };
    var val = "", sub = "", extra = "";
    if (key === "scanner") { val = (c.pools || 0) + " pools"; sub = (c.passed || 0) + " → auditor · " + (c.killed || 0) + " cut";
      extra = (c.feed || []).slice(0, 3).map(function (f) { return '<div class="small ' + (f.verdict === "kill" ? "mut" : "up") + '" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        (f.verdict === "kill" ? '<s style="text-decoration-color:#ff453a">' + esc(f.name) + "</s> · " + esc(f.reason) : esc(f.name) + " · liq " + usd(f.liquidityUsd, 0) + " · → auditor") + "</div>"; }).join(""); }
    if (key === "auditor") { var la = c.latest, ls = (la && la.layers) || [];
      val = (c.takenApart || 0) + " taken apart";
      sub = !la ? (c.rejected || 0) + " rejected" : la.running ? "taking apart..." : la.passed ? "8/8 → Analyst · " + (c.rejected || 0) + " rejected" : la.reason + " · " + (c.rejected || 0) + " rejected";
      extra = '<div class="strips">' + LAYERS.map(function (n, i) { var l = ls.filter(function (x) { return x.n === i + 1; })[0]; return "<i" + (l ? ' class="' + (l.pass ? "ok" : "bad") + '"' : "") + "></i>"; }).join("") + "</div>"; }
    if (key === "analyst") { val = "Scoring"; sub = (c.scored || 0) + " scored" + (c.lastName ? " · " + c.lastName : ""); extra = ring(c.lastScore, c.passMark || 70); }
    if (key === "executor") { var lt = c.last; val = (c.trades || 0) + " trades";
      sub = !lt ? S.state.mode : lt.status === "bought" ? usd(lt.sizeUsd) + " · " + lt.stackPct + "% of stack · ✓ Filled" : lt.status === "sent" ? usd(lt.sizeUsd) + " · Executing..." : (lt.name || "") + " · " + lt.status + (lt.reason ? " (" + lt.reason + ")" : ""); }
    if (key === "risk") { val = c.open ? "Guarding" : "Idle"; sub = c.lastExit ? (c.lastExit === "trail" ? "Trailed out" : c.lastExit === "stop" ? "Stopped" : c.lastExit) : "no exits yet";
      extra = '<span class="pill red">stop -' + (c.stopPct != null ? c.stopPct : sv("risk", "stop_pct")) + '%</span><span class="pill green">trail ' + (c.trailPct != null ? c.trailPct : sv("risk", "trail_pct")) + "%</span>"; }
    return '<div class="card agent"><div class="hd"><span class="nm">' + label + '<span class="beat ' + (a.alive ? "ok" : "") + '"></span></span><span class="n">' + n + "/5</span></div>" +
      '<div class="val">' + esc(val) + '</div><div class="sub">' + esc(sub) + "</div>" + extra + "</div>";
  }
  function agentGrid() { return '<div class="grid">' + AGENTS.map(function (a) { return agentCard(a[0], a[1], a[2]); }).join("") + "</div>"; }
  function ring(score, pass) {
    var s = score == null ? 0 : score, r = 22, c = 2 * Math.PI * r, col = score == null ? "#3a3a3c" : s >= pass ? "#00d35a" : "#ff9f0a";
    return '<svg class="ring" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="' + r + '" fill="none" stroke="#2c2c2e" stroke-width="6"/>' +
      '<circle cx="30" cy="30" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (c * s / 100) + " " + c + '" transform="rotate(-90 30 30)"/>' +
      '<text x="30" y="35" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="700">' + (score == null ? "–" : s) + "</text></svg>";
  }

  // ---- Agents ----
  function renderAgents() {
    var st = S.state;
    var h = "<h2>Agents</h2>" + AGENTS.map(function (a) {
      var x = st.agents[a[0]] || {};
      return '<div class="card"><div class="row" style="border:0;padding:0"><div><div class="t">' + a[2] + ". " + a[1] + '</div><div class="s">' + esc(x.status) + '</div></div><div class="v ' + (x.alive ? "up" : "down") + '">' + (x.alive ? "alive" : "down") + '<div class="s">' + ago(x.lastBeat) + "</div></div></div></div>";
    }).join("");
    h += '<div class="card small mut">Plan B: agents can\'t be paused from the app. Send <b>pause</b>, <b>resume</b> or <b>status</b> to your desk bot on Telegram.</div>';
    $view.innerHTML = h;
  }

  // ---- Activity ----
  function renderActivity() {
    var items = (S.activity && S.activity.items) || [];
    var h = "<h2>Activity</h2>";
    if (!items.length) { $view.innerHTML = h + '<div class="card">' + emptyBox("🌙", "Nothing yet", "Scans, rejections, buys and sells land here as the desk works through the night.") + "</div>"; return; }
    h += '<div class="card">' + items.map(actRow).join("") + "</div>";
    $view.innerHTML = h;
  }
  function actRow(it) {
    var cls = it.tone === "kill" ? "row kill" : "row", tone = it.tone === "good" ? "up" : it.tone === "bad" ? "down" : "mut";
    var inner = '<div><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.subtitle) + " · " + hhmm(it.ts) + '</div></div><div class="v ' + tone + '">' + esc(it.value) + "</div>";
    return it.mint ? '<a class="' + cls + '" href="#/coin/' + esc(it.mint) + '">' + inner + "</a>" : '<div class="' + cls + '">' + inner + "</div>";
  }

  // ---- Account (read-only on plan B) ----
  function renderAccount() {
    var a = S.state.account, h = "<h2>Account</h2><div class=\"card\">";
    h += kv("FOMO", a.fomoHandle ? '<a href="' + esc(a.profileUrl) + '" target="_blank" rel="noopener">@' + esc(a.fomoHandle) + "</a>" : "not set", true);
    h += kv("Mode", S.state.mode) + kv("Alerts", a.notifier) + kv("Analyst", a.analystMode) + kv("Hosting", "Plan B · static, refreshes ~1–2 min");
    h += kv("Last update", ago(S.state.ts)) + "</div>";
    h += '<div class="card small mut">' + esc(a.controls) + ' Example: <code>set stop_pct 5</code></div>';
    Object.keys(a.settings || {}).forEach(function (g) {
      h += '<details class="card"><summary>' + esc(g[0].toUpperCase() + g.slice(1)) + " settings</summary>" + a.settings[g].map(function (s) {
        return kv(s.label, esc(s.value) + (s.min != null ? ' <span class="mut small">(' + s.min + "–" + s.max + ")</span>" : ""), true);
      }).join("") + "</details>";
    });
    $view.innerHTML = h;
  }
  function kv(k, v, raw) { return '<div class="kv"><span>' + esc(k) + "</span><span>" + (raw ? v : esc(v)) + "</span></div>"; }

  // ---- Coin screen ----
  function renderCoin(m) {
    var c = S.coin[m], h = '<a class="back" href="#/home">‹ Back</a>';
    if (!c) { $view.innerHTML = h + skeleton(); return; }
    if (c.error) { $view.innerHTML = h + '<div class="card">' + emptyBox("🔍", "No data for this coin", "It may be older than 24h (" + esc(c.error) + ").") + "</div>"; return; }
    var pr = c.prices || [], last = pr.length ? pr[pr.length - 1][1] : null, pos = c.position;
    h += '<div class="card hero"><div class="lbl">' + esc(c.symbol || "") + " · " + (c.holders != null ? c.holders + " holders" : "holders n/a") + '</div><div class="big">' + esc(c.name || m.slice(0, 8)) + "</div><div>" + price(last) + "</div>" +
      (pr.length > 1 ? '<canvas class="chart" id="cc"></canvas>' : '<div class="empty small">Price line starts with the Scanner\'s first read.</div>') + "</div>";
    if (c.audit && c.audit.layers) {
      h += '<h2>Audit</h2><div class="card layers">' + LAYERS.map(function (n, i) {
        var l = c.audit.layers.filter(function (x) { return x.n === i + 1; })[0];
        return kv(n, l ? '<span class="' + (l.pass ? "up" : "down") + '">' + (l.pass ? "✓ " : "✕ ") + esc(l.value) + "</span>" : '<span class="mut">not checked</span>', true);
      }).join("") + "</div>";
    }
    if (c.verdict) h += '<h2>Analyst</h2><div class="card">' + ring(c.verdict.score, (S.state.agents.analyst.card || {}).passMark || 70) + (c.verdict.failed && c.verdict.failed.length ? '<div class="small mut">' + esc(c.verdict.failed.join(" · ")) + "</div>" : "") + "</div>";
    h += '<a class="btn" href="' + esc(c.link) + '" target="_blank" rel="noopener">Open on FOMO</a>';
    $view.innerHTML = h;
    if (pr.length > 1) {
      var line = null;
      if (pos && pos.status !== "closed") line = pos.trail_active ? pos.peak_price * (1 - trailPct() / 100) : pos.stop_price;
      drawChart(document.getElementById("cc"), pr.map(function (p) { return p[1]; }), { color: "#64d2ff", line: line, lineLabel: "Risk trailing stop" });
    }
  }
  function trailPct() { var r = (S.state.account.settings.risk || []).filter(function (s) { return s.key === "risk.trail_pct"; })[0]; return r ? r.value : 12; }

  // ---- chart drawn by hand with the raw Canvas 2D API (no library), clean lines ----
  function drawChart(cv, vals, o) {
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext("2d"); g.scale(dpr, dpr);
    var all = vals.slice(); if (o.base != null) all.push(o.base); if (o.line != null) all.push(o.line);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all); if (hi === lo) { hi += 1; lo -= 1; }
    var pad = 10, X = function (i) { return pad + (w - 2 * pad) * i / (vals.length - 1); }, Y = function (v) { return h - pad - (h - 2 * pad) * (v - lo) / (hi - lo); };
    if (o.base != null) { g.setLineDash([3, 5]); g.strokeStyle = "#3a3a3c"; g.lineWidth = 1; g.beginPath(); g.moveTo(pad, Y(o.base)); g.lineTo(w - pad, Y(o.base)); g.stroke(); g.setLineDash([]); }
    var grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, o.color + "40"); grd.addColorStop(1, o.color + "00");
    g.fillStyle = grd; g.beginPath(); g.moveTo(X(0), h); vals.forEach(function (v, i) { g.lineTo(X(i), Y(v)); }); g.lineTo(X(vals.length - 1), h); g.closePath(); g.fill();
    g.strokeStyle = o.color; g.lineWidth = 2; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath();
    vals.forEach(function (v, i) { i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); }); g.stroke();
    if (o.line != null) {
      g.setLineDash([7, 6]); g.strokeStyle = "#ff9f0a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pad, Y(o.line)); g.lineTo(w - pad, Y(o.line)); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#ff9f0a"; g.font = "11px -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif"; g.fillText(o.lineLabel || "", pad + 2, Y(o.line) - 5);
    }
  }

  window.addEventListener("hashchange", function () { var m = route().coin; if (m && !S.coin[m]) loadCoin(m); render(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  window.addEventListener("resize", render);
  render(); load();
  setInterval(function () { if (!document.hidden) { S.nextPoll = Date.now() + POLL_MS; load(); } }, POLL_MS);
  setInterval(function () { if (S.err || (S.state && Date.now() / 1000 - S.state.ts > STALE_S)) chrome(); }, 1000);
})();
