// ==UserScript==
// @name         MAL Paste Codes
// @namespace    yoruc.mal.pastecodes
// @description  Paste a picture / GIF / YouTube / video link into a MyAnimeList post, comment or message and it becomes the code for it by itself.
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-paste-codes.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/Anime-site-scripts/main/myanimelist/mal-paste-codes.user.js
// @author       YoruC
// @match        https://myanimelist.net/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Where MAL understands its codes: every big editor (forum posts, messages, clubs, blog) and the plain
  // comment boxes on these pages. List notes, reviews and the like are left alone.
  const PAGES = /^\/(forum|profile|comments\.php|comtocom\.php|mymessages\.php|clubs\.php|myblog\.php|blog|editprofile\.php|myfriends\.php)/i;

  const IMG_RE = /\.(gif|png|jpe?g|webp|avif|bmp)([?#]\S*)?$/i;
  const IMG_HOST = /^https?:\/\/(media\d*\.tenor\.com|i\.imgur\.com|i\.ibb\.co|i\.postimg\.cc|pbs\.twimg\.com\/media|i\.redd\.it|cdn\.myanimelist\.net\/(images|s\/common\/uploaded_files))\//i;
  const VID_RE = /\.(mp4|webm|mov|m4v|mkv)([?#]\S*)?$/i;
  const URL_RE = /^https?:\/\/[^\s\[\]]+$/i;

  function ytId(u) {
    if (!/^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(u)) return '';
    const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(u);
    return m ? m[1] : '';
  }

  // one link -> its MAL code ('' = leave the link as it is)
  function code(u) {
    const id = ytId(u);
    if (id) return '[yt]' + id + '[/yt]';
    if (/^https?:\/\/i\.imgur\.com\/\w+\.gifv$/i.test(u)) return '[img]' + u.replace(/\.gifv$/i, '.gif') + '[/img]';
    if (VID_RE.test(u)) return '[url=' + u + ']' + u + '[/url]';       // MAL has no video player: a clickable link
    if (IMG_RE.test(u) || IMG_HOST.test(u)) return '[img]' + u + '[/img]';
    return '';
  }

  // the pasted text is nothing but links (one, or several on their own lines / with spaces)
  function convert(txt) {
    const parts = txt.trim().split(/(\s+)/);
    let hit = false;
    const out = parts.map((p, i) => {
      if (i % 2) return p;
      if (!URL_RE.test(p)) { hit = null; return p; }
      const c = code(p);
      if (c && hit !== null) hit = true;
      return c || p;
    });
    return hit ? out.join('') : '';
  }

  function wanted(t) {
    if (!t || t.tagName !== 'TEXTAREA' || t.readOnly || t.disabled) return false;
    if (t.classList.contains('mdm-text')) return false;                 // MAL DMs' chat box does it itself
    if (t.closest('.sceditor-container')) return true;
    return PAGES.test(location.pathname);
  }

  document.addEventListener('paste', e => {
    const t = e.target;
    if (!wanted(t) || !e.clipboardData) return;
    const txt = e.clipboardData.getData('text/plain') || '';
    if (!txt || txt.length > 4000) return;
    // pasting INTO a code ([img]|[/img], [url=|], [yt]|) : leave it alone
    const before = t.value.slice(0, t.selectionStart), after = t.value.slice(t.selectionEnd);
    if (/[\]=("']$/.test(before) || /^\s*\[\//.test(after)) return;
    const out = convert(txt);
    if (!out) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    t.focus();
    let done = false;
    try { done = document.execCommand('insertText', false, out); } catch (err) { /* older browsers */ }   // keeps Ctrl+Z
    if (!done) {
      t.setRangeText(out, t.selectionStart, t.selectionEnd, 'end');
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);
})();
