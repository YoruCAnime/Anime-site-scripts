// ==UserScript==
// @name         Atsu Next Chapters
// @namespace    https://github.com/YoruCAnime/Anime-site-scripts
// @version      1.1.1
// @description  On atsu.moe's home page: a timeline down the left side counting down to the next chapter of every ongoing series you're caught up on (your Reading bookmarks), predicted from each series' own release rhythm. New chapters you haven't read yet sit at the top; late series and ones that look like they're on a break are marked.
// @author       YoruCAnime
// @homepageURL  https://github.com/YoruCAnime/Anime-site-scripts
// @match        https://atsu.moe/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-next-chapters.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-next-chapters.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- settings ----------
  const MAX_UNREAD = 3;          // more unread chapters than this = you're catching up on it, not reading it week by week
  const CARD_H = 74;             // px, one series card
  const DAY = 864e5, HOUR = 36e5, MIN = 6e4;
  const CDN = 'https://cdn.atsu.moe/static/';
  const KEY_CACHE = 'nextch:cache:v1', KEY_HIDDEN = 'nextch:hidden', KEY_BM = 'nextch:bookmarks';

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let cache = load(KEY_CACHE, {});           // manga id -> summary of its page
  let hidden = new Set(load(KEY_HIDDEN, []));
  let bm = load(KEY_BM, { ids: [], at: 0 });  // your Reading / Rereading bookmarks
  let showHidden = false;
  let loggedOut = false;

  // ---------- what a series' page tells us ----------
  function summarize(id, mp) {
    const ch = mp.chapters || [];                    // the newest ~20 uploads, every group
    const firstAt = new Map(), idOf = new Map();     // chapter number -> its first upload (any group)
    for (const c of ch) {
      if (!firstAt.has(c.number) || c.createdAt < firstAt.get(c.number)) { firstAt.set(c.number, c.createdAt); idOf.set(c.number, c.id); }
    }
    const nums = [...firstAt.keys()].sort((a, b) => b - a);
    const read = ch.filter((c) => c.progress).map((c) => c.number);
    const readMax = read.length ? Math.max(...read) : null;
    const unread = readMax === null ? nums : nums.filter((n) => n > readMax);
    const first = unread.length ? unread[unread.length - 1] : null;
    // release moments: a double release within 12 h counts once
    const rel = [];
    for (const t of [...firstAt.values()].sort((a, b) => b - a)) if (!rel.length || rel[rel.length - 1] - t > 12 * HOUR) rel.push(t);
    return {
      id,
      title: mp.englishTitle || mp.title || id,
      img: mp.poster && mp.poster.smallImage ? CDN + mp.poster.smallImage : '',
      status: mp.status,
      last: nums.length ? nums[0] : null,
      readMax,
      unread: unread.length,
      firstUnread: first === null ? null : { num: first, id: idOf.get(first), at: firstAt.get(first) },
      rel: rel.slice(0, 10),
      fetchedAt: Date.now(),
    };
  }

  // how often it comes out, from the gaps between its last releases
  function rhythm(rel) {
    const gaps = [];
    for (let i = 1; i < Math.min(rel.length, 9); i++) gaps.push((rel[i - 1] - rel[i]) / DAY);
    if (!gaps.length) return null;
    const med = [...gaps].sort((a, b) => a - b)[gaps.length >> 1];
    let period = med, label;
    if (med >= 5.5 && med <= 8.5) { period = 7; label = 'weekly'; }
    else if (med >= 12.5 && med <= 16) { period = 14; label = 'every 2 weeks'; }
    else if (med >= 25 && med <= 36) label = 'about monthly';
    else label = 'every ~' + Math.max(1, Math.round(med)) + ' days';
    const tol = Math.max(1.5, period * 0.2);
    const steady = gaps.filter((g) => Math.abs(g - period) <= tol).length / gaps.length;
    return { period, label, sure: gaps.length >= 3 && steady >= 0.6 };
  }

  // null = not one of your weekly reads (finished, never started, or you're several chapters behind)
  function classify(s, now) {
    if (!s || s.status === 'Completed' || s.readMax === null || s.unread > MAX_UNREAD) return null;
    if (s.unread > 0) return { kind: 'out' };
    if (s.status === 'Hiatus') return { kind: 'hiatus' };
    const r = rhythm(s.rel);
    if (!r) return { kind: 'unknown' };
    const lastAt = s.rel[0];
    const next = lastAt + r.period * DAY;
    if (now > lastAt + Math.max(2.2 * r.period, r.period + 10) * DAY) return { kind: 'break', r, lastAt };
    return { kind: now > next ? 'late' : 'soon', r, lastAt, next };
  }

  // when to look at a series' page again
  function stale(s, now) {
    if (!s) return true;
    const age = now - s.fetchedAt;
    if (s.status === 'Completed') return age > 7 * DAY;
    if (s.readMax === null || s.unread > MAX_UNREAD) return age > DAY;
    if (s.unread > 0) return age > 20 * MIN;                 // waiting for you to read it
    const c = classify(s, now);
    if (c && (c.kind === 'late' || (c.kind === 'soon' && c.next - now < HOUR))) return age > 15 * MIN;   // due: look often
    if (c && c.kind === 'soon') return age > 6 * HOUR;
    return age > 12 * HOUR;
  }

  // ---------- fetching (3 at a time, read only) ----------
  const queue = [];
  let running = 0, saveTimer = 0, renderTimer = 0;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store(KEY_CACHE, cache), 400); };
  const renderSoon = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 150); };

  function enqueue(ids) {
    for (const id of ids) if (!queue.includes(id)) queue.push(id);
    pump();
  }
  function pump() {
    while (running < 3 && queue.length) {
      const id = queue.shift();
      running++;
      fetch('/api/manga/page?id=' + encodeURIComponent(id), { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j) => { if (j && j.mangaPage) cache[id] = summarize(id, j.mangaPage); })
        .catch(() => { /* tried again next time */ })
        .finally(() => { running--; saveSoon(); renderSoon(); setTimeout(pump, 120); });
    }
    if (panel) panel.classList.toggle('nc-busy', running > 0 || queue.length > 0);
  }

  async function refreshBookmarks(force) {
    if (!force && bm.ids.length && Date.now() - bm.at < 5 * MIN) return;
    try {
      const r = await fetch('/api/user/bookmarkIds', { credentials: 'same-origin' });
      if (r.status === 401 || r.status === 403) { loggedOut = true; return; }
      const j = await r.json();
      const ids = (j.bookmarks || []).filter((b) => /^(Reading|Rereading)$/i.test(b.status)).map((b) => b.mangaId);
      loggedOut = false;
      bm = { ids, at: Date.now() };
      store(KEY_BM, bm);
      for (const id of Object.keys(cache)) if (!ids.includes(id)) delete cache[id];
    } catch (e) { /* offline: keep the old list */ }
  }
  function refreshStale() {
    const now = Date.now();
    enqueue(bm.ids.filter((id) => stale(cache[id], now)));
  }

  // ---------- words ----------
  function countdown(ms) {
    const m = Math.max(0, Math.round(ms / MIN));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  function ago(ms) {
    const h = ms / HOUR;
    if (h < 1) return Math.max(1, Math.round(ms / MIN)) + ' min ago';
    if (h < 24) return Math.round(h) + 'h ago';
    const d = Math.round(h / 24);
    return d < 14 ? d + (d === 1 ? ' day ago' : ' days ago') : Math.round(d / 7) + ' weeks ago';
  }
  const when = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const nextNum = (last) => (last == null ? '' : 'Ch ' + (Math.floor(last) + 1));

  // ---------- panel ----------
  let panel = null, body = null, tab = null, foldOpen = false;
  const onHome = () => location.pathname === '/';

  // atsu's content column (max-w-(--wrapper)); the panel lives in the space to its left
  function contentLeft() {
    let best = Infinity;
    for (const el of document.querySelectorAll('[class*="max-w-(--wrapper)"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 500 && r.left >= 0) best = Math.min(best, r.left);
    }
    return best === Infinity ? Math.max(0, (document.documentElement.clientWidth - 1200) / 2) : best;
  }

  function ensurePanel() {
    if (panel && panel.isConnected) return;
    if (!css.isConnected) document.head.appendChild(css);   // styles only once the home page is shown
    panel = document.createElement('aside');
    panel.id = 'nc-panel';
    panel.innerHTML = `
      <div class="nc-head"><span class="nc-h">Next chapters</span><span class="nc-dot" title="Checking for new chapters"></span>
        <button class="nc-btn nc-refresh" title="Check again now">↻</button><button class="nc-btn nc-close" title="Close">✕</button></div>
      <div class="nc-body"></div>
      <div class="nc-foot"></div>`;
    document.body.appendChild(panel);
    body = panel.querySelector('.nc-body');
    panel.querySelector('.nc-refresh').onclick = () => {
      for (const id of bm.ids) if (cache[id]) cache[id].fetchedAt = 0;
      refreshBookmarks(true).then(() => { refreshStale(); render(); });
    };
    panel.querySelector('.nc-close').onclick = () => { foldOpen = false; place(); };
    panel.addEventListener('click', (e) => {
      const hide = e.target.closest('.nc-hide');
      if (hide) {
        e.preventDefault(); e.stopPropagation();
        const id = hide.dataset.id;
        if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
        store(KEY_HIDDEN, [...hidden]);
        render();
        return;
      }
      if (e.target.closest('.nc-showhidden')) { e.preventDefault(); showHidden = !showHidden; render(); }
    });
    tab = document.createElement('button');
    tab.id = 'nc-tab';
    tab.title = 'Next chapters';
    tab.onclick = () => { foldOpen = !foldOpen; place(); };
    document.body.appendChild(tab);
  }

  function removePanel() {
    if (panel) panel.remove();
    if (tab) tab.remove();
    panel = body = tab = null;
    foldOpen = false;
  }

  // beside the content when there is room, else a small tab on the left edge that opens it
  function place() {
    if (!panel) return;
    const nav = document.querySelector('nav');
    const top = Math.max(12, (nav ? nav.getBoundingClientRect().bottom : 80) + 12);
    const room = contentLeft() - 20;
    const fold = room < 190;
    panel.classList.toggle('nc-fold', fold);
    panel.classList.toggle('nc-open', fold && foldOpen);
    panel.style.top = top + 'px';
    panel.style.width = (fold ? 260 : Math.min(270, room)) + 'px';
    tab.style.display = fold ? '' : 'none';
    tab.style.top = top + 'px';
  }

  function cardHTML(it, now, top) {
    const { s, c } = it;
    const hideBtn = `<button class="nc-hide" data-id="${esc(s.id)}" title="${it.hidden ? 'Show again' : 'Hide this series'}">${it.hidden ? '↺' : '✕'}</button>`;
    const cover = s.img ? `<img class="nc-cover" src="${esc(s.img)}" alt="" loading="lazy">` : '<span class="nc-cover"></span>';
    const pos = top == null ? '' : ` style="top:${top}px"`;
    if (c.kind === 'out') {
      const more = s.unread > 1 ? ` <span class="nc-more">+${s.unread - 1}</span>` : '';
      const href = s.firstUnread && s.firstUnread.id ? `/read/${esc(s.id)}/${esc(s.firstUnread.id)}` : `/manga/${esc(s.id)}`;
      return `<a class="nc-card nc-out${it.hidden ? ' nc-ghost' : ''}" href="${href}"${pos}>${cover}
        <div class="nc-info"><div class="nc-title">${esc(s.title)}</div>
        <div class="nc-when"><b class="nc-new">NEW · Ch ${esc(s.firstUnread.num)}</b>${more}</div>
        <div class="nc-meta">out ${ago(now - s.firstUnread.at)}</div></div>${hideBtn}</a>`;
    }
    const late = c.kind === 'late';
    const approx = c.r.sure ? '' : '≈ ';
    const left = late ? 'late ' + countdown(now - c.next) : approx + countdown(c.next - now);
    const fill = late ? 0 : Math.max(0, Math.min(1, (c.next - now) / (c.r.period * DAY)));
    return `<a class="nc-card nc-${c.kind}${it.hidden ? ' nc-ghost' : ''}" href="/manga/${esc(s.id)}" data-next="${c.next}" data-period="${c.r.period}" data-sure="${c.r.sure ? 1 : 0}"${pos}>${cover}
      <div class="nc-info"><div class="nc-title">${esc(s.title)}</div>
      <div class="nc-when"><b class="nc-count">${left}</b></div>
      <div class="nc-meta" title="${esc(nextNum(s.last))} ${late ? 'was due' : 'expected'} ${esc(when(c.next))} · comes out ${esc(c.r.label)}${c.r.sure ? '' : ' (rough guess)'}">${nextNum(s.last)} · ${late ? 'was due ' : ''}${when(c.next)}</div></div>
      <div class="nc-bar"><i style="width:${(fill * 100).toFixed(1)}%"></i></div>${hideBtn}</a>`;
  }

  function quietHTML(it, now) {
    const { s, c } = it;
    const why = c.kind === 'soon' ? `${nextNum(s.last)} in ${c.r.sure ? '' : '≈'}${countdown(c.next - now)} · ${c.r.label}`
      : c.kind === 'hiatus' ? 'On hiatus'
      : c.kind === 'break' ? `Probably on a break · last chapter ${ago(now - c.lastAt)} (${c.r.label})`
      : 'Not enough chapters yet to tell its rhythm';
    return `<a class="nc-row${it.hidden ? ' nc-ghost' : ''}" href="/manga/${esc(s.id)}"><span class="nc-rt">${esc(s.title)}</span><span class="nc-rw">${why}</span>
      <button class="nc-hide" data-id="${esc(s.id)}" title="${it.hidden ? 'Show again' : 'Hide this series'}">${it.hidden ? '↺' : '✕'}</button></a>`;
  }

  // the timeline: one line from "now" down, a long tick + name for each day with releases, a short tick per series
  function timelineHTML(list, now, width) {
    const today = new Date(now).toDateString(), tomorrow = new Date(now + DAY).toDateString();
    const groups = [];
    for (const it of list) {
      const k = it.c.kind === 'late' ? 'late' : new Date(it.c.next).toDateString();
      let g = groups[groups.length - 1];
      if (!g || g.k !== k) groups.push(g = { k, items: [] });
      g.items.push(it);
    }
    const name = (g) => (g.k === 'late' ? 'Due now' : g.k === today ? 'Today' : g.k === tomorrow ? 'Tomorrow'
      : new Date(g.items[0].c.next).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));
    const days = groups.map((g) => `<div class="nc-day${g.k === 'late' ? ' nc-dlate' : ''}">${esc(name(g))}</div>`
      + g.items.map((it) => `<div class="nc-slot nc-s-${it.c.kind}">${cardHTML(it, now, null)}</div>`).join('')).join('');
    return `<div class="nc-ruler${width - 22 < 160 ? ' nc-narrow' : ''}"><i class="nc-line"></i><div class="nc-now">now</div>${days}</div>`;
  }

  function render() {
    if (!onHome() || loggedOut || !bm.ids.length) { removePanel(); return; }
    ensurePanel();
    place();
    const now = Date.now();
    const out = [], line = [], later = [], quiet = [];
    let hiddenCount = 0, waiting = 0;
    for (const id of bm.ids) {
      const s = cache[id];
      if (!s) { waiting++; continue; }
      const c = classify(s, now);
      if (!c) continue;
      const isHidden = hidden.has(id);
      if (isHidden) hiddenCount++;
      if (isHidden && !showHidden) continue;
      const it = { s, c, hidden: isHidden };
      if (c.kind === 'out') out.push(it);
      else if (c.kind === 'late' || (c.kind === 'soon' && c.next - now <= 14 * DAY)) line.push(it);
      else if (c.kind === 'soon') later.push(it);            // weeks away: a short row, not a long empty ruler
      else quiet.push(it);
    }
    out.sort((a, b) => b.s.firstUnread.at - a.s.firstUnread.at);
    line.sort((a, b) => a.c.next - b.c.next);
    later.sort((a, b) => a.c.next - b.c.next);
    const width = parseFloat(panel.style.width) || 220;
    let html = '';
    if (out.length) html += `<div class="nc-sec">Out now</div><div class="nc-outs">${out.map((it) => cardHTML(it, now, null)).join('')}</div>`;
    if (line.length) html += `<div class="nc-sec">Coming up</div>${timelineHTML(line, now, width)}`;
    if (later.length) html += `<div class="nc-sec">Later</div>${later.map((it) => quietHTML(it, now)).join('')}`;
    if (quiet.length) html += `<div class="nc-sec">Waiting</div>${quiet.map((it) => quietHTML(it, now)).join('')}`;
    if (!html) html = waiting ? '<div class="nc-empty">Looking at your bookmarks…</div>'
      : '<div class="nc-empty">Nothing to count down yet. Series you\'re caught up on (in your Reading bookmarks) show up here.</div>';
    body.innerHTML = html;
    panel.querySelector('.nc-foot').innerHTML = hiddenCount
      ? `<a href="#" class="nc-showhidden">${showHidden ? 'Hide' : 'Show'} ${hiddenCount} hidden</a>` : '';
    const soonCount = out.length + line.filter((it) => it.c.kind === 'late' || it.c.next - now < DAY).length;
    tab.textContent = '⏱' + (soonCount ? ' ' + soonCount : '');
    panel.classList.toggle('nc-busy', running > 0 || queue.length > 0);
  }

  // countdowns tick without rebuilding the panel (so hovering is never disturbed)
  function tick() {
    if (!panel || !onHome()) return;
    const now = Date.now();
    let rebuild = false;
    for (const el of panel.querySelectorAll('.nc-card[data-next]')) {
      const next = +el.dataset.next, period = +el.dataset.period;
      const late = now > next;
      if (late !== el.classList.contains('nc-late')) { rebuild = true; break; }
      el.querySelector('.nc-count').textContent = late ? 'late ' + countdown(now - next) : (el.dataset.sure === '1' ? '' : '≈ ') + countdown(next - now);
      const bar = el.querySelector('.nc-bar i');
      if (bar) bar.style.width = (late ? 0 : Math.max(0, Math.min(1, (next - now) / (period * DAY))) * 100).toFixed(1) + '%';
    }
    if (rebuild) render();
  }

  // ---------- life cycle (atsu changes pages without reloading) ----------
  // On every other page (reading a chapter too) all that runs is this once-a-second "are we home?" check.
  let wasHome = false;
  async function onEnterHome() {
    render();
    await refreshBookmarks(false);
    render();
    refreshStale();
  }
  setInterval(() => {
    const home = onHome();
    if (home && !wasHome) onEnterHome();
    if (!home && wasHome) removePanel();
    wasHome = home;
  }, 1000);
  setInterval(() => { if (panel) tick(); }, 5000);
  setInterval(() => { if (panel && onHome()) refreshStale(); }, 60000);
  window.addEventListener('resize', renderSoon);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && foldOpen) { foldOpen = false; place(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && onHome()) { refreshBookmarks(false).then(() => { refreshStale(); render(); }); } });

  // ---------- looks (atsu's own colours) ----------
  const css = document.createElement('style');
  css.textContent = `
    #nc-panel { --nc-accent: var(--color-accent, #8e7ce6); --nc-card: var(--color-slate2, #282828); --nc-card2: var(--color-slate3, #313234);
      --nc-fg: var(--color-foreground, #b8bcc0); --nc-fg2: var(--color-foreground2, #f9f8f6); --nc-amber: #e0a458; --nc-grey: #7b8086;
      position: fixed; left: 10px; bottom: 12px; z-index: 20; display: flex; flex-direction: column;
      font: 12px/1.3 Geist, system-ui, sans-serif; color: var(--nc-fg); }
    #nc-panel.nc-fold { display: none; }
    #nc-panel.nc-fold.nc-open { display: flex; background: var(--color-slate, #1d1e20); border-radius: 10px; padding: 10px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, .6); z-index: 60; }
    #nc-panel .nc-head { display: flex; align-items: center; gap: 6px; padding: 0 2px 8px; }
    #nc-panel .nc-h { font-size: 14px; font-weight: 600; color: var(--nc-fg2); flex: 1; }
    #nc-panel .nc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--nc-accent); opacity: 0; transition: opacity .3s; }
    #nc-panel.nc-busy .nc-dot { opacity: 1; animation: nc-pulse 1s ease-in-out infinite; }
    @keyframes nc-pulse { 50% { opacity: .25; } }
    #nc-panel .nc-btn { background: none; border: 0; color: var(--nc-grey); cursor: pointer; font-size: 13px; padding: 2px 4px; border-radius: 4px; }
    #nc-panel .nc-btn:hover { color: var(--nc-fg2); background: var(--nc-card); }
    #nc-panel:not(.nc-fold) .nc-close { display: none; }
    #nc-panel .nc-body { overflow-y: auto; overflow-x: hidden; flex: 1; padding-right: 4px; scrollbar-width: thin; scrollbar-color: #3a3b3e transparent; }
    #nc-panel .nc-sec { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--nc-grey); margin: 6px 2px 6px; }
    #nc-panel .nc-outs { display: grid; gap: 6px; margin-bottom: 8px; }
    #nc-panel .nc-card { position: relative; display: flex; gap: 7px; align-items: flex-start; height: ${CARD_H}px; box-sizing: border-box;
      padding: 7px 7px 9px; border-radius: 8px; background: var(--nc-card); color: inherit; text-decoration: none; overflow: hidden; }
    #nc-panel .nc-card:hover { background: var(--nc-card2); }
    #nc-panel .nc-cover { flex: none; width: 34px; height: 48px; border-radius: 4px; object-fit: cover; background: #333; }
    #nc-panel .nc-narrow .nc-cover { width: 24px; height: 36px; }
    #nc-panel .nc-narrow .nc-card { gap: 6px; }
    #nc-panel .nc-info { min-width: 0; flex: 1; }
    #nc-panel .nc-title { color: var(--nc-fg2); font-size: 11.5px; line-height: 1.2; font-weight: 500; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
    #nc-panel .nc-when { margin-top: 2px; white-space: nowrap; line-height: 1.15; }
    #nc-panel .nc-count { color: var(--nc-fg2); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
    #nc-panel .nc-late .nc-count { color: var(--nc-amber); font-size: 13px; }
    #nc-panel .nc-meta { font-size: 10.5px; color: var(--nc-grey); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    #nc-panel .nc-new { color: var(--nc-accent); font-size: 12.5px; font-weight: 700; }
    #nc-panel .nc-more { color: var(--nc-fg); font-size: 11px; }
    #nc-panel .nc-out { box-shadow: inset 3px 0 0 var(--nc-accent); }
    #nc-panel .nc-bar { position: absolute; left: 7px; right: 7px; bottom: 4px; height: 2px; border-radius: 2px; background: rgba(255, 255, 255, .07); }
    #nc-panel .nc-bar i { display: block; height: 100%; border-radius: 2px; background: var(--nc-accent); transition: width 1s linear; }
    #nc-panel .nc-hide { position: absolute; top: 3px; right: 3px; width: 18px; height: 18px; border: 0; border-radius: 4px; padding: 0;
      background: var(--nc-card2); color: var(--nc-grey); font-size: 10px; cursor: pointer; opacity: 0; transition: opacity .15s; }
    #nc-panel .nc-card:hover .nc-hide, #nc-panel .nc-row:hover .nc-hide { opacity: 1; }
    #nc-panel .nc-hide:hover { color: var(--nc-fg2); }
    #nc-panel .nc-ghost { opacity: .45; }
    #nc-panel .nc-ruler { position: relative; margin: 2px 0 10px; padding-left: 22px; }
    #nc-panel .nc-line { position: absolute; left: 7px; top: 8px; bottom: 30px; width: 2px; border-radius: 2px;
      background: linear-gradient(var(--nc-accent), rgba(142, 124, 230, .12)); }
    #nc-panel .nc-now { position: relative; height: 16px; font-size: 10px; font-weight: 600; color: var(--nc-accent); line-height: 16px; }
    #nc-panel .nc-now::before { content: ''; position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; border-radius: 50%;
      background: var(--nc-accent); box-shadow: 0 0 0 3px rgba(142, 124, 230, .25); }
    #nc-panel .nc-day { position: relative; margin: 10px 0 5px; font-size: 11px; font-weight: 600; color: var(--nc-fg); }
    #nc-panel .nc-day::before { content: ''; position: absolute; left: -18px; top: 50%; width: 14px; height: 2px; margin-top: -1px; background: #77787d; border-radius: 1px; }
    #nc-panel .nc-dlate { color: var(--nc-amber); }
    #nc-panel .nc-slot { position: relative; margin-bottom: 6px; }
    #nc-panel .nc-slot::before { content: ''; position: absolute; left: -13px; top: 50%; width: 11px; height: 1px; background: #55565b; }
    #nc-panel .nc-slot::after { content: ''; position: absolute; left: -18px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%;
      background: var(--nc-accent); box-shadow: 0 0 0 2px var(--color-slate, #1d1e20); }
    #nc-panel .nc-s-late::after { background: var(--nc-amber); }
    #nc-panel .nc-row { position: relative; display: block; padding: 6px 26px 6px 8px; margin-bottom: 4px; border-radius: 6px; background: rgba(255, 255, 255, .025);
      color: inherit; text-decoration: none; }
    #nc-panel .nc-row:hover { background: var(--nc-card); }
    #nc-panel .nc-rt { display: block; color: var(--nc-fg); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #nc-panel .nc-rw { display: block; color: var(--nc-grey); font-size: 10.5px; }
    #nc-panel .nc-empty { color: var(--nc-grey); font-size: 11.5px; padding: 8px 2px; }
    #nc-panel .nc-foot { padding-top: 6px; font-size: 11px; }
    #nc-panel .nc-foot a { color: var(--nc-grey); }
    #nc-tab { position: fixed; left: 0; z-index: 59; padding: 8px 8px 8px 6px; border: 0; border-radius: 0 8px 8px 0; cursor: pointer;
      background: var(--color-slate3, #313234); color: var(--color-foreground2, #f9f8f6); font: 600 12px Geist, system-ui, sans-serif; }
  `;
})();
