// ClaudeClock v3.3.0 — transport-agnostic, composer-aware timestamp injector
//
// Prepends a wall-clock timestamp to your outgoing message on claude.ai / Cowork
// so Claude knows the current time instead of guessing.
//
// HOW IT WORKS (short version):
//   1. Capture — reads what you typed the moment you hit send (never writes back
//      into the ProseMirror editor).
//   2. Inject — finds that text in the outgoing request and prepends the stamp.
//      The message leaves as a GZIP-COMPRESSED JSON body on a fetch to the
//      /completion endpoint, so v3.3 inflates it (DecompressionStream), stamps the
//      message in place, and re-compresses it (CompressionStream) before sending.
//   It still also handles plain-string, Request-object, and non-string bodies on
//   fetch / XHR / WebSocket, so a future transport change degrades gracefully.
//
// DEBUGGING: set DEBUG = true below, reload the extension, refresh the tab. That
// turns on the full forensic trace (outgoing request shapes, PEEK of decoded
// bodies, near-miss context, magic-byte sniffing) that was used to find the gzip
// layer in the first place. Leave it false for normal use — a quiet console with
// one "stamped …" line per message, loud only on real failure.
//
// See INJECTION.md for the full technical story, including how v3.1→v3.3 tracked
// the message from "invisible" down to the gzip round-trip.

