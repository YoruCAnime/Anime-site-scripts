// ==UserScript==
// @name         Anime Capture
// @namespace    https://github.com/YoruCAnime/Anime-site-scripts
// @version      1.5.0
// @description  On anikototv.to video pages: ] screenshot (the best JPEG under 200 KB), = start recording, - stop, [ subtitles in captures on / off. Saved into your capture folder as "<date time> <anime> S1E2". The player fills the browser window when the video starts (Esc leaves, W toggles), and its controls fade 2 s after the mouse stops. Needs the small helper (helper.py) running on this PC.
// @author       YoruCAnime
// @homepageURL  https://github.com/YoruCAnime/Anime-site-scripts
// @match        *://anikototv.to/*
// @match        *://*.anikototv.to/*
// @match        *://megaplay.buzz/*
// @match        *://*.megaplay.buzz/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/anikototv/anime-capture.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/anikototv/anime-capture.user.js
// ==/UserScript==

/*
 * How it works
 * ------------
 * The anime plays inside the site's player frame (anikoto: megaplay.buzz), so
 * this script runs in the page AND in its frames. The page is the boss: a key
 * pressed anywhere goes to the page, which adds the anime name and episode
 * and tells every frame; the frame holding the playing video does the work.
 *  ]  copies the video's current frame at the video's own resolution (not the
 *     screen), and the helper saves it as the best JPEG under 200 KB.
 *  =  records the video element itself (picture + sound, MediaRecorder) and
 *     sends it to the helper every 2 s. It pauses while the video is paused
 *     or buffering, so the file has no frozen stretches.  -  stops.
 *  [  subtitles in captures on / off. Subtitles the player draws over the
 *     video (not burned in) aren't part of its picture, so with this on the
 *     script draws the ones on screen into the screenshot / recording.
 * A browser can't write into a folder of its choice, so helper.py (running
 * hidden on this PC) saves the files into the folder set in its settings.json.
 *
 * The keys only work on video pages of the sites below; everywhere else they
 * type as usual. Tampermonkey only loads the script on the sites in the
 * @match lines (anikoto and megaplay.buzz, the player all its servers use),
 * nowhere else. Adding a site: add a line to SITES, e.g. { host: 'example.com' },
 * and @match lines for the site and for the site its player comes from.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- settings
  // host:  the site (its subdomains count too).
  // video: which addresses are video pages - the keys only work there.
  //        Without it, a page counts once a long video has loaded on it.
  // name / ep: where the anime name and episode number are on the page.
  //        Without them: the page title, and "ep-5" / "episode-5" / "?ep=5" in the address.
  // fill:  the player box that fills the browser window when the video starts
  //        (a CSS selector; true = the player's frame; left out = never).
  // servers: the site's server buttons (item) and the box holding one group of
  //        them (group, e.g. SUB / DUB); the current one has class "active".
  //        When a server refuses the top quality the script clicks the next one.
  const SITES = [
    {
      host: 'anikototv.to',
      video: /^\/watch(?:2gether)?\/./,
      name: () => text('h1.title, h1[itemprop="name"]'),
      ep: () => (location.pathname.match(/\/ep-([\d.]+)/i) || [])[1] || attr('a[href*="/ep-"].active', 'data-num'),
      fill: '#player-wrapper',
      fillCss: '#player-wrapper #player{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}',
      servers: { item: '.servers li[data-link-id]', group: '.type' },
    },
  ];
  const FILL_WINDOW = true;    // the player fills the browser window when a video starts playing
  // JW players (anikoto's): pick the highest quality (1080p) as soon as the
  // player lists it, for every episode. A quality picked by hand afterwards is
  // kept until the next episode.
  const BEST_QUALITY = true;
  // If the server refuses part of the stream (JW error 233403 and the like),
  // the picture would stop for good with only the sound going on. Instead the
  // player reloads at the same moment: first as it was (fresh access), and if
  // that quality is refused again, with the next quality down for that episode.
  const RELOAD_ON_REFUSED = true;
  // JW players guess 0.5 Mbit/s before they have measured the line, so their
  // first pieces of video are low quality. This guess (bit/s) is fast. 0 = off.
  const START_BANDWIDTH = 50e6;
  const HIDE_CONTROLS_AFTER = 2000;   // ms without moving the mouse before the player's controls and the pointer fade (0 = never)
  const SUBS_DEFAULT = true;   // subtitles in captures until [ turns them off (remembered)
  const KEY_SHOT = ']', KEY_START = '=', KEY_STOP = '-', KEY_SUBS = '[', KEY_FILL = 'w';
  const HELPER = 'http://127.0.0.1:8767';
  const TAG = 'anime-capture';

  const IS_TOP = window.top === window.self;
  const siteFor = (host) => SITES.find((s) => host === s.host || host.endsWith('.' + s.host)) || null;
  const text = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const attr = (sel, a) => { const e = document.querySelector(sel); return e ? e.getAttribute(a) || '' : ''; };

  let SITE = null;
  if (IS_TOP) {
    SITE = siteFor(location.hostname);
    if (!SITE) return;
  } else {
    // A frame: carry on only inside a listed site's page (the page then tells
    // it whether this is a video page). Without ancestorOrigins, ask the page.
    let top = '';
    try { const ao = location.ancestorOrigins; if (ao && ao.length) top = new URL(ao[ao.length - 1]).hostname; } catch (e) { /* masked */ }
    if (top && !siteFor(top)) return;
  }

  // ------------------------------------------------------------ messages
  const post = (w, msg) => { try { w.postMessage(Object.assign({ tag: TAG }, msg), '*'); } catch (e) { /* gone */ } };
  function eachFrame(w, fn) {
    let n = 0;
    try { n = w.frames.length; } catch (e) { return; }
    for (let i = 0; i < n; i++) {
      let f = null;
      try { f = w.frames[i]; } catch (e) { continue; }
      if (!f) continue;
      fn(f);
      eachFrame(f, fn);
    }
  }
  const toFrames = (msg) => eachFrame(window, (f) => post(f, msg));
  const toTop = (msg) => { if (IS_TOP) onTopMsg(Object.assign({ tag: TAG }, msg), window); else post(window.top, msg); };

  // Frames learn from the page whether this is a video page, if W works and
  // whether subtitles go into captures (the page keeps that setting).
  let on = false, fillKey = false, subsOn = SUBS_DEFAULT;
  if (IS_TOP) { try { subsOn = !!GM_getValue('subs', SUBS_DEFAULT); } catch (e) { /* default */ } }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.tag !== TAG) return;
    if (IS_TOP) { if (e.source && e.source !== window) onTopMsg(d, e.source); return; }
    if (e.source !== window.top) return;            // orders only come from the page
    if (d.type === 'state') { on = !!d.on; fillKey = !!d.fill; subsOn = !!d.subs; }
    else if (d.type === 'serverReply') { const f = serverWait.get(d.id); if (f) { serverWait.delete(d.id); f(!!d.ok); } }
    else if (d.type === 'cmd') runCmd(d);
  });
  if (!IS_TOP) post(window.top, { type: 'ask' });

  // JW Player reads its saved speed guess ("jwplayer.bandwidthEstimate") from
  // the player's storage when it starts, so it is set here before it loads.
  if (!IS_TOP && START_BANDWIDTH > 0) {
    try { localStorage.setItem('jwplayer.bandwidthEstimate', String(START_BANDWIDTH)); } catch (e) { /* storage blocked */ }
  }

  // ---------------------------------------------------------------- keys
  // ] = - (and W, Esc) on video pages; typing in a text box and Ctrl / Alt
  // combinations (Ctrl+- zoom) are left alone. Registered at document-start,
  // so this runs before the page or the player can react to the keys.
  const ACTS = { [KEY_SHOT]: 'shot', [KEY_START]: 'start', [KEY_STOP]: 'stop', [KEY_SUBS]: 'subs' };
  function onKey(e) {
    if (!(IS_TOP ? pageOn() : on)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
    const k = e.key || '';
    if (k === 'Escape') { if (e.type === 'keydown') toTop({ type: 'esc' }); return; }
    const act = ACTS[k] || (k.toLowerCase() === KEY_FILL && (IS_TOP ? fillAllowed() : fillKey) ? 'fill' : null);
    if (!act) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type === 'keydown' && !e.repeat) toTop({ type: 'key', act, t: Date.now() });
  }
  for (const type of ['keydown', 'keypress', 'keyup']) window.addEventListener(type, onKey, true);

  // -------------------------------------------------------------- videos
  // The anime: the biggest loaded video at least 320 wide and a minute long
  // (skips previews and ads).
  const longVideo = (v) => v.videoWidth >= 320 && !(v.duration < 60);
  function mainVideo() {
    let best = null, bestArea = -1;
    for (const v of document.querySelectorAll('video')) {
      if (v.readyState < 2 || !longVideo(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.width * r.height > bestArea) { best = v; bestArea = r.width * r.height; }
    }
    return best;
  }
  document.addEventListener('loadedmetadata', (e) => {
    const v = e.target;
    if (v.tagName !== 'VIDEO' || !longVideo(v)) return;
    toTop({ type: 'video' });
    jwHooks();
  }, true);
  document.addEventListener('playing', (e) => {
    const v = e.target;
    if (v.tagName !== 'VIDEO' || !longVideo(v)) return;
    toTop({ type: 'playing' });
    jwHooks();
  }, true);

  // Controls fade: 2 s after the mouse last moved (playing or paused), the
  // player's controls and the pointer fade out; moving the mouse, a click or
  // a key brings them back (the capture keys don't). JW (anikoto's player),
  // Video.js, Plyr, ArtPlayer and the browser's own controls.
  const IDLE_CSS = ['.jw-controls', '.jw-controls-backdrop', '.jw-title', '.vjs-control-bar', '.vjs-big-play-button',
    '.plyr__controls', '.art-bottom'].map((s) => 'html.acap-idle ' + s).join(',') +
    '{opacity:0!important;transition:opacity .3s!important}' +
    'html.acap-idle video::-webkit-media-controls-panel{opacity:0!important;transition:opacity .3s!important}' +
    'html.acap-idle,html.acap-idle *{cursor:none!important}';
  let idleTimer = 0;
  function setIdle(idle) {
    const html = document.documentElement;
    if (!html) return;
    if (idle && !document.getElementById('acap-idle-css')) {
      const s = document.createElement('style');
      s.id = 'acap-idle-css';
      s.textContent = IDLE_CSS;
      (document.head || html).appendChild(s);
    }
    html.classList.toggle('acap-idle', idle);
  }
  function wake(e) {
    if (!HIDE_CONTROLS_AFTER) return;
    // Chrome sends still "mouse moves" when the page changes under the pointer.
    const still = e && e.type === 'mousemove' && !e.movementX && !e.movementY;
    const capKey = e && e.type === 'keydown' &&
      (ACTS[e.key] || (e.key || '').toLowerCase() === KEY_FILL || e.key === 'Escape');
    if (!still && !capKey) setIdle(false);
    clearTimeout(idleTimer);
    if ((IS_TOP ? pageOn() : on) && mainVideo()) idleTimer = setTimeout(() => setIdle(true), HIDE_CONTROLS_AFTER);
  }
  for (const type of ['mousemove', 'mousedown', 'wheel', 'touchstart', 'keydown']) {
    window.addEventListener(type, wake, { capture: true, passive: true });
  }
  document.addEventListener('playing', () => wake(null), true);

  // JW Player (anikoto's): the highest quality for every source it loads
  // (BEST_QUALITY), and a reload at the same moment when the server refuses
  // the stream (RELOAD_ON_REFUSED).
  const tuned = new WeakSet();
  function jwHooks() {
    let p = null;
    try { const jw = unsafeWindow.jwplayer; if (typeof jw === 'function') p = jw(); } catch (e) { return; }
    if (!p || typeof p.getQualityLevels !== 'function' || tuned.has(p)) return;
    tuned.add(p);
    if (RELOAD_ON_REFUSED) reloadWhenRefused(p);
    if (!BEST_QUALITY) return;
    let told = false;
    const pick = () => {
      try {
        const cap = qState().cap;                    // a quality the server refused for this episode
        const lv = p.getQualityLevels() || [];
        let best = -1, bh = 0;
        lv.forEach((l, i) => {
          const h = levelHeight(l);
          if (h > bh && (!cap || h < cap)) { bh = h; best = i; }
        });
        if (best >= 0 && p.getCurrentQuality() !== best) p.setCurrentQuality(best);
        if (cap && best >= 0 && !told) { told = true; toast(`Playing ${bh}p (the server refused ${cap}p)`); }
      } catch (e) { /* not ready */ }
    };
    pick();
    try { p.on('levels', pick); } catch (e) { /* old JW */ }
  }
  const levelHeight = (l) => (l && !/auto/i.test(l.label || '') && (+l.height || parseInt(l.label, 10))) || 0;

  // Per episode and server (this player page's address without ?time), for
  // this tab: the last reload after a refusal, and the quality cap once a
  // quality was refused twice.
  function playerAddress() {
    const u = new URL(location.href);
    u.searchParams.delete('time');
    u.searchParams.delete('autostart');
    return u.pathname + u.search;
  }
  const Q_KEY = 'acap-q:' + playerAddress();
  function qState() {
    try { return JSON.parse(sessionStorage.getItem(Q_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveQState(s) {
    try { sessionStorage.setItem(Q_KEY, JSON.stringify(s)); } catch (e) { /* blocked */ }
  }

  // JW error codes 23xxxx are the stream failing to load (ending in 403: the
  // server refused it). In this order, each at the moment the picture stopped:
  //  1. The site's next server (HD-2, Vidstream ...), still the top quality -
  //     the page clicks it and gives the new player the start time.
  //  2. No server left to try: reload this player (its page takes ?time=) -
  //     fresh access fixes an access that ran out.
  //  3. Refused again within 2 minutes: the next quality down (1080p -> 720p).
  //  4. Nothing lower left: say so.
  const serverWait = new Map();
  function askServerSwitch(pos, height, code) {
    if (IS_TOP) return Promise.resolve(switchServer({ pos, height, code }));
    return new Promise((res) => {
      const id = Math.random().toString(36).slice(2);
      serverWait.set(id, res);
      post(window.top, { type: 'switchServer', id, pos, height, code });
      setTimeout(() => { if (serverWait.delete(id)) res(false); }, 1500);
    });
  }
  let refusing = false;
  function reloadWhenRefused(p) {
    try {
      p.on('error', async (e) => {
        const code = +(e && e.code) || 0;
        if (code < 230000 || code >= 240000 || refusing) return;
        refusing = true;
        let pos = 0;
        try { pos = +p.getPosition() || 0; } catch (err) { /* gone */ }
        const v = mainVideo() || document.querySelector('video');
        if (!pos && v) pos = v.currentTime || 0;
        const s = qState(), now = Date.now();
        const reload = (msg) => {
          saveQState(s);
          const u = new URL(location.href);
          u.searchParams.set('time', String(Math.max(0, Math.floor(pos) - 1)));
          u.searchParams.set('autostart', 'true');
          toast(msg);
          setTimeout(() => location.replace(u.href), 700);
        };
        // The quality that failed: the one picked, else what was playing, else the top one allowed.
        let lv = [];
        try { lv = p.getQualityLevels() || []; } catch (err) { /* gone */ }
        let cur = 0;
        try { cur = levelHeight(lv[p.getCurrentQuality()]); } catch (err) { /* gone */ }
        if (!cur) { try { cur = +((p.getVisualQuality() || {}).level || {}).height || 0; } catch (err) { /* old JW */ } }
        const heights = lv.map(levelHeight).filter((h) => h && (!s.cap || h < s.cap)).sort((a, b) => b - a);
        if (!cur) cur = heights[0] || 0;
        if (!s.cap && await askServerSwitch(pos, cur, code)) return;     // the page is changing server
        if (!s.at || now - s.at > 120000) {
          s.at = now;
          reload(`Stream refused (${code}) - reloading at ${clock(Math.floor(pos))}`);
          return;
        }
        const lower = heights.filter((h) => h < cur);
        s.at = now;
        if (!lower.length) {
          saveQState(s);
          toast(`The server is refusing this episode (${code}).\nTry another server (HD-2 / Vidstream).`, 'error');
          return;
        }
        s.cap = cur;
        reload(`${cur}p refused by the server - switching to ${lower[0]}p at ${clock(Math.floor(pos))}`);
      });
    } catch (e) { /* old JW */ }
  }

  // ------------------------------------------------------------ the page
  let sawVideo = false, lastOn = null;
  const acks = new Set();
  function pageOn() { return SITE.video ? SITE.video.test(location.pathname) : sawVideo; }
  function fillAllowed() { return FILL_WINDOW && !!SITE.fill; }
  const stateMsg = () => ({ type: 'state', on: pageOn(), fill: fillAllowed(), subs: subsOn });

  // Tells the frames when the page becomes / stops being a video page (the
  // site changes episodes without reloading), and keeps window mode on its box.
  function syncState() {
    const o = pageOn();
    if (o !== lastOn) {
      lastOn = o;
      toFrames(stateMsg());
      if (!o) fill.leave(false);
    }
    fill.check();
  }

  function onTopMsg(d, src) {
    switch (d.type) {
      case 'ask': post(src, stateMsg()); break;
      case 'key': if (pageOn()) command(d.act, d.t); break;
      case 'esc': if (fill.on && !document.fullscreenElement) { fill.leave(true); toast('Window mode off (W = on)'); } break;
      case 'video':
        if (!sawVideo) { sawVideo = true; syncState(); }
        fill.left = false;           // a new video (server, episode): window mode comes back when it plays
        break;
      case 'playing':
        if (!sawVideo) { sawVideo = true; syncState(); }
        if (pageOn()) fill.auto(src);
        break;
      case 'ack': acks.add(d.nonce); break;
      case 'switchServer': post(src, { type: 'serverReply', id: d.id, ok: switchServer(d) }); break;
      default: break;
    }
  }

  // The player says the server refused the top quality: click the next server
  // in the same group (SUB / DUB) not tried for this episode in the last 10
  // minutes, and give the new player the same start time (?time= on its
  // address, which the site's player reads). False when there is none.
  let resume = null, resumeObs = null;
  function switchServer(d) {
    const sv = SITE.servers;
    if (!sv) return false;
    const all = [...document.querySelectorAll(sv.item)];
    const cur = all.find((li) => li.classList.contains('active'));
    if (!cur) return false;
    const grp = (li) => li.closest(sv.group) || li.parentElement;
    const id = (li) => li.getAttribute('data-link-id') || li.textContent.trim();
    const name = (li) => li.textContent.replace(/\s+/g, ' ').trim();
    const key = 'acap-tried:' + location.pathname;
    let tried = { at: 0, ids: [] };
    try { tried = JSON.parse(sessionStorage.getItem(key)) || tried; } catch (e) { /* none yet */ }
    if (Date.now() - tried.at > 600000) tried.ids = [];
    if (!tried.ids.includes(id(cur))) tried.ids.push(id(cur));
    const next = all.find((li) => grp(li) === grp(cur) && !tried.ids.includes(id(li)));
    if (!next) return false;
    tried.ids.push(id(next));
    tried.at = Date.now();
    try { sessionStorage.setItem(key, JSON.stringify(tried)); } catch (e) { /* blocked */ }
    const pos = Math.floor(+d.pos || 0);
    resume = { t: Math.max(0, pos - 1), until: Date.now() + 60000 };
    watchResume();
    toast(`${d.height ? d.height + 'p' : 'Stream'} refused on ${name(cur)} - switching to ${name(next)} at ${clock(pos)}`);
    next.click();
    return true;
  }
  function watchResume() {
    if (resumeObs) return;
    const fix = (f) => {
      if (!resume || !f || f.tagName !== 'IFRAME' || !f.src) return;
      if (Date.now() > resume.until) { resume = null; return; }
      try {
        const u = new URL(f.src, location.href);
        if (u.hostname === location.hostname || u.searchParams.has('time')) return;
        u.searchParams.set('time', String(resume.t));
        resume = null;
        f.src = u.href;
      } catch (e) { /* odd address */ }
    };
    resumeObs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') fix(m.target);
        for (const n of m.addedNodes || []) {
          if (n.tagName === 'IFRAME') fix(n);
          else if (n.querySelectorAll) n.querySelectorAll('iframe').forEach(fix);
        }
      }
      if (!resume || Date.now() > resume.until) { resume = null; resumeObs.disconnect(); resumeObs = null; }
    });
    resumeObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  }

  function animeName() {
    let n = '';
    try { n = SITE.name ? SITE.name() : ''; } catch (e) { /* page changed */ }
    if (!n) {
      const og = document.querySelector('meta[property="og:title"]');
      n = ((og && og.content) || document.title)
        .replace(/^\s*watch\s+/i, '')
        .replace(/\s+(?:episode|ep\.?)\s*\d+.*$/i, '')
        .replace(/\s+(?:in hd|online|for free|english sub(?:bed)?|eng sub|sub|dub)\b.*$/i, '')
        .replace(/\s+[|\u2013\u2014-]\s+[^|\u2013\u2014-]+$/, '')
        .trim();
    }
    return n || location.hostname;
  }
  function episode() {
    let e = '';
    try { e = SITE.ep ? SITE.ep() : ''; } catch (err) { /* page changed */ }
    if (!e) {
      const m = (location.pathname + location.search).match(/\bep(?:isode)?[-_=/ ]?(\d+(?:\.\d+)?)/i) ||
                document.title.match(/\bep(?:isode)?\.?\s*(\d+(?:\.\d+)?)/i);
      e = m ? m[1] : '';
    }
    return String(e || '');
  }

  // A player frame from a site the script isn't loaded on (a new server):
  // the keys can't reach its video, so say which site it is.
  function uncoveredPlayer() {
    let pats = [];
    try { pats = (GM_info.script.matches || []).map(String); } catch (e) { /* not Tampermonkey */ }
    if (!pats.length) pats = ['*://megaplay.buzz/*', '*://*.megaplay.buzz/*'];
    const covered = (host) => pats.some((m) => {
      const h = (m.match(/^[^:]+:\/\/([^/]+)/) || [])[1] || '';
      return h === host || (h.startsWith('*.') && (host === h.slice(2) || host.endsWith(h.slice(1))));
    });
    for (const f of document.querySelectorAll('iframe[src]')) {
      const r = f.getBoundingClientRect();
      if (r.width < 300 || r.height < 150) continue;
      let host = '';
      try { host = new URL(f.src, location.href).hostname; } catch (e) { continue; }
      if (host && host !== location.hostname && !covered(host)) return host;
    }
    return '';
  }

  function command(act, t) {
    if (act === 'fill') { fill.toggle(); return; }
    if (act === 'subs') {
      subsOn = !subsOn;
      try { GM_setValue('subs', subsOn); } catch (e) { /* this page only */ }
      toFrames(stateMsg());
      toast(subsOn ? 'Subtitles in captures: ON' : 'Subtitles in captures: OFF');
      return;
    }
    const nonce = Math.random().toString(36).slice(2);
    const d = { type: 'cmd', act, nonce, meta: { name: animeName(), ep: episode(), t, subs: subsOn } };
    toFrames(d);
    runCmd(d);
    setTimeout(() => {
      if (acks.delete(nonce)) return;
      if (act === 'stop') { toast('Not recording'); return; }
      const miss = uncoveredPlayer();
      if (miss) toast(`No video found: this server's player (${miss}) isn't in the script's sites.\nTry another server, or add a @match line for it.`, 'error');
      else toast('No video playing yet');
    }, 1500);
  }

  // Window mode: the player box covers the whole browser window (the tabs
  // and address bar stay), like the site's full screen but without leaving
  // the window. Comes on when the video starts; Esc leaves it (for this tab,
  // until W), W toggles. The player's own full-screen button still works.
  const fill = {
    on: false, left: false, el: null, src: null,
    css() {
      if (document.getElementById('acap-fill-css')) return;
      const s = document.createElement('style');
      s.id = 'acap-fill-css';
      s.textContent = 'html.acap-fill,html.acap-fill body{overflow:hidden!important}' +
        '[data-acap-fill]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
        'max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;' +
        'transform:none!important;z-index:2147483600!important;background:#000!important}' + (SITE.fillCss || '');
      (document.head || document.documentElement).appendChild(s);
    },
    target(src) {
      if (typeof SITE.fill === 'string') return document.querySelector(SITE.fill);
      if (!src || src === window) { const v = mainVideo(); return v && v.parentElement; }
      let w = src;
      try { while (w && w.parent !== window) w = w.parent; } catch (e) { return null; }
      return [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === w) || null;
    },
    enter(src) {
      const el = this.target(src);
      if (!el) return false;
      this.css();
      if (this.el && this.el !== el) this.el.removeAttribute('data-acap-fill');
      el.setAttribute('data-acap-fill', '');
      document.documentElement.classList.add('acap-fill');
      this.el = el; this.on = true; this.left = false;
      return true;
    },
    leave(byUser) {
      if (byUser) this.left = true;
      if (!this.on) return;
      if (this.el) this.el.removeAttribute('data-acap-fill');
      document.documentElement.classList.remove('acap-fill');
      this.on = false; this.el = null;
    },
    auto(src) {
      this.src = src;
      if (fillAllowed() && !this.on && !this.left) this.enter(src);
    },
    toggle() {
      if (!fillAllowed()) return;
      if (this.on) { this.leave(true); toast('Window mode off (W = on)'); }
      else if (!this.enter(this.src)) toast('No player on this page');
    },
    check() {          // the site may rebuild the player box (next episode)
      if (this.on && (!this.el || !this.el.isConnected)) { this.on = false; this.enter(this.src); }
    },
  };
  if (IS_TOP) setInterval(syncState, 1000);

  // ------------------------------------------------------------- notes
  // Notes show in whichever frame did the work (the player's frame stays
  // visible in window mode and full screen). 'ok' / 'info': small and faint
  // in the top-right corner, so they don't sit on the anime; 'error': big in
  // the middle, as something went wrong.
  function overlayHost() {
    const fs = document.fullscreenElement;
    return fs && fs.tagName !== 'VIDEO' && fs.tagName !== 'IFRAME' ? fs : document.documentElement;
  }
  const NOTE_STYLE = {
    ok: 'top:12px;right:14px;font:500 12px/1.3 system-ui,sans-serif;color:rgba(255,255,255,.85);' +
        'background:rgba(0,0,0,.35);padding:3px 8px;border-radius:5px;max-width:40vw',
    error: 'top:24px;left:50%;transform:translateX(-50%);font:600 15px/1.35 system-ui,sans-serif;color:#fff;' +
           'background:rgba(0,0,0,.8);padding:8px 14px;border-radius:8px;max-width:80vw;text-align:center',
  };
  const NOTE_TIME = { ok: 1300, info: 1800, error: 5000 };
  function toast(msg, kind = 'info') {
    let t = toast.el;
    if (!t) t = toast.el = document.createElement('div');
    t.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;white-space:pre-line;' +
      'transition:opacity .25s;opacity:1;' + (kind === 'error' ? NOTE_STYLE.error : NOTE_STYLE.ok);
    const host = overlayHost();
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = msg;
    const ms = NOTE_TIME[kind] || NOTE_TIME.info;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.style.opacity = '0'; }, ms);
  }

  function makeBadge() {
    const b = document.createElement('div');
    b.style.cssText = 'all:initial;position:fixed;top:14px;left:14px;z-index:2147483647;pointer-events:none;' +
      'font:700 14px/1 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px';
    const dot = document.createElement('span');
    dot.style.cssText = 'all:initial;font:inherit;color:#ff3b30';
    const label = document.createElement('span');
    label.style.cssText = 'all:initial;font:inherit;color:#fff';
    b.append(dot, label);
    const place = () => { const h = overlayHost(); if (b.parentNode !== h) h.appendChild(b); };
    document.addEventListener('fullscreenchange', place);
    place();
    return {
      set(paused, time) {
        place();
        dot.textContent = paused ? '\u275a\u275a ' : '\u25cf ';
        dot.style.color = paused ? '#bbb' : '#ff3b30';
        label.textContent = 'REC ' + time;
      },
      remove() { document.removeEventListener('fullscreenchange', place); b.remove(); },
    };
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // -------------------------------------------------------------- helper
  // helper.py on this PC saves the files. Calls go through GM_xmlhttpRequest;
  // the helper only gives its key to this script, never to a web page.
  const Helper = {
    key: null,
    call(method, path, body, json) {
      return new Promise((resolve) => {
        try {
          GM_xmlhttpRequest({
            method, url: HELPER + path, timeout: 30000,
            headers: Object.assign({ 'Content-Type': json ? 'application/json' : 'application/octet-stream' },
              this.key ? { 'X-ACap-Key': this.key } : {}),
            data: body === undefined ? undefined : json ? JSON.stringify(body) : body,
            onload: (r) => {
              try { resolve(Object.assign({ status: r.status }, JSON.parse(r.responseText))); }
              catch (e) { resolve({ status: r.status, error: 'odd reply from the helper' }); }
            },
            onerror: () => resolve({ status: 0, error: 'the capture helper is not running' }),
            ontimeout: () => resolve({ status: 0, error: 'the capture helper is not answering' }),
          });
        } catch (e) { resolve({ status: 0, error: 'Tampermonkey refused the call' }); }
      });
    },
    async ready() {
      if (this.key) return true;
      const r = await this.call('GET', '/key');
      if (r.key) this.key = r.key;
      return !!this.key;
    },
    async post(path, body, json) {
      if (!(await this.ready())) return { status: 0, error: 'the capture helper is not running' };
      return this.call('POST', path, body, json);
    },
  };

  // ----------------------------------------------------------- subtitles
  // Subtitles the player draws over the video (anikoto's JW Player does) are
  // not in the video's picture. With subtitles ON the ones on screen are drawn
  // into the capture: same text, place, size and colours as the player shows,
  // scaled from the screen to the video's resolution. Sources, in order: the
  // player's subtitle boxes (JW, Video.js, Plyr, ArtPlayer, Shaka; else any
  // "caption" / "subtitle" box over the video), the browser's own subtitles
  // (text tracks), and subtitle canvases (libass / JASSUB, styled .ass subs).
  const CUE_SEL = '.jw-text-track-cue, .jw-captions-text, .vjs-text-track-cue, .plyr__caption, .art-subtitle-line, ' +
    '.shaka-text-container span';
  const CUE_GUESS = '[class*="caption" i], [class*="subtitle" i]';
  const NOT_CUE = 'button, [role="button"], [role^="menu"], [class*="setting" i], [class*="menu" i], .jw-controlbar, .jw-tooltip';
  const SUB_CANVAS = /libass|jassub|octopus|subtitle/i;

  // Where the picture sits on screen inside the <video> box (letterboxing).
  function videoBox(v) {
    const r = v.getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight;
    const fit = getComputedStyle(v).objectFit;
    if (fit === 'fill') return { x: r.left, y: r.top, sx: r.width / vw, sy: r.height / vh };
    const s = fit === 'cover' ? Math.max(r.width / vw, r.height / vh) : Math.min(r.width / vw, r.height / vh);
    return { x: r.left + (r.width - vw * s) / 2, y: r.top + (r.height - vh * s) / 2, sx: s, sy: s };
  }
  const shown = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
                                            : !!el.getClientRects().length);
  const alphaOf = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return c && c !== 'transparent' ? 1 : 0;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };

  function cueItems(v, box) {
    const vr = v.getBoundingClientRect();
    const over = (el) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return r.width > 0 && cx >= vr.left && cx <= vr.right && cy >= vr.top && cy <= vr.bottom;
    };
    const usable = (els) => els.filter((e) => shown(e) && (e.innerText || '').trim() && over(e));
    let els = usable([...document.querySelectorAll(CUE_SEL)]);
    if (!els.length) els = usable([...document.querySelectorAll(CUE_GUESS)].filter((e) => !e.closest(NOT_CUE)));
    els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));      // innermost boxes only
    return els.map((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return {
        text: el.innerText.replace(/ /g, ' ').trim(),
        x: (r.left + r.width / 2 - box.x) / box.sx, bottom: (r.bottom - box.y) / box.sy, maxW: r.width / box.sx,
        px: parseFloat(cs.fontSize) / box.sy, family: cs.fontFamily, weight: cs.fontWeight, style: cs.fontStyle,
        color: cs.color, bg: cs.backgroundColor,
        edge: cs.textShadow !== 'none' || parseFloat(cs.webkitTextStrokeWidth) > 0,
      };
    });
  }

  // The browser's own subtitles: white on a dark box, bottom centre, like Chrome draws them.
  function trackItems(v) {
    const items = [], W = v.videoWidth, H = v.videoHeight, px = H * 0.05;
    let bottom = H * 0.95;
    for (const t of v.textTracks || []) {
      if (t.mode !== 'showing' || !t.activeCues) continue;
      for (const cue of [...t.activeCues].reverse()) {
        let text = '';
        try { text = cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text; } catch (e) { text = cue.text || ''; }
        text = String(text || '').replace(/<[^>]+>/g, '').trim();
        if (!text) continue;
        items.push({ text, x: W / 2, bottom, maxW: W * 0.9, px, family: 'sans-serif', weight: '400', style: 'normal',
                     color: '#fff', bg: 'rgba(0,0,0,0.8)', edge: false });
        bottom -= px * 1.25 * (text.split('\n').length + 0.3);
      }
    }
    return items;
  }

  function wrapText(g, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + w : w;
        if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      }
      if (line) out.push(line);
    }
    return out;
  }

  function drawCue(g, it) {
    const px = Math.max(8, it.px), lh = px * 1.25;
    g.font = `${it.style} ${it.weight} ${px}px ${it.family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = wrapText(g, it.text, it.maxW * 1.06 + px);
    const top = it.bottom - lh * lines.length;
    const box = alphaOf(it.bg) > 0.05;
    if (box) {
      g.fillStyle = it.bg;
      lines.forEach((ln, i) => {
        const w = g.measureText(ln).width;
        g.fillRect(it.x - w / 2 - px * 0.3, top + lh * i, w + px * 0.6, lh);
      });
    }
    lines.forEach((ln, i) => {
      const y = top + lh * (i + 0.5);
      if (it.edge || !box) {               // outline, so it reads on any picture
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2, px * 0.16);
        g.strokeStyle = 'rgba(0,0,0,.9)';
        g.strokeText(ln, it.x, y);
      }
      g.fillStyle = it.color;
      g.fillText(ln, it.x, y);
    });
  }

  // The subtitles on screen right now, in the video's pixels.
  function subsNow(v, withCanvases = true) {
    const box = videoBox(v);
    let items = cueItems(v, box);
    if (!items.length) items = trackItems(v);
    const canvases = [];
    if (withCanvases) {
      for (const c of document.querySelectorAll('canvas')) {
        const tag = `${c.className} ${c.id} ${c.parentElement ? c.parentElement.className : ''}`;
        if (!c.width || !SUB_CANVAS.test(tag) || !shown(c)) continue;
        const r = c.getBoundingClientRect();
        canvases.push({ c, x: (r.left - box.x) / box.sx, y: (r.top - box.y) / box.sy, w: r.width / box.sx, h: r.height / box.sy });
      }
    }
    return { items, canvases, n: items.length + canvases.length };
  }
  function paintSubs(g, s) {
    g.save();
    s.items.forEach((it) => drawCue(g, it));
    for (const k of s.canvases) { try { g.drawImage(k.c, k.x, k.y, k.w, k.h); } catch (e) { /* not drawable */ } }
    g.restore();
    return s.n;
  }
  // Draws the subtitles on screen onto g (a canvas the size of the video's
  // picture). Returns how many were drawn.
  const drawSubs = (g, v, withCanvases = true) => paintSubs(g, subsNow(v, withCanvases));

  // ------------------------------------------------------------ captures
  function runCmd(d) {
    if (d.act === 'stop') {
      if (rec) { toTop({ type: 'ack', nonce: d.nonce }); rec.stop(); }
      return;
    }
    const v = mainVideo();
    if (!v) return;
    toTop({ type: 'ack', nonce: d.nonce });
    if (d.act === 'shot') shoot(v, d.meta);
    else if (d.act === 'start') startRec(v, d.meta);
  }

  // ] : the frame on screen right now, at the video's full resolution (plus
  // the subtitles on screen, if on), sent losslessly (PNG); the helper makes
  // the best JPEG under 200 KB from it.
  async function shoot(v, meta) {
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d');
    try {
      g.drawImage(v, 0, 0, c.width, c.height);
      g.getImageData(0, 0, 1, 1);
    } catch (e) {
      toast("Screenshot not saved: this player won't let the page copy its picture", 'error');
      return;
    }
    let subs = 0;
    if (meta.subs) {
      subs = drawSubs(g, v);
      try { g.getImageData(0, 0, 1, 1); } catch (e) {        // a subtitle canvas that can't be copied
        g.drawImage(v, 0, 0, c.width, c.height);
        subs = drawSubs(g, v, false);
      }
    }
    const png = await new Promise((res) => { try { c.toBlob(res, 'image/png'); } catch (e) { res(null); } });
    if (!png) { toast('Screenshot not saved: could not copy the picture', 'error'); return; }
    const r = await Helper.post(`/shot?name=${encodeURIComponent(meta.name)}&ep=${encodeURIComponent(meta.ep)}&t=${meta.t}`, png);
    // The player picks the quality (Auto), so say so when a shot is below full HD.
    const size = r.w < 1900 ? `${r.h}p` : '';
    const extra = [size, subs ? 'subtitles' : ''].filter(Boolean).join(', ');
    if (r.ok) toast(`\u2713 Screenshot saved${extra ? ` (${extra})` : ''}`, 'ok');
    else toast(`Screenshot not saved: ${r.error || 'no answer'}`, 'error');
  }

  // The recording's picture: frames come straight from the video (so it keeps
  // going in a background tab or a minimised window) and each is redrawn at
  // the video's size, with the subtitles on screen on top while they are on
  // ([ works mid-recording too). Every frame takes the same route on purpose:
  // the browser stores redrawn and untouched frames in different colour
  // formats, so mixing them would shift the colours whenever a subtitle came
  // or went. The size stays fixed even if the stream changes quality. ref()
  // gives a small copy of a frame exactly as it went to the recorder (the
  // helper checks the file's colours against it). Null where the browser can't
  // do this (then the plain picture, without subtitles).
  function recordPicture(v, src) {
    if (!window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator || !window.VideoFrame) return null;
    let proc, gen;
    try {
      proc = new MediaStreamTrackProcessor({ track: src });
      gen = new MediaStreamTrackGenerator({ kind: 'video' });
    } catch (e) { return null; }
    const W = v.videoWidth, H = v.videoHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { alpha: false });
    const reader = proc.readable.getReader(), writer = gen.writable.getWriter();
    let stopped = false, wantRef = null;
    (async () => {
      while (!stopped) {
        let f;
        try {
          const r = await reader.read();
          if (r.done) break;
          f = r.value;
        } catch (e) { break; }
        let out = null;
        try {
          g.drawImage(f, 0, 0, W, H);
          if (subsOn) drawSubs(g, v);
          out = new VideoFrame(c, { timestamp: f.timestamp });
          if (wantRef) {
            const give = wantRef;
            wantRef = null;
            const k = document.createElement('canvas');
            k.width = 320;
            k.height = Math.max(2, Math.round(320 * H / W));
            k.getContext('2d').drawImage(c, 0, 0, k.width, k.height);
            k.toBlob(give, 'image/png');
          }
          await writer.write(out);           // hands the frame over (closes it)
        } catch (e) {
          if (out) { try { out.close(); } catch (e2) { /* closed */ } }
        } finally {
          try { f.close(); } catch (e3) { /* closed */ }
        }
      }
    })();
    return {
      track: gen,
      ref() {
        return new Promise((res) => {
          wantRef = res;
          setTimeout(() => { if (wantRef === res) { wantRef = null; res(null); } }, 4000);
        });
      },
      stop() {
        stopped = true;
        reader.cancel().catch(() => { /* done */ });
        try { src.stop(); } catch (e) { /* done */ }
        try { gen.stop(); } catch (e) { /* done */ }
      },
    };
  }

  // = / - : the video's picture (with subtitles if on) and its own sound.
  // H.264 MP4 where the browser can (Chrome / Brave 126+), else WebM; the
  // helper tidies the file.
  let rec = null;
  const MIMES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus',
    'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

  function startRec(v, meta) {
    if (rec) { toast('Already recording (- stops)'); return; }
    if (!window.MediaRecorder) { toast('Recording not started: this browser has no recorder', 'error'); return; }
    let src;
    try { src = (v.captureStream || v.mozCaptureStream).call(v); }
    catch (e) { toast("Recording not started: this player won't let the page record it", 'error'); return; }
    if (!src.getVideoTracks().length) {
      src.getTracks().forEach((t) => t.stop());
      toast('Recording not started: no picture yet - press play first', 'error');
      return;
    }
    const pic = recordPicture(v, src.getVideoTracks()[0]);
    const stream = pic ? new MediaStream([pic.track, ...src.getAudioTracks()]) : src;
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const h = v.videoHeight;
    const vbps = h > 1080 ? 24e6 : h > 720 ? 14e6 : h > 480 ? 8e6 : 5e6;
    let mr;
    try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: 192000 }); }
    catch (e) {
      if (pic) pic.stop();
      src.getTracks().forEach((t) => t.stop());
      toast('Recording not started: ' + e.message, 'error');
      return;
    }
    rec = new Recording(v, stream, mr, meta, pic);
  }

  const VIDEO_EVENTS = ['pause', 'waiting', 'seeking', 'seeked', 'playing', 'emptied', 'ended'];

  class Recording {
    constructor(v, stream, mr, meta, pic) {
      this.v = v; this.stream = stream; this.mr = mr; this.pic = pic;
      this.id = null; this.seq = 0; this.queue = []; this.busy = false;
      this.stopping = false; this.stopped = false; this.finished = false; this.lost = false;
      this.ms = 0; this.since = 0; this.secs = 0;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) { this.queue.push({ seq: this.seq++, blob: e.data }); this.pump(); } };
      mr.onstop = () => { this.stopped = true; this.release(); this.pump(); };
      mr.onerror = (e) => { toast('Recording stopped: ' + ((e.error && e.error.message) || 'recorder error'), 'error'); this.stop(); };
      this.onVideo = (e) => this.follow(e.type);
      for (const t of VIDEO_EVENTS) v.addEventListener(t, this.onVideo);
      stream.getVideoTracks()[0].addEventListener('ended', () => this.stop());
      this.onHide = () => this.stop();
      window.addEventListener('pagehide', this.onHide);
      mr.start(2000);
      this.ref = pic ? pic.ref() : Promise.resolve(null);
      if (v.paused || v.readyState < 3) this.pauseRec(); else this.since = Date.now();
      this.badge = makeBadge();
      this.tick();
      this.timer = setInterval(() => this.tick(), 500);
      this.heart = setInterval(() => { if (this.id) Helper.post('/rec/alive', { id: this.id }, true); }, 15000);
      toast(`● Recording${subsOn && pic ? ' (subtitles)' : ''} - press - to stop`);
      this.open(meta);
    }

    release() {
      if (this.pic) this.pic.stop();
      this.stream.getTracks().forEach((t) => t.stop());
    }

    async open(meta) {
      const r = await Helper.post('/rec/start', { name: meta.name, ep: meta.ep, t: meta.t, mime: this.mr.mimeType }, true);
      if (!r.id) {
        this.lost = true;
        toast('Recording not started: ' + (r.error || 'no answer'), 'error');
        this.stop();
        return;
      }
      this.id = r.id;
      this.pump();
      const ref = await this.ref;
      if (ref) Helper.post(`/rec/ref?id=${this.id}`, ref);
    }

    // Recording pauses while the video is paused, buffering or seeking.
    follow(type) {
      if (this.stopping) return;
      if (type === 'emptied' || type === 'ended') { this.stop(); return; }
      const v = this.v;
      if (type === 'playing' || (type === 'seeked' && !v.paused && v.readyState >= 3)) this.resumeRec();
      else if (type === 'pause' || type === 'waiting' || type === 'seeking') this.pauseRec();
    }
    pauseRec() {
      if (this.mr.state === 'recording') { try { this.mr.pause(); } catch (e) { /* stopping */ } }
      if (this.since) { this.ms += Date.now() - this.since; this.since = 0; }
    }
    resumeRec() {
      if (this.mr.state === 'paused') { try { this.mr.resume(); } catch (e) { /* stopping */ } }
      if (!this.since) this.since = Date.now();
    }
    tick() {
      this.secs = Math.floor((this.ms + (this.since ? Date.now() - this.since : 0)) / 1000);
      if (this.badge) this.badge.set(this.mr.state === 'paused', clock(this.secs));
    }

    stop() {
      if (this.stopping) return;
      this.stopping = true;
      this.tick();
      for (const t of VIDEO_EVENTS) this.v.removeEventListener(t, this.onVideo);
      window.removeEventListener('pagehide', this.onHide);
      clearInterval(this.timer);
      clearInterval(this.heart);
      if (this.badge) { this.badge.remove(); this.badge = null; }
      if (rec === this) rec = null;
      try {
        if (this.mr.state !== 'inactive') { this.mr.stop(); return; }
      } catch (e) { /* already stopped */ }
      this.stopped = true;
      this.release();
      this.pump();
    }

    // Pieces go to the helper one at a time, in order (they wait until the
    // helper has opened the file); after the last one the helper finishes it.
    async pump() {
      if (this.busy || !this.id || this.lost) return;
      this.busy = true;
      while (this.queue.length) {
        const { seq, blob } = this.queue[0];
        let r = null;
        for (let i = 0; i < 4; i++) {
          r = await Helper.post(`/rec/chunk?id=${this.id}&seq=${seq}`, blob);
          if (r.ok || r.status === 404 || r.status === 409) break;
          await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
        }
        if (!r.ok) {
          this.lost = true;
          this.queue.length = 0;
          toast('Recording stopped: ' + (r.error || 'the helper stopped answering') +
                '\n(what was recorded so far is saved)', 'error');
          this.stop();
          break;
        }
        this.queue.shift();
      }
      this.busy = false;
      if (this.stopped && !this.queue.length && !this.finished && !this.lost) {
        this.finished = true;
        const r = await Helper.post('/rec/stop', { id: this.id, chunks: this.seq }, true);
        if (r.ok) toast(`✓ Recording saved (${clock(this.secs)})`, 'ok');
        else toast('Recording not saved: ' + (r.error || 'no answer'), 'error');
      }
    }
  }
})();
