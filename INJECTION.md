# ClaudeClock — Injection Technical Notes (v3.3)

How ClaudeClock gets a timestamp onto your outgoing message in claude.ai / Cowork.

## The problem with the old approaches

**v2** overrode `window.fetch`, parsed the request body as JSON, and prepended the
timestamp to `body.prompt` or `body.messages[last].content` (both strings). That
worked on the older chat API, where the message text rode in a plain-string POST
body. It stopped working in Cowork: the only readable `fetch` bodies were things
like `{ "message_ids": [...] }` (a reference by ID, no text), so a fetch-only,
schema-specific hook was structurally blind to the message.

**v3.0** decoupled the two halves — capture at the composer, inject at the
transport — and hooked `fetch` + `XHR` + `WebSocket`, scanning each outgoing
**string** payload for the captured text. Right idea, but it still assumed the
text would appear as a *string* somewhere. It didn't, and the failure was silent.

## What the v3.1→v3.3 instrumentation found

The v3.0 miss was silent because it neither stamped nor logged a near-miss, so
v3.1–v3.2 added instrumentation to make the invisible visible:

- **v3.1** taught the fetch hook to also read **Request-object** bodies and
  **non-string** bodies, and to log the URL + body-shape of every outgoing request
  while a send is pending. Result: the send is a single `fetch` to
  `/…/completion` (`mode=legacy`) whose body is a **`Uint8Array` (~40 KB)** — not a
  string, not a Request. (That ruled out the "other transport" theory entirely.)
- **v3.2** added a `PEEK` for a decoded-but-unmatched non-string body: char length,
  a **printable-character ratio**, presence checks, and **magic-byte sniffing**.
  It printed: `magic: gzip (1f 8b) · decoded 38242 chars · ~40% printable · text
  present? raw=false`. That settled it — the body is **gzip-compressed JSON**.
  Every prior version decoded the gzip bytes as UTF-8, got mojibake, and so never
  found the text.

## The v3.3 approach: capture at the composer, gzip round-trip at the transport

Two decoupled halves.

### 1. Capture (what you typed)

The composer is a TipTap/ProseMirror `contenteditable` div. On `keydown` Enter
(no Shift/modifier) inside it — or any `button`/`[role="button"]` click while it
has text — v3 reads `composer.innerText`, normalizes whitespace, and stores
`pending = { text, stamp }` with a 15-second expiry. It **never writes back into
ProseMirror** (that would mean fighting the editor's document model). Reading is
safe and stable; writing is not.

### 2. Inject (into the outgoing payload)

While a send is `pending`, the fetch hook inspects the outgoing body:

1. **gzip body (the live path)** — if the bytes start with `1f 8b`, inflate with
   the browser-native `DecompressionStream('gzip')`, run the JSON matcher on the
   result, re-compress with `CompressionStream('gzip')`, and send the fresh bytes.
   `Content-Encoding` stays `gzip`; the browser recomputes `Content-Length`.
2. **plain string body** — scan and prepend directly (v3.0 fast path).
3. **Request-object / other non-string bodies** — read as text (or inflate if
   gzip) and scan; rebuild the request if changed.

The JSON matcher itself: `JSON.parse` the (inflated) body, walk it, find the first
string value equal to the captured text (exact or whitespace-normalized) and
prepend the stamp; fall back to the first ProseMirror `{ "type":"text", ... }` leaf
that begins the message; fall back again to raw / JSON-escaped substring matches.
On a hit, `pending` clears so later frames aren't double-stamped, and a
`^\[20\d\d-\d\d-\d\dT` guard prevents re-stamping.

## Diagnostics

The release build ships with `DEBUG = false` (top of `injected.js`) — a quiet
console with one `stamped outgoing message via …` line per message, loud only on
real failure. Flip `DEBUG = true`, reload, and refresh to get the full forensic
trace that found the gzip layer: per-send request shapes, `PEEK` of decoded
bodies (with printable-ratio + magic sniff), `near-miss` context, and re-gzip byte
counts. That trace is the thing that makes the *next* breakage a small, targeted
edit instead of another blind hunt.

Normal successful run (DEBUG off):

```
ClaudeClock: v3.3.0 injected
ClaudeClock: stamped outgoing message via fetch(gzip)
```

## Why this is durable

It depends on **no** endpoint URL or fixed request schema, and it now handles the
compression layer. As long as (a) the composer is findable and (b) your text
appears somewhere in the outgoing bytes after decompression, it works. If a future
refactor changes the shape again, `DEBUG = true` points straight at it.

## Known limits

- Still finite — it rides the live front-end.
- Handles gzip; **zstd/brotli/deflate** would need their own decode paths (the
  magic sniffer already names them if they ever appear).
- `FormData`/binary-only sends with no text payload are still out of scope.
- On a multi-frame send, only the first matching frame is stamped (intended).

## Timestamp format

```js
getTimestamp() // → "[<ISO>] (<h:mm AM/PM> ET)\n", Eastern via America/New_York
```
