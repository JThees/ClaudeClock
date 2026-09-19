// ClaudeClock v3.0.0 — transport-agnostic, composer-aware timestamp injector
//
// Why v3: claude.ai / Cowork no longer sends your message as a plain JSON `fetch`
// body with a `prompt`/`content` string (v2's assumption). The composer is a
// TipTap/ProseMirror editor and the message leaves over whatever transport the
// app likes (fetch, XHR, or a WebSocket). So instead of guessing the request
// shape, v3:
//   1. reads the text you actually typed, at the moment you hit send, and
//   2. finds that exact text inside the outgoing payload — on fetch, XHR, OR
//      WebSocket — and prepends the timestamp right there.
// Never writes to the editor, never assumes a schema, and logs a "near-miss" if
// it sees your text but can't place the stamp cleanly (so we can refine fast).

(function () {
  'use strict';
  const TAG = 'ClaudeClock:';
  const log = (...a) => console.log(TAG, ...a);
  log('v3.0.0 injected (composer-aware)');

  function getTimestamp() {
    const now = new Date();
    const et = now.toLocaleString('en-US', {
      timeZone: 'America/New_York', // Eastern — correct for Indianapolis
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `[${now.toISOString()}] (${et} ET)\n`;
  }

  const STAMPED = /^\[20\d\d-\d\d-\d\dT/; // already-timestamped guard

  // ---- capture the user's message at send time -----------------------------
  const COMPOSER_SEL =
    '[data-composer-editor],.ProseMirror[contenteditable="true"],[role="textbox"][contenteditable="true"]';

  let pending = null;      // { text, stamp, at }
  let pendingTimer = null;

  function readComposer() {
    const el = document.querySelector(COMPOSER_SEL);
    if (!el) return '';
    return (el.innerText || '')
      .replace(/ /g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '')
      .trim();
  }

  function capture(reason) {
    const text = readComposer();
    if (!text || STAMPED.test(text)) return;
    pending = { text, stamp: getTimestamp(), at: Date.now() };
    log('captured send (' + reason + '):',
        JSON.stringify(text.slice(0, 60)) + (text.length > 60 ? '…' : ''));
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = null; }, 15000);
  }

  // Enter (without Shift) inside the composer = send
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      const t = e.target;
      if (t && t.closest && t.closest(COMPOSER_SEL)) capture('enter');
    }
  }, true);

  // clicking any button while the composer has text = probably the send button
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button,[role="button"]');
    if (btn && readComposer()) capture('click');
  }, true);

  // ---- place the stamp wherever the text rides in the payload ---------------
  function core(bodyStr) {
    const T = pending.text;
    const stamp = pending.stamp;
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const tNorm = norm(T);

    // structured JSON payloads (the common case)
    try {
      const obj = JSON.parse(bodyStr);
      let hit = false;

      // pass 1: a string value that IS the message
      const exact = (node) => {
        if (hit || node == null || typeof node !== 'object') return;
        const entries = Array.isArray(node) ? node.map((v, i) => [i, v]) : Object.entries(node);
        for (const [k, v] of entries) {
          if (hit) return;
          if (typeof v === 'string') {
            if (!STAMPED.test(v) && (v === T || norm(v) === tNorm)) { node[k] = stamp + v; hit = true; return; }
          } else { exact(v); }
        }
      };
      exact(obj);

      // pass 2 (fallback): first ProseMirror text leaf that begins the message
      if (!hit) {
        const leaf = (node) => {
          if (hit || node == null || typeof node !== 'object') return;
          if (node.type === 'text' && typeof node.text === 'string' &&
              !STAMPED.test(node.text) && T.startsWith(node.text)) {
            node.text = stamp + node.text; hit = true; return;
          }
          const entries = Array.isArray(node) ? node : Object.values(node);
          for (const v of entries) { if (hit) return; if (v && typeof v === 'object') leaf(v); }
        };
        leaf(obj);
      }

      if (hit) { pending = null; return JSON.stringify(obj); }
      return bodyStr;
    } catch (_) {
      // raw string payload containing the message verbatim
      const i = bodyStr.indexOf(T);
      if (i !== -1 && !STAMPED.test(bodyStr.slice(i, i + 12))) {
        pending = null; return bodyStr.slice(0, i) + stamp + bodyStr.slice(i);
      }
      // message sits inside a larger string as a JSON-escaped chunk
      const escT = JSON.stringify(T).slice(1, -1);
      const j = bodyStr.indexOf(escT);
      if (j !== -1) {
        const escStamp = JSON.stringify(stamp).slice(1, -1);
        pending = null; return bodyStr.slice(0, j) + escStamp + bodyStr.slice(j);
      }
      return bodyStr;
    }
  }

  function inject(transport, bodyStr) {
    if (!pending || typeof bodyStr !== 'string' || !bodyStr) return bodyStr;
    const out = core(bodyStr);
    if (out !== bodyStr) { log('stamped outgoing message via', transport); return out; }
    // diagnostics: text is present but we couldn't place the stamp cleanly
    if (pending && bodyStr.length < 300000) {
      const probe = pending.text.slice(0, 12);
      const at = bodyStr.indexOf(probe);
      if (at !== -1) {
        log('near-miss in', transport, '— your text is in this payload but unmatched. Context:',
            JSON.stringify(bodyStr.slice(Math.max(0, at - 60), at + 140)));
      }
    }
    return bodyStr;
  }

  // fetch
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      if (pending && init && typeof init.body === 'string') {
        init = Object.assign({}, init, { body: inject('fetch', init.body) });
      }
    } catch (e) { log('fetch hook error', e); }
    return _fetch.call(this, input, init);
  };

  // XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__ccUrl = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try { if (pending && typeof body === 'string') body = inject('xhr', body); }
    catch (e) { log('xhr hook error', e); }
    return _send.call(this, body);
  };

  // WebSocket
  const _wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try { if (pending && typeof data === 'string') data = inject('websocket', data); }
    catch (e) { log('ws hook error', e); }
    return _wsSend.call(this, data);
  };

  log('hooks installed: fetch + XMLHttpRequest + WebSocket');
})();