(function () {
  'use strict';
  const DEBUG = false; // ← flip to true to get the full forensic console trace

  const TAG = 'ClaudeClock:';
  const log = (...a) => console.log(TAG, ...a);           // essentials + failures
  const dbg = (...a) => { if (DEBUG) console.log(TAG, ...a); }; // forensic trace
  log('v3.3.0 injected' + (DEBUG ? ' (DEBUG on)' : ''));

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
      .replace(/ /g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+$/, '')
      .trim();
  }

  function capture(reason) {
    const text = readComposer();
    if (!text || STAMPED.test(text)) return;
    pending = { text, stamp: getTimestamp(), at: Date.now() };
    dbg('captured send (' + reason + '):',
        JSON.stringify(text.slice(0, 60)) + (text.length > 60 ? '…' : ''));
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = null; }, 15000);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
      const t = e.target;
      if (t && t.closest && t.closest(COMPOSER_SEL)) capture('enter');
    }
  }, true);

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
      const i = bodyStr.indexOf(T);
      if (i !== -1 && !STAMPED.test(bodyStr.slice(i, i + 12))) {
        pending = null; return bodyStr.slice(0, i) + stamp + bodyStr.slice(i);
      }
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
    if (pending && bodyStr.length < 400000) {
      const probe = pending.text.slice(0, 12);
      const at = bodyStr.indexOf(probe);
      if (at !== -1) {
        dbg('near-miss in', transport, '— your text is in this payload but unmatched. Context:',
            JSON.stringify(bodyStr.slice(Math.max(0, at - 60), at + 140)));
      }
    }
    return bodyStr;
  }

  // ---- body shape helpers --------------------------------------------------
  function describeBody(b) {
    if (b == null) return 'none';
    if (typeof b === 'string') return 'string(len ' + b.length + ')';
    if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return 'URLSearchParams';
    if (typeof Blob !== 'undefined' && b instanceof Blob) return 'Blob(' + (b.type || '?') + ', ' + b.size + 'b)';
    if (typeof FormData !== 'undefined' && b instanceof FormData) return 'FormData';
    if (typeof ReadableStream !== 'undefined' && b instanceof ReadableStream) return 'ReadableStream';
    if (b instanceof ArrayBuffer) return 'ArrayBuffer(' + b.byteLength + 'b)';
    if (ArrayBuffer.isView(b)) return (b.constructor && b.constructor.name || 'TypedArray') + '(' + b.byteLength + 'b)';
    return (b && b.constructor && b.constructor.name) || typeof b;
  }

  function asU8(b) {
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return null;
  }

  function isGzip(u8) { return !!u8 && u8.length > 1 && u8[0] === 0x1f && u8[1] === 0x8b; }

  function sniffMagic(b) {
    const u = asU8(b);
    if (!u || u.length < 2) return '';
    if (u[0] === 0x1f && u[1] === 0x8b) return 'gzip (1f 8b)';
    if (u[0] === 0x78 && (u[1] === 0x01 || u[1] === 0x9c || u[1] === 0xda)) return 'zlib/deflate (78 ' + u[1].toString(16) + ')';
    if (u[0] === 0x28 && u[1] === 0xb5) return 'zstd (28 b5)';
    if (u[0] === 0x7b || u[0] === 0x5b) return 'looks like JSON (starts "' + String.fromCharCode(u[0]) + '")';
    return 'first bytes: ' + [u[0], u[1], u[2], u[3]].map((x) => (x == null ? '--' : x.toString(16).padStart(2, '0'))).join(' ');
  }

  // ---- gzip round-trip (browser-native streams) ----------------------------
  const GZIP_OK = (typeof DecompressionStream !== 'undefined') && (typeof CompressionStream !== 'undefined');

  async function gunzip(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  async function gzip(str) {
    const bytes = new TextEncoder().encode(str);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function bodyToText(b) {
    try {
      if (typeof b === 'string') return b;
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString();
      if (typeof Blob !== 'undefined' && b instanceof Blob) return await b.text();
      if (b instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(b));
      if (ArrayBuffer.isView(b)) return new TextDecoder().decode(b);
    } catch (_) { /* fall through */ }
    return null;
  }

  function peekDecoded(kind, rawBody, decoded) {
    if (!pending || !DEBUG) return;
    const T = pending.text;
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const raw = T && decoded.indexOf(T) !== -1;
    const nrm = T && norm(decoded).indexOf(norm(T)) !== -1;
    const esc = T && decoded.indexOf(JSON.stringify(T).slice(1, -1)) !== -1;
    dbg('PEEK (' + kind + ') — ' + describeBody(rawBody) + ' · decoded ' + decoded.length +
        ' chars · text present? raw=' + raw + ' norm=' + nrm + ' escaped=' + esc);
    dbg('PEEK head:', JSON.stringify(decoded.slice(0, 240)));
  }

  // ---- fetch ---------------------------------------------------------------
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    if (!pending) return _fetch.call(this, input, init);
    const self = this;

    const initHasBody = init && init.body != null;
    const inputIsRequest = (typeof Request !== 'undefined') && (input instanceof Request);

    // string init.body — synchronous fast path
    if (initHasBody && typeof init.body === 'string') {
      try { init = Object.assign({}, init, { body: inject('fetch', init.body) }); }
      catch (e) { log('fetch hook error', e); }
      return _fetch.call(self, input, init);
    }

    if (initHasBody || inputIsRequest) {
      return (async () => {
        try {
          if (initHasBody) {
            const u8 = asU8(init.body);

            // THE FIX: gzip-compressed body → inflate, stamp, re-gzip
            if (isGzip(u8)) {
              dbg('outgoing fetch (pending) url=', String(inputIsRequest ? input.url : input), '· body= gzip', u8.byteLength + 'b');
              if (!GZIP_OK) { log('gzip streams unavailable in this browser — cannot rewrite'); return _fetch.call(self, input, init); }
              let json = null;
              try { json = await gunzip(u8); } catch (e) { log('gunzip failed', e); }
              if (json != null) {
                const out = inject('fetch(gzip)', json);
                if (out !== json) {
                  try {
                    const rez = await gzip(out);
                    dbg('re-gzipped stamped body:', u8.byteLength, '→', rez.byteLength, 'bytes');
                    return _fetch.call(self, input, Object.assign({}, init, { body: rez }));
                  } catch (e) { log('re-gzip failed — sending original untouched', e); }
                } else {
                  peekDecoded('gzip→json', init.body, json);
                }
              }
              return _fetch.call(self, input, init);
            }

            // other non-string bodies
            dbg('outgoing fetch (pending) url=', String(inputIsRequest ? input.url : input),
                '· body=', describeBody(init.body), '· magic:', sniffMagic(init.body));
            const src = await bodyToText(init.body);
            if (src != null) {
              const out = inject('fetch', src);
              if (out !== src) return _fetch.call(self, input, Object.assign({}, init, { body: out }));
              if (typeof init.body !== 'string') peekDecoded('decode', init.body, src);
            } else {
              dbg('fetch (pending): init.body not stringifiable —', describeBody(init.body));
            }
          } else {
            // Request object carrying the body
            let buf = null;
            try { buf = await input.clone().arrayBuffer(); } catch (_) {}
            const u8 = buf ? new Uint8Array(buf) : null;
            if (isGzip(u8) && GZIP_OK) {
              dbg('outgoing fetch (pending) Request gzip body url=', input.url, '(', u8.byteLength, 'b )');
              let json = null;
              try { json = await gunzip(u8); } catch (e) { log('gunzip failed', e); }
              if (json != null) {
                const out = inject('fetch(gzip)', json);
                if (out !== json) {
                  try { const rez = await gzip(out); return _fetch.call(self, new Request(input, { body: rez }), init); }
                  catch (e) { log('re-gzip (Request) failed', e); }
                } else { peekDecoded('gzip→json (Request)', u8, json); }
              }
              return _fetch.call(self, input, init);
            }
            let src = '';
            try { src = u8 ? new TextDecoder().decode(u8) : ''; } catch (_) {}
            dbg('outgoing fetch (pending) url=', input.url, 'method=', input.method,
                '· Request.body=', src ? 'string(len ' + src.length + ')' : describeBody(input.body));
            if (src) {
              const out = inject('fetch', src);
              if (out !== src) return _fetch.call(self, new Request(input, { body: out }), init);
            }
          }
        } catch (e) { log('fetch async hook error', e); }
        return _fetch.call(self, input, init);
      })();
    }

    return _fetch.call(self, input, init);
  };

  // ---- XMLHttpRequest ------------------------------------------------------
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__ccUrl = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (pending) {
        if (typeof body === 'string') body = inject('xhr', body);
        else if (body != null) dbg('outgoing xhr (pending) url=', this.__ccUrl, '· body=', describeBody(body), '· magic:', sniffMagic(body));
      }
    } catch (e) { log('xhr hook error', e); }
    return _send.call(this, body);
  };

  // ---- WebSocket -----------------------------------------------------------
  const _wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (pending) {
        if (typeof data === 'string') data = inject('websocket', data);
        else if (data != null) dbg('outgoing ws (pending) · frame=', describeBody(data));
      }
    } catch (e) { log('ws hook error', e); }
    return _wsSend.call(this, data);
  };

  dbg('hooks installed: fetch + XMLHttpRequest + WebSocket' + (GZIP_OK ? ' (+gzip round-trip)' : ' (gzip streams UNAVAILABLE)'));
})();
