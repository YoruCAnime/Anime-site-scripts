// ==UserScript==
// @name         Atsu Comfy Reader
// @namespace    https://github.com/YoruCAnime/Anime-site-scripts
// @version      2.0.1
// @description  Smooth arrow-key scrolling in atsu.moe's vertical (scroll) mode: tap Up / Down for a small smooth step, hold to glide at an even speed (stops the moment you let go), Shift = faster. Every other key is left as it is.
// @author       YoruCAnime
// @homepageURL  https://github.com/YoruCAnime/Anime-site-scripts
// @match        https://atsu.moe/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-comfy-reader.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/atsumoe/atsu-comfy-reader.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- feel (change these numbers to taste) ----------
  const TAP = 0.20;         // one tap moves this much of the screen
  const GLIDE = 0.70;       // holding moves this many screens per second
  const FAST = 2.5;         // Shift makes taps and gliding this much faster
  const HOLD_DELAY = 170;   // ms a key must be held before gliding starts (a tap is shorter)
  const TAP_TAU = 0.075;    // s, how quickly a tap settles
  const RAMP_UP = 0.14;     // s, glide speeding up
  const RAMP_DOWN = 0.055;  // s, glide stopping after the key is let go

  const root = () => document.scrollingElement || document.documentElement;
  // vertical reader only: the pictures sit in .wrapper and the page itself scrolls
  const stripMode = () => location.pathname.startsWith('/read/') && !!document.querySelector('.wrapper img')
    && root().scrollHeight > innerHeight + 20;
  const maxTop = () => root().scrollHeight - innerHeight;

  // never take the arrows from text boxes, sliders, open dropdown lists or MAL-Sync's own boxes
  function leaveAlone(t) {
    if (!t || !t.closest) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    if (t.tagName === 'INPUT') return !/^(button|submit|reset|checkbox|radio)$/i.test(t.type);
    return !!t.closest('[role="textbox"],[role="listbox"],[role="menu"],[role="option"],[role="menuitem"],#malp,#MalData,[id^="flash"],.mal-sync');
  }

  // ---------- motion ----------
  let pos = null;       // our own (fractional) scroll position
  let lastSet = -1;     // what the page reported after our last write
  let pending = 0;      // distance still to travel from taps
  let vel = 0;          // gliding speed now, px/s
  let hold = null;      // {dir, key, fast, t0} while Up / Down is held
  let raf = 0, lastT = 0;

  function run() {
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const el = root();
    const cur = el.scrollTop;
    // the mouse wheel, scrollbar or the site moved the page: carry on from there
    if (pos === null || Math.abs(cur - lastSet) > 2) pos = cur;

    const step = pending * (1 - Math.exp(-dt / TAP_TAU));
    pending -= step;

    let want = 0;
    if (hold && t - hold.t0 >= HOLD_DELAY) want = hold.dir * GLIDE * innerHeight * (hold.fast ? FAST : 1);
    vel += (want - vel) * (1 - Math.exp(-dt / (want ? RAMP_UP : RAMP_DOWN)));
    if (!want && Math.abs(vel) < 30) vel = 0;

    pos += step + vel * dt;
    const max = maxTop();
    if (pos <= 0) { pos = 0; if (pending < 0) pending = 0; if (vel < 0) vel = 0; }
    if (pos >= max) { pos = max; if (pending > 0) pending = 0; if (vel > 0) vel = 0; }
    window.scrollTo({ top: pos, behavior: 'instant' });
    lastSet = el.scrollTop;

    if (!hold && vel === 0 && Math.abs(pending) < 0.5) {
      pending = 0; raf = 0; pos = null;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  // ---------- keys: only Up / Down (and Shift while holding) ----------
  function onKeyDown(e) {
    if (e.key === 'Shift') { if (hold) hold.fast = true; return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (leaveAlone(e.target) || !stripMode()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;                                    // holding is handled by the glide
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    hold = { dir, key: e.key, fast: e.shiftKey, t0: performance.now() };
    if (Math.sign(pending) !== dir) pending = 0;            // turning round: drop the old tap
    pending += dir * innerHeight * TAP * (e.shiftKey ? FAST : 1);
    run();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') { if (hold) hold.fast = false; return; }
    if (hold && e.key === hold.key) {
      e.preventDefault(); e.stopImmediatePropagation();
      hold = null;                                           // stops gliding at once (a short ease out)
      run();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => { hold = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { hold = null; pending = 0; vel = 0; } });
})();
