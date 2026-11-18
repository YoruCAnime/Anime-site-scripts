// ==UserScript==
// @name         MAL DMs
// @namespace    yoruc.mal.dms
// @author       YoruC
// @version      1.2.1
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-dms.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-dms.user.js
// @description  Your MyAnimeList private messages as chats: one conversation per friend, a chat button bottom right, a red number for new ones, GIF search, pictures, spoilers, links, YouTube, live preview. AniList codes (img( ), youtube( ), ~! !~) are turned into MAL's own.
// @match        https://myanimelist.net/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      tenor.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;            // never inside our own hidden send frame
  if (document.getElementById('mdm-fab')) return;

  // ---- settings ---------------------------------------------------------------
  const SHOW_LAST = 15;        // newest messages shown when a chat opens
  const OLDER_STEP = 20;       // how many more each "Show older" shows
  const COOLDOWN = 31000;      // MAL lets you send one message every 30 s
  const POLL_OPEN = 20000;     // inbox check while the panel is open
  const POLL_BG = 20000;       // inbox check while it is closed (one MAL tab checks, also in the background)
  const GAP = 350;             // pause between two requests to MAL
  const FIRST_PAGES = 5;       // inbox / sent pages read on the first start (20 messages each)
  const KEEP_BODIES = 400;     // full messages remembered for instant opening
  const BASE = '/mymessages.php';

  // ---- small helpers ----------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mdm:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mdm:' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const lower = s => String(s || '').toLowerCase();
  const baseSubj = s => String(s || '').replace(/^(\s*re:\s*)+/i, '').trim();

  // one request to MAL at a time, with a small pause in between
  let chain = Promise.resolve();
  function malGet(url) {
    const run = async () => {
      let r, n = 0;
      for (;;) {
        try { r = await fetch(url, { credentials: 'same-origin' }); break; }
        catch (e) { if (++n > 2) throw new Error('MAL did not answer. Trying again by itself.'); await sleep(1500 * n); }
      }
      if (!r.ok) throw new Error('MAL answered ' + r.status);
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      await sleep(GAP);
      return doc;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  // ---- reading MAL's pages ----------------------------------------------------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(txt, now) {
    txt = String(txt || '').trim(); now = now || Date.now();
    let m = /(\d+)\s+(second|minute|hour|day)s?\s+ago/i.exec(txt);
    if (m) return { t: now - m[1] * { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5 }[m[2].toLowerCase()], exact: /second|minute/i.test(m[2]) };
    const clock = (h, mi, ap) => { h = +h % 12; if (/pm/i.test(ap)) h += 12; return [h, +mi]; };
    m = /^(today|yesterday),?\s+(\d+):(\d+)\s*(am|pm)/i.exec(txt);
    if (m) { const d = new Date(now); if (/yes/i.test(m[1])) d.setDate(d.getDate() - 1); const [h, mi] = clock(m[2], m[3], m[4]); d.setHours(h, mi, 0, 0); return { t: +d, exact: true }; }
    m = /^([a-z]{3})[a-z]*\s+(\d+),\s*(?:(\d{4}),?\s+)?(\d+):(\d+)\s*(am|pm)/i.exec(txt);
    if (m && lower(m[1]) in MONTHS) {
      const [h, mi] = clock(m[4], m[5], m[6]);
      const d = new Date(m[3] ? +m[3] : new Date(now).getFullYear(), MONTHS[lower(m[1])], +m[2], h, mi);
      if (!m[3] && +d > now + 864e5) d.setFullYear(d.getFullYear() - 1);
      return { t: +d, exact: true };
    }
    const t = Date.parse(txt);
    return { t: isNaN(t) ? 0 : t, exact: !isNaN(t) };
  }

  function parseList(doc, mine) {
    const now = Date.now();
    return [...doc.querySelectorAll('.message[id^="message_"]')].map(r => {
      const a = r.querySelector('.mym_user a'), sl = r.querySelector('.subject-link');
      const span = sl && sl.querySelector('.text');
      const prev = span ? span.textContent.trim() : '';
      let subj = sl ? sl.textContent : '';
      if (span) { const i = subj.lastIndexOf(span.textContent); if (i >= 0) subj = subj.slice(0, i); }
      const rep = r.querySelector('.mym_actions a[href*="replyid"]');
      const d = parseDate((r.querySelector('.mym_date') || {}).textContent, now);
      return {
        id: +r.id.slice(8), rid: sl ? +((/[?&]id=(\d+)/.exec(sl.getAttribute('href') || '') || [])[1] || 0) : 0, who: a ? a.textContent.trim() : '', mine,
        subj: subj.replace(/\s*-\s*$/, '').trim(), prev, t: d.t, exact: d.exact,
        unread: !mine && !/(^|\s)read(\s|$)/.test(r.className),
        reply: rep ? rep.getAttribute('href') : '',
      };
    }).filter(m => m.id && m.who);
  }
  const loggedOut = doc => !doc.querySelector('.private-message-content, #dialog, .message[id^="message_"]') && !!doc.querySelector('a[href*="login.php"], form[action*="login"]');

  function parseBody(doc) {
    const td = doc.querySelector('td.dialog-text');
    if (!td) return null;
    const c = td.cloneNode(true);
    const dateTxt = (c.querySelector('.lightLink') || {}).textContent;
    c.querySelectorAll('.message-response-buttons, script, form').forEach(n => n.remove());
    const h2 = c.querySelector('h2'); if (h2) h2.remove();
    [...c.children].slice(0, 2).forEach(n => { if (n.tagName === 'DIV' && /lightLink|fw-b/.test(n.className)) n.remove(); });
    c.querySelectorAll('img').forEach(i => { const ds = i.getAttribute('data-src'); if (ds) i.setAttribute('src', ds); i.removeAttribute('width'); i.removeAttribute('height'); i.loading = 'lazy'; });
    c.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    return { html: c.innerHTML.replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, ''), date: parseDate(dateTxt) };
  }

  // ---- what we remember -------------------------------------------------------
  let db = store.get('db', null);
  if (!db || db.v !== 2) db = { v: 2, msgs: {}, deep: { inbox: 0, sent: 0, inboxDone: false, sentDone: false }, first: false };
  let bodies = store.get('bodies', {});
  const me = ((document.querySelector('.header-profile-link') || {}).textContent || '').trim();
  const ui = { open: false, friend: null, shown: SHOW_LAST, view: 'list', err: '', busy: false, sending: false, gif: false, emoji: false };
  let pending = store.get('pending', {});          // friend(lower) -> text waiting for the 30 s gap
  let drafts = store.get('drafts', {});
  let opts = Object.assign({ preview: true, enterSends: true, pasteLinks: true, sound: true, volume: 0.15, notify: true }, store.get('opts', {}));
  let hidden = store.get('hidden', {});             // friend(lower) -> newest message when the chat was removed from the list
  let avatars = store.get('avatars', {});
  let subjects = store.get('subjects', {});         // friend(lower) -> your own subject line (optional)

  function saveDb() { store.set('db', db); }
  function saveBodies() {
    const ids = Object.keys(bodies).map(Number).sort((a, b) => b - a);
    if (ids.length > KEEP_BODIES) ids.slice(KEEP_BODIES).forEach(i => delete bodies[i]);
    if (!store.set('bodies', bodies)) { ids.slice(Math.floor(ids.length / 2)).forEach(i => delete bodies[i]); store.set('bodies', bodies); }
  }
  function merge(rows) {
    let fresh = 0;
    for (const r of rows) {
      const o = db.msgs[r.id];
      if (!o) { db.msgs[r.id] = r; fresh++; continue; }
      o.unread = r.unread; if (r.reply) o.reply = r.reply; if (r.rid) o.rid = r.rid;
      if (r.exact && !o.exact) { o.t = r.t; o.exact = true; }
    }
    return fresh;
  }
  const allMsgs = () => Object.values(db.msgs);
  const msgsOf = f => allMsgs().filter(m => lower(m.who) === lower(f)).sort((a, b) => a.id - b.id);
  function friends() {
    const by = {};
    for (const m of allMsgs()) {
      const k = lower(m.who), f = by[k] || (by[k] = { name: m.who, last: m, unread: 0 });
      if (m.id > f.last.id) f.last = m;
      if (m.unread) f.unread++;
    }
    for (const k of store.get('extra', [])) if (!by[lower(k)]) by[lower(k)] = { name: k, last: { id: 0, t: 0, prev: '' }, unread: 0 };
    return Object.values(by).filter(f => !(lower(f.name) in hidden) || f.last.id > hidden[lower(f.name)]).sort((a, b) => b.last.id - a.last.id);
  }
  const unreadTotal = () => allMsgs().filter(m => m.unread && !(hidden[lower(m.who)] >= m.id)).length;

  // ---- syncing with MAL -------------------------------------------------------
  const pageUrl = (sent, show) => BASE + '?go=' + (sent ? 'sent' : '') + (show ? '&show=' + show : '');
  async function readPage(sent, show) {
    const doc = await malGet(pageUrl(sent, show));
    if (loggedOut(doc)) throw new Error('Log in to MyAnimeList first.');
    const rows = parseList(doc, sent);
    const fresh = merge(rows);
    saveDb();                                       // at once: another check may reload the saved copy meanwhile
    return { rows, fresh };
  }
  async function deeper(pages) {                    // older pages of both folders
    for (const sent of [false, true]) {
      const k = sent ? 'sent' : 'inbox';
      for (let i = 0; i < pages && !db.deep[k + 'Done']; i++) {
        const { rows } = await readPage(sent, db.deep[k]);
        db.deep[k] += 20;
        if (rows.length < 20) db.deep[k + 'Done'] = true;
      }
    }
    saveDb();
  }
  let pollN = 0, working = 0, fails = 0;
  async function sync(force, withSent) {
    if (!force && Date.now() - store.get('pollAt', 0) < (ui.open ? POLL_OPEN : POLL_BG) - 3000) { if (!working) reload(); return; }
    store.set('pollAt', Date.now());
    working++;
    try {
      if (!db.first) {
        ui.busy = true; render();
        await deeper(FIRST_PAGES);
        db.first = true;
      } else {
        await readPage(false, 0);
        announce();
        if (withSent || pollN++ % 5 === 0) await readPage(true, 0);
      }
      if (store.get('told', null) == null) announce();
      ui.err = ''; fails = 0;
      saveDb();
    } catch (e) { if (force || ++fails >= 3) ui.err = e.message || String(e); }
    working--;
    ui.busy = false;
    render();
  }
  function announce() {                             // sound, notification, flash: once per new message, whichever tab finds it
    const told = store.get('told', null), inb = allMsgs().filter(m => !m.mine);
    const top = inb.reduce((a, m) => Math.max(a, m.id), 0);
    if (told == null) { store.set('told', top); return; }
    const news = inb.filter(m => m.unread && m.id > told).sort((a, b) => a.id - b.id);
    if (top > told) store.set('told', top);
    if (!news.length) return;
    flash(); ring(news[news.length - 1].id); notify(news);
  }
  function reload() {                               // another tab did the work
    const d = store.get('db', null); if (d && d.v === 2) db = d;
    bodies = store.get('bodies', bodies); pending = store.get('pending', {}); hidden = store.get('hidden', {});
  }
  window.addEventListener('storage', e => {
    if (e.key === 'mdm:db' || e.key === 'mdm:pending') { reload(); render(); }
    if (e.key === 'mdm:ring' && e.newValue) ringHere();
  });

  const wanted = new Set();
  async function loadBody(m) {
    if (bodies[m.id] != null || wanted.has(m.id) || !m.rid) return;   // the read page has its own number (rid), not the row's
    wanted.add(m.id);
    try {
      const b = parseBody(await malGet(BASE + '?go=read&id=' + m.rid + (m.mine ? '&f=1' : '')));
      if (b) {
        bodies[m.id] = b.html;
        const o = db.msgs[m.id];
        if (o) { if (o.unread) { o.unread = false; } if (b.date.exact && !o.exact) { o.t = b.date.t; o.exact = true; } }
        saveBodies(); saveDb();
        const node = panel.querySelector('.mdm-msg[data-id="' + m.id + '"] .mdm-body');
        if (node) { const stick = nearBottom(); node.innerHTML = b.html; node.classList.remove('mdm-wait'); if (stick) toBottom(); }
        badge();
      }
    } catch (e) { /* shown as its short preview; tried again next time the chat opens */ }
    wanted.delete(m.id);
  }

  async function avatar(name) {
    const k = lower(name);
    if (avatars[k] != null) return;
    avatars[k] = '';
    try {
      const doc = await malGet('/profile/' + encodeURIComponent(name));
      const i = doc.querySelector('.user-image img');
      avatars[k] = (i && (i.getAttribute('data-src') || i.getAttribute('src'))) || '';
      store.set('avatars', avatars);
      panel.querySelectorAll('.mdm-av[data-n="' + CSS.escape(k) + '"]').forEach(a => { if (avatars[k]) a.style.backgroundImage = 'url("' + avatars[k] + '")'; });
    } catch (e) { delete avatars[k]; }
  }

  // ---- AniList codes -> MAL codes, and a local preview ---------------------------
  const ytId = u => { const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(u) || /^([\w-]{11})$/.exec(u.trim()); return m ? m[1] : ''; };
  const IMG_RE = /\.(gif|png|jpe?g|webp|avif)(\?[^\s]*)?$/i;
  function toBB(t) {
    return String(t)
      .replace(/~!([\s\S]*?)!~/g, '[spoiler]$1[/spoiler]')
      .replace(/~~~([\s\S]*?)~~~/g, '[center]$1[/center]')
      .replace(/\bimg\d*%?\(\s*([^)\s]+)\s*\)/gi, '[img]$1[/img]')
      .replace(/\byoutube\(\s*([^)\s]+)\s*\)/gi, (m, u) => ytId(u) ? '[yt]' + ytId(u) + '[/yt]' : u)
      .replace(/\[yt\]\s*(https?:[^\[\s]+)\s*\[\/yt\]/gi, (m, u) => ytId(u) ? '[yt]' + ytId(u) + '[/yt]' : u)
      .replace(/\bwebm\(\s*([^)\s]+)\s*\)/gi, '[url=$1]video[/url]')
      .replace(/\[([^\]\[\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '[url=$2]$1[/url]')
      .replace(/\*\*([^*\n]+)\*\*/g, '[b]$1[/b]')
      .replace(/~~([^~\n]+)~~/g, '[s]$1[/s]')
      .trim();
  }
  const okUrl = u => /^https?:\/\//i.test(u) ? u : '';
  function bb2html(src) {
    let h = esc(toBB(src));
    const pair = (tag, a, b) => { h = h.replace(new RegExp('\\[' + tag + '\\]([\\s\\S]*?)\\[\\/' + tag + '\\]', 'gi'), a + '$1' + b); };
    h = h.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (m, c) => '<pre>' + c.replace(/\[/g, '&#91;') + '</pre>');
    h = h.replace(/\[img[^\]]*\]\s*([^\[\s]+)\s*\[\/img\]/gi, (m, u) => okUrl(u) ? '<img src="' + u + '" loading="lazy">' : m);
    h = h.replace(/\[yt\]([\w-]{11})\[\/yt\]/gi, '<a class="mdm-yt" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=$1"><img src="https://i.ytimg.com/vi/$1/mqdefault.jpg"><span>&#9654;</span></a>');
    h = h.replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => okUrl(u) ? '<a target="_blank" rel="noopener" href="' + u + '">' + t + '</a>' : t);
    h = h.replace(/\[url\]([^\[\s]+)\[\/url\]/gi, (m, u) => okUrl(u) ? '<a target="_blank" rel="noopener" href="' + u + '">' + u + '</a>' : u);
    pair('b', '<b>', '</b>'); pair('i', '<i>', '</i>'); pair('u', '<u>', '</u>'); pair('s', '<s>', '</s>');
    pair('center', '<div style="text-align:center">', '</div>'); pair('right', '<div style="text-align:right">', '</div>');
    h = h.replace(/\[spoiler(?:=[^\]]*)?\]([\s\S]*?)\[\/spoiler\]/gi, '<details class="mdm-sp"><summary>Spoiler</summary>$1</details>');
    h = h.replace(/\[quote(?:=([^\]]*))?\]([\s\S]*?)\[\/quote\]/gi, (m, n, t) => '<blockquote>' + (n ? '<b>' + n + ' said:</b><br>' : '') + t.trim() + '</blockquote>');
    h = h.replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>').replace(/\[size=\d+\]([\s\S]*?)\[\/size\]/gi, '$1');
    return h.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (m, p, u) => p + '<a target="_blank" rel="noopener" href="' + u + '">' + u + '</a>').replace(/\n/g, '<br>');
  }

  // ---- sending: through MAL's own send form (in a hidden frame), one message per 30 s ----
  const myQueue = new Set();                        // chats whose waiting message was typed in THIS tab
  const TAB = Math.random().toString(36).slice(2);
  const lastSend = () => store.get('lastSend', 0);
  const waitLeft = () => Math.max(0, lastSend() + COOLDOWN - Date.now());
  function sendUrl(friend) {
    const inc = msgsOf(friend).filter(m => !m.mine && m.reply).pop();
    if (inc) return new URL(inc.reply.trim(), location.origin + BASE).href;
    return location.origin + BASE + '?go=send&toname=' + encodeURIComponent(friend);
  }
  function subjectFor(friend) {
    const own = (subjects[lower(friend)] || '').trim();
    if (own) return { text: own, force: true };
    const last = msgsOf(friend).pop();
    return { text: last && baseSubj(last.subj) ? 're: ' + baseSubj(last.subj) : 'Hello', force: false };
  }
  function sendThroughMal(friend, text) {
    return new Promise((resolve, reject) => {
      const fr = el('iframe'); fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
      fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:900px;height:700px;border:0;visibility:hidden;';
      let step = 0, done = false;
      const end = (err, val) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => fr.remove(), 200); err ? reject(err) : resolve(val); };
      const timer = setTimeout(() => end(null, 'unsure'), 45000);
      fr.addEventListener('load', async () => {
        let doc; try { doc = fr.contentDocument; } catch (e) { return end(new Error('MAL\'s send page could not be opened.')); }
        if (!doc) return;
        if (step === 0) {
          step = 1;
          const form = doc.forms.subMessage || doc.querySelector('form[name="subMessage"]');
          if (!form) { const bad = doc.querySelector('.badresult'); return end(new Error(bad ? bad.textContent.trim() : (loggedOut(doc) ? 'Log in to MyAnimeList first.' : 'MAL did not show its send form.'))); }
          await sleep(900);                           // MAL's editor and its checks start up
          const subj = form.querySelector('input[name="subject"]'), want = subjectFor(friend);
          if (subj && (want.force || !subj.value.trim())) subj.value = want.text;
          form.querySelectorAll('textarea').forEach(t => { t.value = text; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); });
          const btn = [...form.querySelectorAll('input[type="submit"]')].find(b => /send/i.test(b.value));
          if (!btn) return end(new Error('MAL\'s Send button was not found.'));
          btn.click();                                // MAL's own button: its own checks run as on the site
        } else {
          const bad = doc.querySelector('.badresult');
          if (bad) return end(new Error(bad.textContent.trim().slice(0, 200)));
          end(null, doc.querySelector('.goodresult') || /successfully|has been sent/i.test(doc.body ? doc.body.textContent : '') ? 'ok' : 'unsure');
        }
      });
      fr.src = sendUrl(friend);
      document.body.appendChild(fr);
    });
  }
  async function deliver(friend) {
    const k = lower(friend), text = pending[k];
    if (!text || ui.sending) return;
    ui.sending = true;
    // several MAL tabs open: only one of them sends
    const lock = store.get('sendLock', null);
    if (lock && lock.tab !== TAB && Date.now() - lock.at < 60000) { ui.sending = false; return; }
    store.set('sendLock', { tab: TAB, at: Date.now() });
    await sleep(250);
    if ((store.get('sendLock', {}) || {}).tab !== TAB || !store.get('pending', {})[k]) { ui.sending = false; return; }
    render();
    const before = Math.max(0, ...msgsOf(friend).filter(m => m.mine).map(m => m.id));
    let res = 'unsure', err = null;
    try { res = await sendThroughMal(friend, toBB(text)); } catch (e) { err = e; }
    let arrived = false;
    try { await readPage(true, 0); arrived = msgsOf(friend).some(m => m.mine && m.id > before); } catch (e) {}
    if (arrived || (res === 'ok' && !err)) {
      store.set('lastSend', Date.now());
      delete pending[k]; store.set('pending', pending); saveDb();
      const ex = store.get('extra', []).filter(n => lower(n) !== k); store.set('extra', ex);
      ui.err = '';
    } else {
      const box = panel.querySelector('.mdm-text');
      delete pending[k]; store.set('pending', pending);
      if (ui.friend && lower(ui.friend) === k && box) { box.value = box.value.trim() ? text + '\n\n' + box.value : text; drafts[k] = box.value; }
      else drafts[k] = drafts[k] ? text + '\n\n' + drafts[k] : text;
      store.set('drafts', drafts);
      ui.err = (err ? err.message : 'MAL did not confirm the message.') + ' Your text is back in the box.';
      if (err && /30 seconds|one PM/i.test(err.message)) store.set('lastSend', Date.now());
    }
    ui.sending = false; store.set('sendLock', null);
    render(); toBottom();
  }
  function queue(friend, text) {
    const k = lower(friend);
    myQueue.add(k);
    pending[k] = pending[k] ? pending[k] + '\n\n' + text : text;   // a second message during the wait joins the first
    store.set('pending', pending);
    render(); toBottom();
    tick();
  }
  function tick() {
    const left = waitLeft();
    panel.querySelectorAll('.mdm-count').forEach(n => { n.textContent = left ? Math.ceil(left / 1000) + ' s' : ''; });
    const sb = panel.querySelector('.mdm-send'); if (sb) sb.textContent = ui.sending ? 'Sending…' : left ? 'Send (' + Math.ceil(left / 1000) + ')' : 'Send';
    if (!left && !ui.sending) { const k = Object.keys(pending).find(x => myQueue.has(x) || document.visibilityState === 'visible'); if (k) { const f = friends().find(x => lower(x.name) === k); deliver(f ? f.name : k); } }
  }
  setInterval(tick, 1000);

  // ---- GIF search (Tenor's own search page carries its results) ----------------------
  function webGet(url) {
    return new Promise((res, rej) => {
      if (typeof GM_xmlhttpRequest !== 'function') return fetch(url).then(r => r.text()).then(res, rej);
      GM_xmlhttpRequest({ method: 'GET', url, timeout: 20000, onload: r => r.status >= 200 && r.status < 300 ? res(r.responseText) : rej(new Error('HTTP ' + r.status)), onerror: () => rej(new Error('no answer')), ontimeout: () => rej(new Error('too slow')) });
    });
  }
  function parseTenor(html) {
    const out = [], seen = new Set();
    const un = s => { try { return JSON.parse('"' + s + '"'); } catch (e) { return s; } };
    for (const p of html.split('{"id":"').slice(1)) {
      const id = /^(\d+)"/.exec(p); if (!id || seen.has(id[1])) continue;
      const cut = p.slice(0, 6000);
      const g = /"gif":\{[^{}]*?"url":"([^"]+)"/.exec(cut); if (!g) continue;
      const t = /"tinygif":\{[^{}]*?"url":"([^"]+)"/.exec(cut) || /"nanogif":\{[^{}]*?"url":"([^"]+)"/.exec(cut) || g;
      const url = un(g[1]), thumb = un(t[1]);
      if (!/^https:\/\//.test(url)) continue;
      seen.add(id[1]); out.push({ url, thumb });
    }
    return out;
  }
  let gifTimer = 0;
  function gifSearch(q) {
    clearTimeout(gifTimer);
    const grid = panel.querySelector('.mdm-gifgrid'); if (!grid) return;
    q = q.trim(); if (!q) { grid.innerHTML = '<div class="mdm-note">Type what you are looking for.</div>'; return; }
    gifTimer = setTimeout(async () => {
      grid.innerHTML = '<div class="mdm-note">Searching…</div>';
      try {
        const slug = encodeURIComponent(q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, ''));
        const items = parseTenor(await webGet('https://tenor.com/search/' + slug + '-gifs'));
        grid.innerHTML = items.length ? '' : '<div class="mdm-note">Nothing found.</div>';
        for (const it of items.slice(0, 40)) { const i = el('img'); i.src = it.thumb; i.loading = 'lazy'; i.dataset.url = it.url; i.title = 'Add this GIF'; grid.appendChild(i); }
      } catch (e) { grid.innerHTML = '<div class="mdm-note">The GIF search did not answer (' + esc(e.message) + ').</div>'; }
    }, 450);
  }

  // ---- the quiet nya for a new message (the AniList DMs sound) -----------------------
  const NYA = 'data:audio/mpeg;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAZGFzaABUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzbzZtcDQxAFRTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMQAAAAAAAAAAAAAA//vgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAqAACvgQALCxERFxcXHR0jIykpKS8vNTU1OztBQUdHR01NU1NZWVlfX2VlZWtrcXF3d3d9fYKCiIiIjo6UlJSamqCgpqamrKyysrK4uL6+xMTEysrQ0NbW1tzc4uLi6Oju7vT09Pr6//8AAAAATGF2YzYyLjI4AAAAAAAAAAAAAAAAJALAAAAAAAAAr4GA26yIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//vgZAAP8AAAaQAAAAgAAA0gAAABACQCAASAACAEgEAAkAAEEIiTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVAABmcqXGJDhgwIaNNHeR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';
  let nyaEl = null;
  function nya(test) {
    if (!opts.sound && !test) return Promise.resolve(true);
    try { nyaEl = nyaEl || new Audio(NYA); nyaEl.volume = Math.max(0, Math.min(1, +opts.volume || 0)); nyaEl.currentTime = 0; const p = nyaEl.play(); return p && p.then ? p.then(() => true, () => false) : Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
  }
  function ring(id) {                               // this tab found the message
    if (!opts.sound) return;
    nya().then(ok => { if (!ok) store.set('ring', { id, n: 0, done: 0 }); });
  }
  function ringHere() {                             // another tab could not play it (never clicked): one of the others does
    setTimeout(() => {
      const r = store.get('ring', null);
      if (!r || r.done || r.n > 5 || !opts.sound) return;
      r.done = 1; store.set('ring', r);
      nya().then(ok => { if (!ok) { r.done = 0; r.n++; store.set('ring', r); } });
    }, 50 + Math.random() * 600);
  }
  function openChatWith(who) {
    ui.open = true; store.set('open', true); ui.friend = who; ui.view = 'chat'; ui.shown = SHOW_LAST; ui.err = ''; store.set('at', who); render();
  }
  function notify(news) {                           // a Windows notification when MAL is not the page in front
    if (!opts.notify || typeof GM_notification !== 'function') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const m = news[news.length - 1], who = m.who;
    try {
      GM_notification({ title: news.length > 1 ? news.length + ' new MAL messages' : who + ' wrote on MAL', text: (news.length > 1 ? who + ': ' : '') + (m.prev || m.subj || 'New message'),
        image: avatars[lower(who)] || undefined, silent: true, timeout: 20000, onclick: () => { try { window.focus(); } catch (e) {} openChatWith(who); } });
    } catch (e) {}
  }

  // ---- the panel --------------------------------------------------------------
  const EMOJI = '😀 😂 🤣 😊 😍 🥰 😘 😎 🤔 😅 😭 😡 🥺 😴 🙄 😏 😳 🤯 🥳 😇 👍 👎 👏 🙏 💪 👀 ❤️ 💔 🔥 ✨ 🎉 💀 😺 🐺 🍎 ⭐ (≧▽≦) (╥﹏╥) (¬‿¬) ヽ(・∀・)ﾉ (づ｡◕‿‿◕｡)づ ಠ_ಠ'.split(' ');
  const css = `
  #mdm-fab { position: fixed; right: 18px; bottom: 18px; z-index: 99990; width: 46px; height: 46px; border-radius: 50%; border: 0; cursor: pointer; background: #2e51a2; color: #fff; box-shadow: 0 3px 12px rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; opacity: .85; transition: opacity .15s, transform .15s; }
  #mdm-fab:hover { opacity: 1; transform: scale(1.06); }
  #mdm-fab svg { width: 22px; height: 22px; fill: currentColor; }
  #mdm-fab b, .mdm-n { background: #e5484d; color: #fff; border-radius: 10px; font: 700 11px/16px Verdana, Arial, sans-serif; min-width: 16px; padding: 0 4px; text-align: center; box-sizing: border-box; }
  #mdm-fab b { position: absolute; right: -3px; top: -3px; }
  #mdm-fab b:empty { display: none; }
  #mdm-fab.mdm-flash { animation: mdmflash .5s 4; }
  @keyframes mdmflash { 50% { transform: scale(1.18); background: #e5484d; } }
  #mdm { position: fixed; right: 18px; bottom: 74px; z-index: 99991; width: 390px; height: min(600px, calc(100vh - 96px)); display: none; flex-direction: column; background: #1c1f26; color: #e6e8ee; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.55); font: 13px/1.45 Verdana, Arial, sans-serif; overflow: hidden; text-align: left; }
  #mdm.mdm-open { display: flex; }
  #mdm.mdm-big { width: min(720px, calc(100vw - 36px)); height: calc(100vh - 96px); }
  #mdm * { box-sizing: border-box; }
  #mdm a { color: #8fb0ff; text-decoration: none; } #mdm a:hover { text-decoration: underline; }
  .mdm-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 10px; background: #2e51a2; color: #fff; }
  .mdm-head .mdm-title { flex: 1; font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #mdm .mdm-head a { color: #fff; }
  .mdm-hb { border: 0; background: none; color: #fff; cursor: pointer; font-size: 15px; padding: 2px 7px; border-radius: 6px; opacity: .85; line-height: 1.2; }
  .mdm-hb:hover { background: rgba(255,255,255,.18); opacity: 1; }
  .mdm-err { flex: none; padding: 6px 12px; background: #5a2328; color: #ffd7d9; font-size: 12px; }
  .mdm-list, .mdm-msgs { flex: 1; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
  .mdm-row { display: flex; gap: 10px; align-items: center; padding: 9px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,.05); }
  .mdm-row:hover { background: rgba(255,255,255,.06); }
  .mdm-av { flex: none; width: 38px; height: 38px; border-radius: 50%; background: #39404d center / cover no-repeat; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #aab; }
  .mdm-rmid { flex: 1; min-width: 0; }
  .mdm-rname { font-weight: 700; display: flex; justify-content: space-between; gap: 8px; }
  .mdm-rname small { font-weight: 400; opacity: .55; flex: none; font-size: 11px; }
  .mdm-rprev { opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  .mdm-row.mdm-new .mdm-rprev { opacity: 1; font-weight: 700; }
  .mdm-row { position: relative; }
  .mdm-x { display: none; position: absolute; right: 6px; top: 4px; border: 0; background: #1c1f26; color: #e6e8ee; cursor: pointer; font-size: 11px; padding: 2px 6px; border-radius: 6px; opacity: .75; }
  .mdm-row:hover .mdm-x { display: block; } .mdm-x:hover { opacity: 1; background: #5a2328; }
  .mdm-head { cursor: move; user-select: none; touch-action: none; }
  #mdm.mdm-ew, #mdm.mdm-ew * { cursor: ew-resize !important; } #mdm.mdm-ns, #mdm.mdm-ns * { cursor: ns-resize !important; }
  #mdm.mdm-nwse, #mdm.mdm-nwse * { cursor: nwse-resize !important; } #mdm.mdm-nesw, #mdm.mdm-nesw * { cursor: nesw-resize !important; }
  #mdm.mdm-drag, #mdm.mdm-drag * { user-select: none !important; }
  .mdm-vol { width: 120px; }
  .mdm-note { padding: 14px; opacity: .6; text-align: center; font-size: 12px; }
  .mdm-add { flex: none; display: flex; gap: 6px; padding: 8px 10px; background: rgba(255,255,255,.04); }
  #mdm input[type=text], #mdm textarea { background: #12141a; color: #e6e8ee; border: 1px solid #343a47; border-radius: 8px; padding: 6px 9px; font: inherit; outline: none; width: 100%; }
  #mdm input[type=text]:focus, #mdm textarea:focus { border-color: #5b7fd6; }
  .mdm-btn { flex: none; border: 0; border-radius: 8px; background: #2e51a2; color: #fff; padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 700; }
  .mdm-btn:hover { background: #3a62c0; } .mdm-btn.mdm-soft { background: #343a47; font-weight: 400; }
  .mdm-msgs { padding: 10px 10px 4px; display: flex; flex-direction: column; gap: 5px; }
  .mdm-day { align-self: center; font-size: 11px; opacity: .55; margin: 6px 0 2px; }
  .mdm-older { align-self: center; }
  .mdm-msg { max-width: 84%; display: flex; flex-direction: column; align-self: flex-start; position: relative; }
  .mdm-msg.mdm-me { align-self: flex-end; align-items: flex-end; }
  .mdm-subj { font-size: 10.5px; opacity: .5; margin: 2px 6px 1px; }
  .mdm-body { background: #2a2f3a; border-radius: 14px 14px 14px 4px; padding: 7px 11px; overflow-wrap: anywhere; word-break: break-word; }
  .mdm-me .mdm-body { background: #2e51a2; border-radius: 14px 14px 4px 14px; }
  #mdm .mdm-me .mdm-body a { color: #d6e2ff; text-decoration: underline; }
  .mdm-body.mdm-wait { opacity: .7; } .mdm-body.mdm-pend { opacity: .6; border: 1px dashed rgba(255,255,255,.4); }
  .mdm-body img, .mdm-prev img { max-width: 100%; max-height: 300px; border-radius: 8px; cursor: zoom-in; vertical-align: middle; height: auto; }
  .mdm-body iframe { max-width: 100%; border: 0; border-radius: 8px; aspect-ratio: 16 / 9; height: auto; width: 100%; }
  .mdm-body blockquote, .mdm-prev blockquote, .mdm-body .quotetext { margin: 4px 0; padding: 4px 9px; border-left: 3px solid rgba(255,255,255,.35); background: rgba(0,0,0,.18); border-radius: 4px; font-size: 12px; }
  .mdm-body pre, .mdm-body .codetext { white-space: pre-wrap; background: rgba(0,0,0,.3); padding: 5px 8px; border-radius: 6px; }
  .mdm-body .spoiler_content { background: rgba(0,0,0,.2); border-radius: 6px; padding: 2px 6px; }
  .mdm-body input[type=button] { background: #12141a; color: #e6e8ee; border: 1px solid #555d6e; border-radius: 6px; padding: 2px 9px; cursor: pointer; font: inherit; font-size: 12px; }
  .mdm-sp summary { cursor: pointer; opacity: .8; font-size: 12px; }
  .mdm-yt { position: relative; display: inline-block; } .mdm-yt span { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); background: rgba(0,0,0,.65); color: #fff; border-radius: 10px; padding: 5px 14px; font-size: 18px; }
  .mdm-meta { font-size: 10px; opacity: .45; margin: 1px 6px 0; display: flex; gap: 8px; }
  .mdm-meta span { cursor: pointer; display: none; } .mdm-msg:hover .mdm-meta span { display: inline; } .mdm-meta span:hover { text-decoration: underline; }
  .mdm-compose { flex: none; padding: 6px 9px 9px; border-top: 1px solid rgba(255,255,255,.07); position: relative; }
  .mdm-tools { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 5px; }
  .mdm-tools button { border: 0; background: none; color: #c9cede; cursor: pointer; padding: 3px 7px; border-radius: 6px; font: 12px Verdana, Arial, sans-serif; }
  .mdm-tools button:hover, .mdm-tools button.mdm-on { background: rgba(255,255,255,.12); color: #fff; }
  .mdm-line { display: flex; gap: 6px; align-items: flex-end; }
  .mdm-text { resize: none; min-height: 36px; max-height: 150px; }
  .mdm-prev { max-height: 130px; overflow-y: auto; margin-bottom: 6px; padding: 6px 10px; border-radius: 10px; background: rgba(46,81,162,.35); font-size: 12.5px; overflow-wrap: anywhere; }
  .mdm-prev:empty { display: none; }
  .mdm-pop { position: absolute; left: 8px; right: 8px; bottom: 100%; background: #23272f; border: 1px solid #3a4150; border-radius: 10px; padding: 8px; box-shadow: 0 -6px 24px rgba(0,0,0,.45); max-height: 300px; display: flex; flex-direction: column; gap: 6px; }
  .mdm-gifgrid { overflow-y: auto; columns: 3; column-gap: 5px; min-height: 60px; }
  .mdm-gifgrid img { width: 100%; border-radius: 6px; margin-bottom: 5px; cursor: pointer; display: block; } .mdm-gifgrid img:hover { outline: 2px solid #8fb0ff; }
  .mdm-gifgrid .mdm-note { column-span: all; }
  .mdm-emo { display: flex; flex-wrap: wrap; gap: 2px; overflow-y: auto; } .mdm-emo span { cursor: pointer; padding: 3px 5px; border-radius: 6px; font-size: 16px; } .mdm-emo span:hover { background: rgba(255,255,255,.14); }
  .mdm-menu { flex: none; padding: 8px 12px; background: rgba(255,255,255,.04); display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
  .mdm-menu label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  #mdm-lb { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.85); display: flex; align-items: center; justify-content: center; cursor: zoom-out; }
  #mdm-lb img { max-width: 94vw; max-height: 92vh; border-radius: 6px; }
  @media (max-width: 520px) { #mdm, #mdm.mdm-big { right: 0; bottom: 0; width: 100vw; height: 100vh; height: 100dvh; border-radius: 0; } }
  `;
  document.head.appendChild(el('style', '', css));
  const fab = el('button'); fab.id = 'mdm-fab'; fab.title = 'MAL DMs';
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg><b></b>';
  const panel = el('div'); panel.id = 'mdm';
  document.body.append(fab, panel);

  const nearBottom = () => { const b = panel.querySelector('.mdm-msgs'); return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 80; };
  const toBottom = () => { const b = panel.querySelector('.mdm-msgs'); if (b) b.scrollTop = b.scrollHeight; };
  const title0 = document.title;
  function badge() {
    const n = unreadTotal(); fab.querySelector('b').textContent = n ? (n > 99 ? '99+' : n) : '';
    const t = (n ? '(' + n + ') ' : '') + title0; if (document.title !== t) document.title = t;
  }
  function flash() { fab.classList.remove('mdm-flash'); void fab.offsetWidth; fab.classList.add('mdm-flash'); }
  const pad = n => (n < 10 ? '0' : '') + n;
  const clock = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function dayName(t) {
    const d = new Date(t), n = new Date(), y = new Date(Date.now() - 864e5);
    if (d.toDateString() === n.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  }
  const shortWhen = t => !t ? '' : dayName(t) === 'Today' ? clock(t) : dayName(t);
  function avHtml(name, small) {
    const k = lower(name), u = avatars[k];
    if (u == null) avatar(name);
    const st = (small ? 'width:26px;height:26px;font-size:11px;' : '') + (u ? 'background-image:url(&quot;' + esc(u) + '&quot;)' : '');
    return '<div class="mdm-av" data-n="' + esc(k) + '" style="' + st + '">' + (u ? '' : esc(name.slice(0, 1).toUpperCase())) + '</div>';
  }

  function render() {
    badge();
    panel.classList.toggle('mdm-open', ui.open);
    if (!ui.open) return;
    if (ui.view === 'chat' && ui.friend) return renderChat();
    const fs = friends();
    let h = '<div class="mdm-head"><span class="mdm-title">MAL DMs</span><button class="mdm-hb" data-a="refresh" title="Check for new messages">&#8635;</button><button class="mdm-hb" data-a="menu" title="Options">&#8943;</button><button class="mdm-hb" data-a="close" title="Close">&#10005;</button></div>';
    if (ui.err) h += '<div class="mdm-err">' + esc(ui.err) + '</div>';
    if (ui.menu) h += '<div class="mdm-menu">'
      + '<label><input type="checkbox" data-o="enterSends"' + (opts.enterSends ? ' checked' : '') + '> Enter sends (Shift+Enter = new line)</label>'
      + '<label><input type="checkbox" data-o="pasteLinks"' + (opts.pasteLinks ? ' checked' : '') + '> Pasted picture / YouTube links become pictures / players</label>'
      + '<label><input type="checkbox" data-o="preview"' + (opts.preview ? ' checked' : '') + '> Live preview while typing</label>'
      + '<label><input type="checkbox" data-o="sound"' + (opts.sound ? ' checked' : '') + '> Nya sound for a new message</label>'
      + '<label><input type="checkbox" data-o="notify"' + (opts.notify ? ' checked' : '') + '> Windows notification when MAL is not in front</label>'
      + '<label>Volume <input type="range" class="mdm-vol" min="0" max="100" value="' + Math.round(opts.volume * 100) + '"> <button class="mdm-btn mdm-soft" data-a="nya">Play</button></label>'
      + (box ? '<a href="#" data-a="corner">Put the chat back in the corner</a>' : '')
      + '<a href="' + BASE + '">Open MAL\'s own message page</a></div>';
    h += '<div class="mdm-add"><input type="text" class="mdm-newname" placeholder="Message someone new: their MAL name"><button class="mdm-btn" data-a="new">Chat</button></div>';
    h += '<div class="mdm-list">';
    if (!fs.length) h += '<div class="mdm-note">' + (ui.busy ? 'Reading your messages…' : 'No messages yet.') + '</div>';
    for (const f of fs) {
      const l = f.last, pk = pending[lower(f.name)];
      h += '<div class="mdm-row' + (f.unread ? ' mdm-new' : '') + '" data-f="' + esc(f.name) + '">' + avHtml(f.name) + '<div class="mdm-rmid"><div class="mdm-rname"><span>' + esc(f.name) + '</span><small>' + esc(shortWhen(l.t)) + '</small></div>'
        + '<div class="mdm-rprev">' + (pk ? '<i>Waiting to send…</i>' : (l.mine ? 'You: ' : '') + esc(l.prev || (l.id ? baseSubj(l.subj) : 'New chat'))) + '</div></div>' + (f.unread ? '<span class="mdm-n">' + f.unread + '</span>' : '') + '<button class="mdm-x" data-a="hide" title="Take this chat off the list (nothing is deleted on MAL; it comes back with a new message)">&#10005;</button></div>';
    }
    if (ui.busy && fs.length) h += '<div class="mdm-note">Reading older messages…</div>';
    h += '</div>';
    panel.innerHTML = h;
  }

  function renderChat() {
    const f = ui.friend, k = lower(f), all = msgsOf(f), list = all.slice(-ui.shown);
    const keep = panel.querySelector('.mdm-text'), had = keep && panel.dataset.f === k, val = had ? keep.value : (drafts[k] || ''), sel = had ? [keep.selectionStart, keep.selectionEnd] : null, focus = had && document.activeElement === keep;
    const msgsBox = panel.querySelector('.mdm-msgs'), stick = !had || nearBottom(), oldTop = msgsBox ? msgsBox.scrollTop : 0;
    let h = '<div class="mdm-head"><button class="mdm-hb" data-a="back" title="All chats">&#8249;</button>' + avHtml(f, true) + '<span class="mdm-title"><a href="/profile/' + encodeURIComponent(f) + '" target="_blank">' + esc(f) + '</a></span>'
      + '<button class="mdm-hb" data-a="cmenu" title="Options">&#8943;</button><button class="mdm-hb" data-a="big" title="Bigger / smaller">&#10530;</button><button class="mdm-hb" data-a="close" title="Close">&#10005;</button></div>';
    if (ui.err) h += '<div class="mdm-err">' + esc(ui.err) + '</div>';
    if (ui.cmenu) h += '<div class="mdm-menu"><div>Subject line of your messages (MAL needs one). Empty = "re: " + the last subject.</div><input type="text" class="mdm-subjin" maxlength="100" placeholder="' + esc(subjectFor(f).text) + '" value="' + esc(subjects[k] || '') + '"><a href="' + esc(sendUrl(f)) + '" target="_blank">Write on MAL\'s own page instead</a></div>';
    h += '<div class="mdm-msgs">';
    const more = all.length > list.length, deep = !(db.deep.inboxDone && db.deep.sentDone);
    if (more) h += '<button class="mdm-btn mdm-soft mdm-older" data-a="older">Show older (' + (all.length - list.length) + ')</button>';
    else if (deep) h += '<button class="mdm-btn mdm-soft mdm-older" data-a="deeper">' + (ui.busy ? 'Looking…' : 'Look for older messages on MAL') + '</button>';
    let day = '', subj = null;
    for (const m of list) {
      const dn = m.t ? dayName(m.t) : '';
      if (dn && dn !== day) { day = dn; h += '<div class="mdm-day">' + esc(dn) + '</div>'; }
      const bs = baseSubj(m.subj), body = bodies[m.id];
      h += '<div class="mdm-msg' + (m.mine ? ' mdm-me' : '') + '" data-id="' + m.id + '">' + (subj !== null && bs && bs !== subj ? '<div class="mdm-subj">' + esc(bs) + '</div>' : '')
        + '<div class="mdm-body' + (body == null ? ' mdm-wait' : '') + '">' + (body != null ? body : esc(m.prev) + ' …') + '</div>'
        + '<div class="mdm-meta">' + (m.t ? (m.exact ? '' : '~') + clock(m.t) : '') + '<span data-a="quote">Reply</span><span data-a="copy">Copy</span></div></div>';
      subj = bs;
    }
    if (pending[k]) h += '<div class="mdm-msg mdm-me"><div class="mdm-body mdm-pend">' + bb2html(pending[k]) + '</div><div class="mdm-meta" style="opacity:.8">' + (ui.sending ? 'Sending…' : 'Sends in <b class="mdm-count"></b>&nbsp; <span data-a="unqueue" style="display:inline">Take back</span>') + '</div></div>';
    if (!list.length && !pending[k]) h += '<div class="mdm-note">Say hello to ' + esc(f) + '.</div>';
    h += '</div><div class="mdm-compose">';
    if (ui.gif) h += '<div class="mdm-pop"><input type="text" class="mdm-gifq" placeholder="Search GIFs (Tenor)"><div class="mdm-gifgrid"><div class="mdm-note">Type what you are looking for.</div></div></div>';
    if (ui.emoji) h += '<div class="mdm-pop"><div class="mdm-emo">' + EMOJI.map(e => '<span>' + e + '</span>').join('') + '</div></div>';
    h += '<div class="mdm-prev"></div><div class="mdm-tools">'
      + [['b', '<b>B</b>', 'Bold (Ctrl+B)'], ['i', '<i>I</i>', 'Italic (Ctrl+I)'], ['s', '<s>S</s>', 'Strike'], ['spoiler', 'Spoiler', 'Spoiler'], ['url', 'Link', 'Link'], ['img', 'Img', 'Picture link'], ['yt', 'YT', 'YouTube link'], ['center', 'Centre', 'Centred'], ['quote', 'Quote', 'Quote']]
        .map(t => '<button data-t="' + t[0] + '" title="' + t[2] + '">' + t[1] + '</button>').join('')
      + '<button data-a="gif" class="' + (ui.gif ? 'mdm-on' : '') + '" title="Search a GIF"><b>GIF</b></button><button data-a="emoji" class="' + (ui.emoji ? 'mdm-on' : '') + '" title="Emojis">&#128578;</button><button data-a="eye" class="' + (opts.preview ? 'mdm-on' : '') + '" title="Live preview on / off">&#128065;</button></div>'
      + '<div class="mdm-line"><textarea class="mdm-text" rows="1" placeholder="Message ' + esc(f) + '"></textarea><button class="mdm-btn mdm-send" data-a="send">Send</button></div></div>';
    panel.innerHTML = h; panel.dataset.f = k;
    const box = panel.querySelector('.mdm-text'); box.value = val; grow(box); preview();
    if (sel) box.setSelectionRange(sel[0], sel[1]);
    if (focus || !had) box.focus({ preventScroll: true });
    const nb = panel.querySelector('.mdm-msgs'); if (stick) nb.scrollTop = nb.scrollHeight; else nb.scrollTop = oldTop;
    panel.querySelectorAll('.mdm-body img').forEach(i => i.addEventListener('load', () => { if (stick && nearBottom()) toBottom(); }, { once: true }));
    list.slice().reverse().forEach(loadBody);
    tick();
    if (ui.gif) { const q = panel.querySelector('.mdm-gifq'); q.value = ui.gifq || ''; q.focus(); if (ui.gifq) gifSearch(ui.gifq); }
  }

  // ---- typing -------------------------------------------------------------------
  function grow(box) { box.style.height = 'auto'; box.style.height = Math.min(150, box.scrollHeight + 2) + 'px'; }
  function preview() {
    const p = panel.querySelector('.mdm-prev'), box = panel.querySelector('.mdm-text'); if (!p || !box) return;
    const v = box.value;
    p.innerHTML = opts.preview && v.trim() && /[\[\(~*]|https?:/.test(v) ? bb2html(v) : '';
  }
  function insert(box, before, after, keepSel) {
    const s = box.selectionStart, e = box.selectionEnd, v = box.value, mid = v.slice(s, e);
    box.value = v.slice(0, s) + before + mid + (after || '') + v.slice(e);
    const pos = keepSel === false ? s + before.length + mid.length + (after || '').length : s + before.length;
    box.focus(); box.setSelectionRange(pos, keepSel === false ? pos : pos + mid.length);
    onType(box);
  }
  function ownLine(box, code) { const v = box.value.slice(0, box.selectionStart); insert(box, (v && !/\n$/.test(v) ? '\n' : '') + code + '\n', '', false); }
  function onType(box) { grow(box); preview(); if (ui.friend) { drafts[lower(ui.friend)] = box.value; store.set('drafts', drafts); } }
  function tool(t, box) {
    const selTxt = box.value.slice(box.selectionStart, box.selectionEnd).trim();
    if (t === 'url') return /^https?:\/\//.test(selTxt) ? insert(box, '[url=', ']link[/url]') : insert(box, '[url=]', '[/url]');
    if (t === 'yt' && selTxt && ytId(selTxt)) { const s = box.selectionStart; box.setRangeText('[yt]' + ytId(selTxt) + '[/yt]', s, box.selectionEnd, 'end'); return onType(box); }
    insert(box, '[' + t + ']', '[/' + t + ']');
  }
  function linkCode(u) {
    if (ytId(u) && /youtu/.test(u)) return '[yt]' + ytId(u) + '[/yt]';
    if (IMG_RE.test(u) || /media\d*\.tenor\.com|i\.imgur\.com|i\.ibb\.co/.test(u)) return '[img]' + u + '[/img]';
    return '';
  }
  function doSend() {
    const box = panel.querySelector('.mdm-text'); if (!box || !ui.friend) return;
    const text = box.value.trim(); if (!text) return;
    box.value = ''; drafts[lower(ui.friend)] = ''; store.set('drafts', drafts);
    ui.gif = ui.emoji = false; ui.err = '';
    queue(ui.friend, text);
  }

  // ---- clicks and keys ------------------------------------------------------------
  fab.addEventListener('click', () => { ui.open = !ui.open; store.set('open', ui.open); render(); if (ui.open) sync(false); });
  panel.addEventListener('click', e => {
    const t = e.target;
    const img = t.closest('.mdm-body img, .mdm-prev img');
    if (img && !t.closest('a')) { const lb = el('div'); lb.id = 'mdm-lb'; lb.innerHTML = '<img src="' + esc(img.src) + '">'; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
    const gi = t.closest('.mdm-gifgrid img');
    if (gi) { ui.gif = false; const box = panel.querySelector('.mdm-text'); ownLine(box, '[img]' + gi.dataset.url + '[/img]'); renderChat(); return; }
    const em = t.closest('.mdm-emo span');
    if (em) { insert(panel.querySelector('.mdm-text'), em.textContent, '', false); return; }
    const tb = t.closest('[data-t]');
    if (tb) return tool(tb.dataset.t, panel.querySelector('.mdm-text'));
    const hideB = t.closest('[data-a="hide"]');
    if (hideB) { const r = hideB.closest('.mdm-row'), k = lower(r.dataset.f); const f = friends().find(x => lower(x.name) === k); hidden[k] = f ? f.last.id : 0; store.set('hidden', hidden); store.set('extra', store.get('extra', []).filter(n => lower(n) !== k)); return render(); }
    const row = t.closest('.mdm-row');
    if (row) { ui.friend = row.dataset.f; ui.view = 'chat'; ui.shown = SHOW_LAST; ui.err = ''; ui.cmenu = false; store.set('at', ui.friend); return render(); }
    const a = t.closest('[data-a]'); if (!a) return;
    const act = a.dataset.a, tbox = panel.querySelector('.mdm-text');
    if (act === 'close') { ui.open = false; store.set('open', false); }
    else if (act === 'back') { ui.view = 'list'; ui.friend = null; ui.gif = ui.emoji = false; ui.err = ''; store.set('at', ''); }
    else if (act === 'refresh') { sync(true, true); return; }
    else if (act === 'menu') ui.menu = !ui.menu;
    else if (act === 'cmenu') ui.cmenu = !ui.cmenu;
    else if (act === 'big') { if (box) { box = null; store.set('box', null); } else panel.classList.toggle('mdm-big'); place(); return; }
    else if (act === 'corner') { e.preventDefault(); box = null; store.set('box', null); panel.classList.remove('mdm-big'); place(); }
    else if (act === 'nya') { nya(true); return; }
    else if (act === 'older') { const b = panel.querySelector('.mdm-msgs'), h0 = b.scrollHeight; ui.shown += OLDER_STEP; renderChat(); const nb = panel.querySelector('.mdm-msgs'); nb.scrollTop = nb.scrollHeight - h0; return; }
    else if (act === 'deeper') { if (ui.busy) return; ui.busy = true; render(); deeper(3).catch(x => { ui.err = x.message; }).then(() => { ui.busy = false; ui.shown += OLDER_STEP; render(); }); return; }
    else if (act === 'new') { const n = (panel.querySelector('.mdm-newname').value || '').trim().replace(/^@/, ''); if (!/^[\w-]{2,16}$/.test(n)) { ui.err = 'That does not look like a MAL name.'; return render(); } const ex = store.get('extra', []); if (!ex.some(x => lower(x) === lower(n))) { ex.push(n); store.set('extra', ex); } delete hidden[lower(n)]; store.set('hidden', hidden); ui.friend = (friends().find(x => lower(x.name) === lower(n)) || { name: n }).name; ui.view = 'chat'; ui.shown = SHOW_LAST; ui.err = ''; store.set('at', ui.friend); }
    else if (act === 'send') return doSend();
    else if (act === 'gif') { ui.gif = !ui.gif; ui.emoji = false; }
    else if (act === 'emoji') { ui.emoji = !ui.emoji; ui.gif = false; }
    else if (act === 'eye') { opts.preview = !opts.preview; store.set('opts', opts); }
    else if (act === 'unqueue') { const k = lower(ui.friend); if (ui.sending) return; const txt = pending[k]; delete pending[k]; store.set('pending', pending); render(); const b2 = panel.querySelector('.mdm-text'); if (b2 && txt) { b2.value = b2.value ? txt + '\n\n' + b2.value : txt; onType(b2); } return; }
    else if (act === 'quote' || act === 'copy') {
      const mEl = a.closest('.mdm-msg'), m = db.msgs[mEl.dataset.id]; if (!m) return;
      const txt = (window.getSelection().toString().trim() || mEl.querySelector('.mdm-body').innerText.trim()).slice(0, 600);
      if (act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(txt); return; }
      ownLine(tbox, '[quote=' + (m.mine ? (me || 'me') : m.who) + ']' + txt + '[/quote]'); return;
    }
    render();
  });
  panel.addEventListener('change', e => {
    const o = e.target.dataset && e.target.dataset.o;
    if (o) { opts[o] = e.target.checked; store.set('opts', opts); }
    if (e.target.classList.contains('mdm-subjin') && ui.friend) { subjects[lower(ui.friend)] = e.target.value.trim(); store.set('subjects', subjects); }
  });
  panel.addEventListener('input', e => {
    if (e.target.classList.contains('mdm-text')) onType(e.target);
    if (e.target.classList.contains('mdm-gifq')) { ui.gifq = e.target.value; gifSearch(e.target.value); }
    if (e.target.classList.contains('mdm-vol')) { opts.volume = +e.target.value / 100; store.set('opts', opts); }
  });
  panel.addEventListener('keydown', e => {
    const t = e.target;
    if (t.classList.contains('mdm-newname') && e.key === 'Enter') { panel.querySelector('[data-a="new"]').click(); return; }
    if (e.key === 'Escape') { if (ui.gif || ui.emoji) { ui.gif = ui.emoji = false; render(); } e.stopPropagation(); return; }
    if (!t.classList.contains('mdm-text')) return;
    if (e.key === 'Enter' && (e.ctrlKey || (opts.enterSends && !e.shiftKey))) { e.preventDefault(); doSend(); }
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[bi]$/i.test(e.key)) { e.preventDefault(); tool(e.key.toLowerCase(), t); }
    e.stopPropagation();                              // MAL's own page shortcuts stay quiet while you type
  });
  panel.addEventListener('paste', e => {
    const t = e.target; if (!t.classList.contains('mdm-text') || !opts.pasteLinks) return;
    const txt = (e.clipboardData.getData('text') || '').trim();
    if (!/^https?:\/\/\S+$/.test(txt)) return;
    const code = linkCode(txt); if (!code) return;
    e.preventDefault(); ownLine(t, code);
  });

  // ---- move (drag the top bar) and resize (drag any edge or corner) ------------------
  let box = store.get('box', null);                  // { l, t, w, h } once moved or resized
  const EDGE = 7, MINW = 300, MINH = 320;
  const wide = () => window.innerWidth > 520;
  function place() {
    const st = panel.style;
    if (!box || !wide()) { st.left = st.top = st.width = st.height = st.right = st.bottom = ''; return; }
    box.w = Math.max(MINW, Math.min(box.w, window.innerWidth)); box.h = Math.max(MINH, Math.min(box.h, window.innerHeight));
    box.l = Math.max(0, Math.min(box.l, window.innerWidth - box.w)); box.t = Math.max(0, Math.min(box.t, window.innerHeight - box.h));
    st.left = box.l + 'px'; st.top = box.t + 'px'; st.width = box.w + 'px'; st.height = box.h + 'px'; st.right = 'auto'; st.bottom = 'auto';
  }
  function edgeAt(e) {
    const r = panel.getBoundingClientRect();
    const dl = e.clientX - r.left, dr = r.right - e.clientX, dt = e.clientY - r.top, db2 = r.bottom - e.clientY, C = 18;   // corners are easier to catch
    const nx = dl < EDGE || dr < EDGE, ny = dt < EDGE || db2 < EDGE;
    return { l: dl < EDGE || (ny && dl < C), r: dr < EDGE || (ny && dr < C), t: dt < EDGE || (nx && dt < C), b: db2 < EDGE || (nx && db2 < C) };
  }
  const CUR = ['mdm-ew', 'mdm-ns', 'mdm-nwse', 'mdm-nesw'];
  function cursorFor(g) {
    const c = (g.l && g.t) || (g.r && g.b) ? 'mdm-nwse' : (g.r && g.t) || (g.l && g.b) ? 'mdm-nesw' : g.l || g.r ? 'mdm-ew' : g.t || g.b ? 'mdm-ns' : '';
    CUR.forEach(x => panel.classList.toggle(x, x === c));
  }
  let grab = null;
  panel.addEventListener('pointermove', e => { if (!grab && wide()) cursorFor(edgeAt(e)); });
  panel.addEventListener('pointerleave', () => { if (!grab) cursorFor({}); });
  panel.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !wide()) return;
    const g = edgeAt(e), onEdge = g.l || g.r || g.t || g.b;
    const onBar = !onEdge && e.target.closest('.mdm-head') && !e.target.closest('button, a, input');
    if (!onEdge && !onBar) return;
    const r = panel.getBoundingClientRect();
    grab = { g, move: onBar, x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height, moved: false };
    e.preventDefault(); if (onEdge) e.stopPropagation();
  }, true);
  window.addEventListener('pointermove', e => {
    if (!grab) return;
    const dx = e.clientX - grab.x, dy = e.clientY - grab.y;
    if (!grab.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    grab.moved = true; panel.classList.add('mdm-drag'); panel.classList.remove('mdm-big');
    let { l, t, w, h } = grab; const g = grab.g;
    if (grab.move) { l += dx; t += dy; }
    else {
      if (g.r) w = Math.max(MINW, w + dx);
      if (g.b) h = Math.max(MINH, h + dy);
      if (g.l) { const nw = Math.max(MINW, w - dx); l += w - nw; w = nw; }
      if (g.t) { const nh = Math.max(MINH, h - dy); t += h - nh; h = nh; }
    }
    box = { l, t, w, h }; place();
  });
  window.addEventListener('pointerup', () => {
    if (!grab) return;
    if (grab.moved) store.set('box', box);
    grab = null; panel.classList.remove('mdm-drag'); cursorFor({});
  });
  window.addEventListener('resize', place);
  place();

  // ---- start --------------------------------------------------------------------
  ui.open = !!store.get('open', false);
  const at = store.get('at', ''); if (at) { ui.friend = at; ui.view = 'chat'; }
  const head = document.querySelector('.header-message-button');
  render();
  if (!me && !head) return;                           // not logged in: the button stays, nothing is asked
  sync(!db.first);
  const due = () => Date.now() - store.get('pollAt', 0) >= (ui.open ? POLL_OPEN : POLL_BG) - 3000;
  const beat = () => { if (navigator.onLine !== false && due()) sync(false); };
  setInterval(beat, 5000);
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 5000);'], { type: 'text/javascript' })));
    w.onmessage = beat; w.onerror = e => { try { e.preventDefault(); } catch (x) {} };
  } catch (e) {}
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { reload(); render(); beat(); } });
  window.addEventListener('online', beat);
  window.addEventListener('focus', beat);
})();
