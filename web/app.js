/* Desk app (plan B): static files, reads JSON from ./d/{DATA_PATH}/ every 15s. Read-only. */
(function () {
  "use strict";
  var POLL_MS = 15000, STALE_S = 240;
  var LAYERS = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundled wallets", "Delegations"];
  var AGENTS = [["scanner", "Scanner", 1], ["auditor", "Auditor", 2], ["analyst", "Analyst", 3], ["executor", "Executor", 4], ["risk", "Risk", 5]];
  var ICONS = {
    scanner: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>',
    auditor: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    analyst: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    executor: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    risk: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'
  };
  var RANGES = [["1H", 3600], ["6H", 21600], ["24H", 86400], ["48H", 172800]];
  var S = { nextPoll: Date.now() + POLL_MS, state: null, chart: null, activity: null, coin: {}, err: null, loaded: false, lastOk: 0,
    range: lsGet("desk.range") || "6H", filter: "all", lastRoute: null, shownStack: null };
  var $view = document.getElementById("view");

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---- data path: arrives once as ?d=<path> or #d=<path>, then lives in localStorage (never sent anywhere else) ----
  (function () {
    // The URL is left as-is so the iPhone home-screen copy keeps it (home-screen apps get their own empty localStorage).
    var m = location.search.match(/[?&]d=([A-Za-z0-9_-]{32,})/) || location.hash.match(/[#&]d=([A-Za-z0-9_-]{32,})/);
    if (m) lsSet("desk.d", m[1]);
  })();
  function dataPath() { return lsGet("desk.d"); }
  function url(f) { return "d/" + dataPath() + "/" + f + "?t=" + Date.now(); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function usd(n, d) { if (n == null || isNaN(n)) return "—"; var a = Math.abs(n); var s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e4 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(d == null ? 2 : d); return (n < 0 ? "-$" : "$") + s; }
  function sgnUsd(n) { return (n > 0 ? "+" : "") + usd(n); }
  function pct(n) { if (n == null || isNaN(n)) return "—"; return (n > 0 ? "+" : "") + n.toFixed(1) + "%"; }
  function ago(ts) { if (!ts) return "never"; var s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? Math.round(s) + "s ago" : s < 3600 ? Math.round(s / 60) + "m ago" : s < 86400 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; }
  function hhmm(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function price(p) { if (p == null) return "—"; return p < 0.001 ? "$" + p.toExponential(3) : "$" + p.toPrecision(4); }
  function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }

  function getJSON(f) {
    return fetch(url(f), { cache: "no-store", headers: { "Cache-Control": "no-cache" } }).then(function (r) {
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
    var stale = st && (Date.now() / 1000 - st.ts > STALE_S);
    dot.className = "dot " + (!st ? "" : (st.deskAlive && !stale ? "ok" : "bad"));
    var msg = (S.err || stale || (st && !st.deskAlive)) ? offlineText() : "";
    b.hidden = !msg; b.textContent = msg;
  }
  function offlineText() {
    var n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
    var t = S.state ? hhmm(S.state.ts) : "never";
    return "Desk offline · retrying in " + n + "s · last update " + t;
  }
  function skeleton() {
    return '<div class="skel" style="height:300px;margin-bottom:10px"></div><div class="skel" style="height:90px;margin-bottom:10px"></div><div class="grid"><div class="skel" style="height:150px"></div><div class="skel" style="height:150px"></div></div>';
  }
  function emptyBox(icon, title, sub) { return '<div class="empty"><div class="ic">' + icon + '</div><div><b>' + esc(title) + '</b></div><div class="small" style="margin-top:4px">' + sub + "</div></div>"; }

  function render() {
    chrome();
    var r = route(), key = r.coin ? "coin/" + r.coin : r.tab;
    var enter = key !== S.lastRoute; S.lastRoute = key;
    if (!dataPath()) {
      if (document.getElementById("dcode")) return; // don't wipe what's being typed
      $view.innerHTML = '<div class="card">' + emptyBox("🔗", "Open your desk link", "Paste the private link (or code) the desk sent you on Telegram, then tap Save. You only do this once.") +
        '<input id="dcode" class="field" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste link here">' +
        '<button id="dsave" class="btn">Save</button><div id="derr" class="small" style="color:#ff8a80;margin-top:8px"></div></div>';
      document.getElementById("dsave").onclick = function () {
        haptic();
        var v = document.getElementById("dcode").value.trim(); var mm = v.match(/(?:[?#&]d=)?([A-Za-z0-9_-]{32,})/);
        if (!mm) { document.getElementById("derr").textContent = "That doesn't look like the desk link. Copy the whole link from Telegram."; return; }
        lsSet("desk.d", mm[1]); location.reload();
      };
      return;
    }
    if (!S.loaded || (!S.state && !S.err)) { $view.innerHTML = skeleton(); return; }
    if (!S.state) { $view.innerHTML = '<div class="card">' + emptyBox("⚠️", offlineText(), "If the desk just started, the first publish can take 2–3 minutes.") + "</div>"; return; }
    var y = window.scrollY;
    if (r.coin) renderCoin(r.coin);
    else ({ home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount })[r.tab]();
    if (enter) { $view.classList.remove("enter"); void $view.offsetWidth; $view.classList.add("enter"); window.scrollTo(0, 0); }
    else window.scrollTo(0, y);
  }

  // ---- Home ----
  function rangePts() {
    var pts = (S.chart && S.chart.balance) || [], sec = 21600;
    RANGES.forEach(function (r) { if (r[0] === S.range) sec = r[1]; });
    var t0 = Date.now() / 1000 - sec, out = pts.filter(function (p) { return p[0] >= t0; });
    if (out.length < 2 && pts.length >= 2) out = pts.slice(-Math.min(pts.length, 60));
    if (S.state && out.length) out = out.concat([[S.state.ts, S.state.stack]]);
    return out;
  }
  function renderHome() {
    var st = S.state, pts = rangePts(), first = pts.length ? pts[0][1] : st.stack, rch = st.stack - first;
    var start = (S.chart && S.chart.start) || st.stack, tot = st.stack - start;
    var dcls = st.pnlToday > 0 ? "up" : st.pnlToday < 0 ? "down" : "flat";
    var whole = Math.floor(Math.abs(st.stack)), cents = (Math.abs(st.stack) - whole).toFixed(2).slice(1);
    var h = '<div class="card hero"><div class="lbl">' + (st.mode === "PAPER" ? "Paper stack" : "Stack") + sessionTag() + "</div>" +
      '<div class="big num" id="stack">$' + whole.toLocaleString() + '<span class="c">' + cents + "</span></div>" +
      '<span class="delta ' + dcls + ' num">' + (st.pnlToday > 0 ? "▲ " : st.pnlToday < 0 ? "▼ " : "") + sgnUsd(st.pnlToday) + " today</span>" +
      '<span class="meta num">' + st.closedToday + " closed · " + (tot >= 0 ? "+" : "") + usd(tot) + " all-time</span>" +
      '<div class="chartwrap">' + (pts.length > 1 ? '<canvas class="chart" id="bal"></canvas><div class="tip num" id="tip"></div>' : '<div class="empty small">Balance line appears after the first few heartbeats.</div>') + "</div>" +
      '<div class="seg" id="seg">' + RANGES.map(function (r) { return '<button data-r="' + r[0] + '" class="' + (r[0] === S.range ? "on" : "") + '">' + r[0] + "</button>"; }).join("") + "</div></div>";
    h += nowStrip();
    h += '<div class="chips">' + ruleChips() + "</div>";
    h += "<h2>Open positions <span class=\"small mut\" style=\"font-weight:600\">" + st.positions.length + "</span></h2>";
    h += st.positions.length ? st.positions.map(posCard).join("") : '<div class="card">' + emptyBox("🛡️", "No open positions", "When a coin passes all checks the Executor buys it and Risk guards it here with stop, target and trail.") + "</div>";
    h += '<h2>Agents <a href="#/agents">Details ›</a></h2>' + agentGrid();
    h += tradesSection();
    var acts = feedItems().slice(0, 8);
    h += '<h2>Activity <a href="#/activity">See all ›</a></h2>';
    h += '<div class="card list">' + (acts.length ? acts.map(actRow).join("") : emptyBox("🌙", "Nothing yet", "Scans, rejections, buys and sells land here as the desk works.")) + "</div>";
    $view.innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll("#seg button"), function (b) {
      b.onclick = function () { haptic(); S.range = b.dataset.r; lsSet("desk.range", S.range); render(); };
    });
    if (pts.length > 1) {
      var col = rch >= 0 ? "#30d158" : "#ff453a";
      drawChart(document.getElementById("bal"), pts, { color: col, base: first, tip: document.getElementById("tip") });
    }
    countUp(document.getElementById("stack"), st.stack);
  }
  function sessionTag() {
    var n = S.state.now; if (!n) return "";
    if (n.session === "night") return '<span class="tag c">Night · to ' + hhmm(n.lockAt) + "</span>";
    return n.buying ? '<span class="tag g">Day trading · paper</span>' : '<span class="tag o">Day · buys from ' + hhmm(n.nightStart) + "</span>";
  }
  function countUp(el, to) {
    if (!el) return;
    var from = S.shownStack == null ? to : S.shownStack; S.shownStack = to;
    if (from === to || !window.requestAnimationFrame) return;
    var t0 = performance.now(), dur = 700;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
      var w = Math.floor(Math.abs(v)), c = (Math.abs(v) - w).toFixed(2).slice(1);
      el.innerHTML = (v < 0 ? "-$" : "$") + w.toLocaleString() + '<span class="c">' + c + "</span>";
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function nowStrip() {
    var n = S.state.now, st = S.state;
    if (!n) return "";
    var mins = Math.round(n.window / 60), sc = st.agents.scanner || {}, live = sc.alive;
    var t = "<b>Scanner</b> checked <b>" + n.scanned + "</b> new coin" + (n.scanned === 1 ? "" : "s") + " in the last " + mins + " min";
    if (n.scanned) t += " · " + n.killed + " killed, " + n.passed + " passed";
    var ls = n.lastScan, sub = "";
    if (ls) sub = "Last: " + esc(ls.name) + " " + (ls.verdict === "kill" ? "killed" : "passed") + (ls.reason && ls.verdict === "kill" ? " · " + esc(ls.reason) : ls.liquidityUsd != null ? " · liq " + usd(ls.liquidityUsd, 0) : "") + " · " + ago(ls.ts);
    else sub = "Waiting for the first new pool…";
    var waiting = (sc.card && sc.card.waiting) || 0;
    if (waiting) sub += " · " + waiting + " in waiting room";
    var cn = sc.counters || {};
    if (cn.recent_rounds) sub += " · re-scan: " + (cn.recent_grads || 0) + " grads in " + ((S.state.rules || {}).recentHours || 6) + "h, " + ((cn.recent_new || 0) + (cn.recent_rechecks || 0)) + " re-checked";
    var hot = function (v) { return v > 0 ? ' class="hot"' : ""; };
    return '<div class="card now"><span class="pulse' + (live ? "" : " idle") + '"></span><div style="flex:1;min-width:0"><div class="txt">' + t + '</div><div class="sub">' + sub + "</div>" +
      '<div class="funnel num"><div' + hot(n.scanned) + "><b>" + n.scanned + "</b><span>Scanned</span></div><div" + hot(n.audited) + "><b>" + n.audited + "</b><span>Audited</span></div><div" + hot(n.scored) + "><b>" + n.scored + "</b><span>Scored</span></div><div" + hot(n.bought) + "><b>" + n.bought + "</b><span>Bought</span></div></div></div></div>";
  }
  function ruleChips() {
    var r = S.state.rules || {};
    var c = [["red", "Stop -" + (r.stopPct != null ? r.stopPct : 25) + "%"], ["green", (r.tpX || 2) + "x → sell " + (r.tpSellPct === 50 || r.tpSellPct == null ? "half" : r.tpSellPct + "%")],
      ["amber", "Trail " + (r.trailPct != null ? r.trailPct : 40) + "%"], ["violet", "Score ≥ " + (r.minScore || 70)], ["cyan", "Liq ≥ " + usd(r.minLiq || 20000, 0)], ["red", "Loss stop " + usd(r.nightLossStop || 100, 0)]];
    return c.map(function (x) { return '<span class="chip ' + x[0] + '"><i></i>' + esc(x[1]) + "</span>"; }).join("");
  }
  function posCard(p) {
    var cur = p.price, en = p.entryPrice, stop = p.trailActive && p.trailPrice ? p.trailPrice : p.stopPrice, tgt = p.targetPrice;
    var lo = stop || (en ? en * 0.75 : 0), hi = tgt || (en ? en * 2 : 1);
    if (p.tpDone && p.peakPrice) hi = Math.max(hi, p.peakPrice);
    var pos = function (v) { return Math.max(0, Math.min(100, (v - lo) / ((hi - lo) || 1) * 100)); };
    var pnl = (p.pct != null && p.sizeUsd != null) ? p.sizeUsd * p.pct / 100 : null;
    var tags = (p.trailActive ? '<span class="tag o">Trailing</span>' : "") + (p.tpDone ? '<span class="tag g">Half sold</span>' : "") + (p.status === "exiting" ? '<span class="tag r">Exiting</span>' : "");
    return '<a class="card pos tap" style="display:block;color:inherit" href="#/coin/' + esc(p.mint) + '"><div class="top1"><div style="min-width:0"><div class="nm">' + esc(p.name || p.mint.slice(0, 6)) + tags + '</div>' +
      '<div class="s num">' + usd(p.sizeUsd) + " · entry " + price(en) + " · " + ago(p.openedAt) + '</div></div><div><div class="pct num ' + (p.pct >= 0 ? "up" : "down") + '">' + pct(p.pct) + '</div><div class="usd num ' + (pnl >= 0 ? "up" : "down") + '">' + (pnl == null ? "" : sgnUsd(pnl)) + "</div></div></div>" +
      '<div class="bar">' + (en ? '<span class="en" style="left:' + pos(en) + '%"></span>' : "") + (cur != null ? '<span class="mk" style="left:' + pos(cur) + '%"></span>' : "") + "</div>" +
      '<div class="barl num"><span class="down">' + (p.trailActive ? "Trail " : "Stop ") + price(stop) + '</span><span>Now ' + price(cur) + '</span><span class="up">' + (p.tpDone ? "Peak " + price(p.peakPrice) : "2x " + price(tgt)) + "</span></div></a>";
  }

  function dayTime(ts) {
    if (!ts) return "—";
    var d = new Date(ts * 1000), t = new Date(), y = new Date(Date.now() - 86400000);
    var day = d.toDateString() === t.toDateString() ? "" : d.toDateString() === y.toDateString() ? "Yesterday " : d.toLocaleDateString([], { day: "numeric", month: "short" }) + " ";
    return day + hhmm(ts);
  }
  function tradesSection() {
    var T = S.state.trades; if (!T) return "";
    var it = T.items || [], sm = T.summary || {};
    var h = '<h2>Trades <span class="small mut" style="font-weight:600">' + it.length + "</span></h2>";
    if (!it.length) return h + '<div class="card">' + emptyBox("💹", "No trades yet", "Every buy and sell the desk makes shows up here, open ones first.") + "</div>";
    var tot = sm.totalPnl || 0;
    h += '<div class="card tsum num"><div><b class="' + (tot > 0 ? "up" : tot < 0 ? "down" : "") + '">' + sgnUsd(tot) + '</b><span>' + (sm.mode === "LIVE" ? "Live" : "Paper") + ' P&amp;L</span></div>' +
      "<div><b>" + (sm.wins || 0) + "W · " + (sm.losses || 0) + "L</b><span>" + (sm.closed || 0) + " closed</span></div>" +
      "<div><b>" + (sm.winRate == null ? "—" : sm.winRate.toFixed(0) + "%") + "</b><span>Win rate</span></div>" +
      "<div><b>" + (sm.open || 0) + "</b><span>Open</span></div></div>";
    return h + '<div class="card list">' + it.map(tradeRow).join("") + "</div>";
  }
  function tradeRow(t) {
    var up = (t.pnlUsd || 0) > 0, cls = t.pnlUsd == null ? "mut" : up ? "up" : "down";
    var badge = '<span class="tag ' + (t.mode === "LIVE" ? "r" : "o") + '">' + esc(t.mode) + "</span>" + (t.status === "open" ? '<span class="tag g">Open</span>' : "") + (t.tpDone ? '<span class="tag c">Half sold</span>' : "");
    var line1 = "Bought " + dayTime(t.openedAt) + " · " + usd(t.sizeUsd);
    var line2 = t.status === "open" ? (t.exiting ? "Selling…" : "Risk guarding · live P&L") : "Sold " + dayTime(t.closedAt) + " · " + esc(t.exitText || t.exitReason || "sold");
    return '<a class="row trade" href="#/coin/' + esc(t.mint) + '"><span class="av ' + (t.status === "open" ? "n" : up ? "g" : "k") + '">' + (t.status === "open" ? "●" : up ? "↑" : "↓") + '</span>' +
      '<div class="mid"><div class="t">' + esc(t.name) + badge + '</div><div class="s num">' + line1 + '</div><div class="s num">' + line2 + "</div></div>" +
      '<div class="v num ' + cls + '">' + (t.pnlUsd == null ? "—" : sgnUsd(t.pnlUsd)) + '<div class="s ' + cls + '" style="font-weight:700">' + pct(t.pct) + "</div></div></a>";
  }
  function tradeFor(m) { var it = (S.state && S.state.trades && S.state.trades.items) || []; return it.filter(function (t) { return t.mint === m; })[0]; }

  function agentLine(key) {
    var a = S.state.agents[key] || {}, c = a.card || {}, r = S.state.rules || {}, val = "", sub = "", extra = "";
    if (key === "scanner") { val = (c.pools || 0) + " pools"; sub = (c.passed || 0) + " → Auditor · " + (c.killed || 0) + " cut today";
      extra = '<div class="feedl">' + (c.feed || []).slice(0, 2).map(function (f) { return "<div>" + (f.verdict === "kill" ? "<s>" + esc(f.name) + "</s> · " + esc(f.reason) : '<span class="up">' + esc(f.name) + "</span> · liq " + usd(f.liquidityUsd, 0)) + "</div>"; }).join("") + "</div>"; }
    if (key === "auditor") { var la = c.latest, ls = (la && la.layers) || [];
      val = (c.takenApart || 0) + " audited";
      sub = !la ? "Waiting for a coin that passes Scanner" : la.running ? "Taking apart " + esc(la.name || "") + "…" : la.passed ? (la.name || "") + " 8/8 → Analyst" : (la.name || "") + " · " + la.reason;
      extra = '<div class="strips">' + LAYERS.map(function (n, i) { var l = ls.filter(function (x) { return x.n === i + 1; })[0]; return "<i" + (l ? ' class="' + (l.pass ? "ok" : "bad") + '"' : "") + "></i>"; }).join("") + "</div>"; }
    if (key === "analyst") { val = c.lastScore != null ? c.lastScore + "/100" : (c.scored || 0) + " scored"; sub = c.lastName ? (c.lastName + (c.lastPassed ? " · passed" : " · below " + (c.passMark || 70))) : "Scores coins that pass the audit · mark " + (c.passMark || 70); }
    if (key === "executor") { var lt = c.last; val = (c.trades || 0) + " trade" + (c.trades === 1 ? "" : "s");
      sub = !lt ? (S.state.now && S.state.now.buying ? "Ready · " + S.state.mode + " buys on" : "Night-only buys") : lt.status === "bought" ? (lt.name || "") + " · " + usd(lt.sizeUsd) + " filled" : lt.status === "sent" ? usd(lt.sizeUsd) + " · executing…" : (lt.name || "") + " · " + lt.status + (lt.reason ? " (" + lt.reason + ")" : ""); }
    if (key === "risk") { val = c.open ? "Guarding " + c.open : "Idle"; sub = c.lastExit ? "Last exit: " + (c.lastExitName || "") + " · " + c.lastExit + (c.lastExitPnl != null ? " " + sgnUsd(c.lastExitPnl) : "") : "Stop -" + (c.stopPct || r.stopPct) + "% · trail " + (c.trailPct || r.trailPct) + "%"; }
    return { a: a, val: val, sub: sub, extra: extra };
  }
  function agentCard(key, label, n, wide) {
    var x = agentLine(key);
    return '<a class="card agent tap' + (wide ? " wide" : "") + '" style="color:inherit" href="#/agents"><div class="hd"><span class="ic ' + key + '"><svg viewBox="0 0 24 24">' + ICONS[key] + '</svg></span><div><div class="nm">' + label + '</div><div class="n">' + n + "/5 · " + esc(x.a.status || "") + '</div></div><span class="beat ' + (x.a.alive ? "ok" : "") + '"></span></div>' +
      '<div class="val num">' + esc(x.val) + '</div><div class="sub">' + esc(x.sub) + "</div>" + x.extra + '<div class="sp">' + spark(x.a.spark, key) + "</div></a>";
  }
  function agentGrid() { return '<div class="grid">' + AGENTS.map(function (a, i) { return agentCard(a[0], a[1], a[2], i === 4); }).join("") + "</div>"; }
  var SPCOL = { scanner: "#64d2ff", auditor: "#a78bfa", analyst: "#ff9f0a", executor: "#30d158", risk: "#ff453a" };
  function spark(v, key) {
    v = v || []; if (v.length < 2) return "";
    var mx = Math.max.apply(null, v.concat([1])), w = 100, h = 30, col = SPCOL[key], id = "g" + key;
    var pts = v.map(function (y, i) { return [i * w / (v.length - 1), h - 3 - (h - 6) * y / mx]; });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + " L100 30 L0 30Z" + '" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
  }
  function ring(score, pass) {
    var s = score == null ? 0 : score, r = 22, c = 2 * Math.PI * r, col = score == null ? "#3a3a3c" : s >= pass ? "#30d158" : "#ff9f0a";
    return '<svg class="ring" width="64" height="64" viewBox="0 0 60 60"><circle cx="30" cy="30" r="' + r + '" fill="none" stroke="#26262a" stroke-width="6"/>' +
      '<circle cx="30" cy="30" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (c * s / 100) + " " + c + '" transform="rotate(-90 30 30)"/>' +
      '<text x="30" y="35" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="700">' + (score == null ? "–" : s) + "</text></svg>";
  }

  // ---- Agents ----
  function renderAgents() {
    var st = S.state;
    var h = "<h2>Agents</h2>" + AGENTS.map(function (a) {
      var x = agentLine(a[0]), cn = x.a.counters || {};
      var ks = Object.keys(cn).filter(function (k) { return typeof cn[k] === "number"; }).slice(0, 6);
      return '<div class="card agent" style="min-height:0;margin-bottom:10px"><div class="hd"><span class="ic ' + a[0] + '"><svg viewBox="0 0 24 24">' + ICONS[a[0]] + '</svg></span><div><div class="nm">' + a[2] + ". " + a[1] + '</div><div class="n">' + esc(x.a.status) + " · beat " + ago(x.a.lastBeat) + '</div></div><span class="beat ' + (x.a.alive ? "ok" : "") + '"></span></div>' +
        '<div class="val num">' + esc(x.val) + '</div><div class="sub">' + esc(x.sub) + "</div>" + x.extra +
        (a[0] === "analyst" ? '<div style="margin-top:8px">' + ring((x.a.card || {}).lastScore, (x.a.card || {}).passMark || 70) + "</div>" : "") +
        '<div class="sp">' + spark(x.a.spark, a[0]) + '<div class="small mut" style="margin-top:2px">last hour</div></div>' +
        (ks.length ? '<div class="funnel num" style="grid-template-columns:repeat(3,1fr)">' + ks.map(function (k) { return "<div><b>" + cn[k] + "</b><span>" + esc(k.replace(/_/g, " ")) + "</span></div>"; }).join("") + "</div>" : "") + "</div>";
    }).join("");
    h += '<div class="card small mut">Agents can\'t be paused from the app. Send <b>pause</b>, <b>resume</b> or <b>status</b> to your desk bot on Telegram.</div>';
    $view.innerHTML = h;
  }

  // ---- Activity ----
  function feedItems() { return (S.activity && S.activity.items) || []; }
  function renderActivity() {
    var items = feedItems(), f = S.filter;
    var fl = items.filter(function (it) { return f === "all" ? true : f === "scanner" ? it.kind === "scan" : it.kind !== "scan"; });
    var h = '<h2>Activity</h2><div class="filters" id="flt">' + [["all", "All"], ["trades", "Desk"], ["scanner", "Scanner"]].map(function (x) { return '<button data-f="' + x[0] + '" class="' + (x[0] === f ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="card list">' + (fl.length ? fl.map(actRow).join("") : emptyBox("🌙", "Nothing yet", "Scans, rejections, buys and sells land here as the desk works.")) + "</div>";
    $view.innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll("#flt button"), function (b) { b.onclick = function () { haptic(); S.filter = b.dataset.f; render(); }; });
  }
  function actRow(it) {
    var kill = it.tone === "kill", tone = it.tone === "good" ? "up" : it.tone === "bad" || kill ? "down" : "mut";
    var av = kill ? ["k", "✕"] : it.tone === "good" ? ["g", it.kind === "scan" ? "✓" : "↑"] : it.tone === "bad" ? ["b", "!"] : ["n", "•"];
    var inner = '<span class="av ' + av[0] + '">' + av[1] + '</span><div class="mid"><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.subtitle) + '</div></div><div class="v ' + tone + '">' + esc(it.value) + '<div class="s">' + hhmm(it.ts) + "</div></div>";
    var cls = "row" + (kill ? " kill" : "");
    return it.mint ? '<a class="' + cls + '" href="#/coin/' + esc(it.mint) + '">' + inner + "</a>" : '<div class="' + cls + '">' + inner + "</div>";
  }

  // ---- Account (read-only on plan B) ----
  function renderAccount() {
    var a = S.state.account, h = '<h2>Account</h2><div class="card list">';
    h += kv("FOMO", a.fomoHandle ? '<a href="' + esc(a.profileUrl) + '" target="_blank" rel="noopener">@' + esc(a.fomoHandle) + "</a>" : "not set", true);
    h += kv("Mode", S.state.mode) + kv("Alerts", a.notifier) + kv("Analyst", a.analystMode) + kv("Hosting", "Static · refreshes ~1–2 min");
    h += kv("Last update", ago(S.state.ts)) + "</div>";
    h += '<div class="card small mut">' + esc(a.controls) + " Example: <code>set stop_pct 5</code></div>";
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
    var c = S.coin[m], h = '<a class="back" href="javascript:history.back()">‹ Back</a>';
    if (!c) { $view.innerHTML = h + skeleton(); return; }
    var tr = tradeFor(m);
    if (c.error) {
      $view.innerHTML = h + (tr ? '<div class="card list">' + tradeRow(tr) + "</div>" : "") + '<div class="card">' + emptyBox("🔍", "No chart data for this coin", "It may be older than 24h (" + esc(c.error) + ").") + "</div>" +
        (tr && tr.link ? '<a class="btn" href="' + esc(tr.link) + '" target="_blank" rel="noopener">Open on FOMO</a>' : "");
      return;
    }
    var pr = c.prices || [], last = pr.length ? pr[pr.length - 1][1] : null, pos = c.position, ch = pr.length > 1 ? (last / pr[0][1] - 1) * 100 : null;
    h += '<div class="card hero"><div class="lbl">' + esc(c.symbol || "") + " · " + (c.holders != null ? c.holders + " holders" : "holders n/a") + '</div><div class="big" style="font-size:34px">' + esc(c.name || m.slice(0, 8)) + '</div><span class="delta ' + (ch == null ? "flat" : ch >= 0 ? "up" : "down") + ' num">' + price(last) + (ch == null ? "" : " · " + pct(ch)) + "</span>" +
      '<div class="chartwrap">' + (pr.length > 1 ? '<canvas class="chart" id="cc"></canvas><div class="tip num" id="tip"></div>' : '<div class="empty small">Price line starts with the Scanner\'s first read.</div>') + "</div></div>";
    if (tr) h += '<h2>Your trade</h2><div class="card list">' + tradeRow(tr).replace('<a class="row trade" href="#/coin/' + esc(tr.mint) + '">', '<div class="row trade">').replace(/<\/a>$/, "</div>") +
      kv("Entry", price(tr.entryPrice)) + (tr.exitPrice ? kv("Exit", price(tr.exitPrice)) : "") + "</div>";
    if (c.scan) h += '<h2>Scanner</h2><div class="card list">' + kv("Verdict", c.scan.verdict || "—") + kv("Reason", c.scan.reason || "—") + (c.scan.liquidityUsd != null ? kv("Liquidity", usd(c.scan.liquidityUsd, 0)) : "") + "</div>";
    if (c.audit && c.audit.layers) {
      h += '<h2>Audit</h2><div class="card list">' + LAYERS.map(function (n, i) {
        var l = c.audit.layers.filter(function (x) { return x.n === i + 1; })[0];
        return kv(n, l ? '<span class="' + (l.pass ? "up" : "down") + '">' + (l.pass ? "✓ " : "✕ ") + esc(l.value) + "</span>" : '<span class="mut">not checked</span>', true);
      }).join("") + "</div>";
    }
    if (c.verdict) h += '<h2>Analyst</h2><div class="card" style="display:flex;gap:14px;align-items:center">' + ring(c.verdict.score, (S.state.agents.analyst.card || {}).passMark || 70) + (c.verdict.failed && c.verdict.failed.length ? '<div class="small mut">' + esc(c.verdict.failed.join(" · ")) + "</div>" : '<div class="small mut">All checks passed</div>') + "</div>";
    h += '<a class="btn" href="' + esc(c.link) + '" target="_blank" rel="noopener">Open on FOMO</a>';
    $view.innerHTML = h;
    if (pr.length > 1) {
      var line = null;
      if (pos && pos.status !== "closed") line = pos.trail_active ? pos.peak_price * (1 - trailPct() / 100) : pos.stop_price;
      drawChart(document.getElementById("cc"), pr.map(function (p) { return [p[0], p[1]]; }), { color: "#64d2ff", line: line, lineLabel: pos && pos.trail_active ? "Trailing stop" : "Stop", fmt: price, tip: document.getElementById("tip") });
    }
  }
  function trailPct() { return (S.state.rules && S.state.rules.trailPct) || 40; }

  // ---- chart: raw Canvas 2D, smooth (monotone) curve with gradient fill + touch scrub ----
  function drawChart(cv, pts, o) {
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext("2d"); g.scale(dpr, dpr);
    var vals = pts.map(function (p) { return p[1]; }), all = vals.slice(); if (o.base != null) all.push(o.base); if (o.line != null) all.push(o.line);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all); if (hi === lo) { hi += Math.max(1, Math.abs(hi) * 0.01); lo -= Math.max(1, Math.abs(lo) * 0.01); }
    var padT = 22, padB = 10, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    var X = function (i) { return (t1 === t0) ? w * i / (pts.length - 1) : w * (pts[i][0] - t0) / (t1 - t0); };
    var Y = function (v) { return h - padB - (h - padT - padB) * (v - lo) / (hi - lo); };
    var P = pts.map(function (p, i) { return [X(i), Y(p[1])]; });
    function path() {
      g.moveTo(P[0][0], P[0][1]);
      for (var i = 0; i < P.length - 1; i++) { var mx = (P[i][0] + P[i + 1][0]) / 2; g.bezierCurveTo(mx, P[i][1], mx, P[i + 1][1], P[i + 1][0], P[i + 1][1]); }
    }
    if (o.base != null) { g.setLineDash([2, 5]); g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(o.base)); g.lineTo(w, Y(o.base)); g.stroke(); g.setLineDash([]); }
    var grd = g.createLinearGradient(0, padT, 0, h); grd.addColorStop(0, o.color + "55"); grd.addColorStop(0.6, o.color + "14"); grd.addColorStop(1, o.color + "00");
    g.fillStyle = grd; g.beginPath(); path(); g.lineTo(P[P.length - 1][0], h); g.lineTo(P[0][0], h); g.closePath(); g.fill();
    g.shadowColor = o.color + "aa"; g.shadowBlur = 10; g.strokeStyle = o.color; g.lineWidth = 2.4; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); path(); g.stroke(); g.shadowBlur = 0;
    var e = P[P.length - 1]; g.fillStyle = o.color; g.beginPath(); g.arc(Math.min(e[0], w - 5), e[1], 4, 0, 7); g.fill();
    g.fillStyle = o.color + "33"; g.beginPath(); g.arc(Math.min(e[0], w - 5), e[1], 9, 0, 7); g.fill();
    if (o.line != null) {
      g.setLineDash([6, 6]); g.strokeStyle = "#ff9f0a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, Y(o.line)); g.lineTo(w, Y(o.line)); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#ff9f0a"; g.font = "600 11px -apple-system,BlinkMacSystemFont,sans-serif"; g.fillText(o.lineLabel || "", 14, Y(o.line) - 6);
    }
    if (!o.tip) return;
    var fmt = o.fmt || function (v) { return usd(v); };
    function scrub(ev) {
      var r = cv.getBoundingClientRect(), x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left), bi = 0;
      for (var i = 0; i < P.length; i++) if (Math.abs(P[i][0] - x) < Math.abs(P[bi][0] - x)) bi = i;
      o.tip.style.left = Math.max(40, Math.min(w - 40, P[bi][0])) + "px"; o.tip.style.opacity = 1;
      o.tip.textContent = fmt(pts[bi][1]) + " · " + hhmm(pts[bi][0]);
    }
    function hide() { o.tip.style.opacity = 0; }
    cv.addEventListener("touchstart", scrub, { passive: true }); cv.addEventListener("touchmove", scrub, { passive: true }); cv.addEventListener("touchend", hide);
    cv.addEventListener("mousemove", scrub); cv.addEventListener("mouseleave", hide);
  }

  document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("a.tap,.tabs a,.btn"); if (a) haptic(); });
  window.addEventListener("hashchange", function () { var m = route().coin; if (m && !S.coin[m]) loadCoin(m); render(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(render, 150); });
  render(); load();
  setInterval(function () { if (!document.hidden) { S.nextPoll = Date.now() + POLL_MS; load(); } }, POLL_MS);
  setInterval(function () { if (S.err || (S.state && Date.now() / 1000 - S.state.ts > STALE_S)) chrome(); }, 1000);
})();
