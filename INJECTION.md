# ClaudeClock — Injection Technical Notes (v3)

How ClaudeClock gets a timestamp onto your outgoing message in claude.ai / Cowork.

## The problem with the old approach

v2 overrode `window.fetch`, parsed the request body as JSON, and prepended the
timestamp to `body.prompt` (a string) or `body.messages[last].content` (a string).
That worked on the older chat API, where the message text rode in the POST body.

It stopped working in **Cowork**. Watching the traffic during a send showed the only
JSON `fetch` bodies were things like:

```
{ "message_ids": ["msg_011Cf9WDYZ..."] }   // a message referenced by ID — no text
```

plus a multipart `FormData` upload (`cowork/attachments`). The user's typed text
never appeared in a `fetch` body the hook could parse. Cowork ships the message over
a different transport (XHR and/or WebSocket) and/or a different shape, so a
fetch-only, schema-specific hook is structurally blind to it.

## The v3 approach: capture at the composer, inject at the transport

Two decoupled halves.

### 1. Capture (what you typed)

The composer is a TipTap/ProseMirror `contenteditable` div. Selectors:

```
[data-composer-editor]
.ProseMirror[contenteditable="true"]
[role="textbox"][contenteditable="true"]
```

(aria-label "Write your prompt to Claude"). There is **no** plain send `<button>`
exposing a "send" label; sending is Enter-driven.

On `keydown` Enter (no Shift/modifier) inside the composer — or any
`button`/`[role="button"]` click while the composer has text — v3 reads
`composer.innerText`, normalizes whitespace, and stores `pending = { text, stamp }`
with a 15-second expiry. It deliberately **never writes back into ProseMirror**;
doing so would mean fighting the editor's internal document model and dispatching
synthetic input events. Reading is safe and stable; writing is not.

### 2. Inject (into the outgoing payload)

v3 wraps all three outgoing transports:

- `window.fetch`
- `XMLHttpRequest.prototype.send`
- `WebSocket.prototype.send`

While a send is `pending`, each outgoing **string** payload is scanned for the
captured text; if found, the timestamp is prepended in place:

1. **Structured JSON** — `JSON.parse` the body, walk it, find the first string value
   equal to the captured text (exact, or whitespace-normalized) and prepend. Fallback
   for ProseMirror-doc payloads: the first `{ "type": "text", "text": "..." }` leaf
   that *begins* the message.
2. **Raw string** — prepend at the first occurrence of the captured text.
3. **JSON-escaped** — if the text sits inside a larger string with escaped
   newlines/quotes, match and prepend the escaped forms.

On a hit, `pending` is cleared so later frames of the same send aren't double-stamped.
A `^\[20\d\d-\d\d-\d\dT` guard prevents re-stamping already-stamped text.

### Diagnostics

If a payload contains the captured text but no rule matched, v3 logs:

```
ClaudeClock: near-miss in <transport> — your text is in this payload but unmatched. Context: "..."
```

That prints the surrounding bytes, so adapting to a new shape is a small, targeted edit.

Normal successful run logs:

```
ClaudeClock: v3.0.0 injected (composer-aware)
ClaudeClock: hooks installed: fetch + XMLHttpRequest + WebSocket
ClaudeClock: captured send (enter): "..."
ClaudeClock: stamped outgoing message via <transport>
```

## Why this is more durable than v2

It depends on **no** endpoint URL, request schema, or transport. As long as (a) the
composer is findable and (b) your text appears somewhere in the outgoing bytes, it
works. Only a refactor that changes *both* of those breaks it — and the `near-miss`
log points straight at the new shape when it happens.

## Known limits

- Still finite — it rides the live front-end.
- Binary / `FormData`-only sends are not handled (the payload must be a string).
- On a multi-frame send, only the first matching frame is stamped (intended).

## Timestamp format

```js
getTimestamp() // → "[<ISO>] (<h:mm AM/PM> ET)\n", Eastern via America/New_York
```
