# ClaudeClock

A small Chrome (Manifest V3) extension that prepends a timestamp to the messages
you send on **claude.ai — including Cowork** — so Claude actually knows the current
date and time instead of guessing.

## Why

Claude has no reliable sense of wall-clock time between turns, and when it doesn't
know the time it will happily *confabulate* one. ClaudeClock stamps each outgoing
message with an ISO timestamp plus a human-readable Eastern-time string, e.g.:

```
[2026-09-17T19:42:30.693Z] (3:42 PM ET)
your message here
```

That line rides along with your message, so Claude sees exactly when you sent it.

## Install (unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. After any update: click the extension's **reload (↻)**, then **refresh** any open
   claude.ai tab (content scripts only inject on page load, so an open tab keeps
   running the old script until you refresh it).

## How it works (v3)

Earlier versions overrode `window.fetch` and edited the request body, assuming the
message rode in a `prompt` or `messages[].content` **string**. Cowork broke that
assumption: it sends your message over a different transport (XHR and/or WebSocket)
in a different shape, so a fetch-only, schema-specific hook never saw the text.

v3 is **transport- and schema-agnostic**:

1. It watches the composer (a TipTap/ProseMirror `contenteditable`) and, the moment
   you send (Enter, or a send-button click), captures the exact text you typed plus
   a timestamp. It never writes back into the editor.
2. It hooks `fetch`, `XMLHttpRequest.prototype.send`, **and**
   `WebSocket.prototype.send`. While a send is pending, it finds your captured text
   inside the outgoing payload — by JSON value-match, ProseMirror text-node
   fallback, raw substring, or JSON-escaped substring — and prepends the timestamp
   right there.
3. If it ever sees your text but can't place the stamp, it logs a `near-miss` with
   surrounding context, so adapting to a new payload shape is a one-line change.

See [`INJECTION.md`](./INJECTION.md) for the technical detail.

## Timezone

Timestamps render in US Eastern (`America/New_York`), which matches Indianapolis.
Change the `timeZone` in `getTimestamp()` inside `injected.js` for a different zone.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; host `https://claude.ai/*` |
| `content.js` | Content script (isolated world); injects `injected.js` into the page |
| `injected.js` | The capture + injection logic; runs in page context to hook fetch/XHR/WebSocket |

## History & durability

Descended from **GhostClock** (originally a ChatGPT tool), ported to Claude as
**ClaudeClock**, and rewritten as **v3** for the Cowork / ProseMirror era. It is
known to be *finite*: it rides on the app's current front-end, so a large enough
UI refactor will eventually need another pass. v3 is built to make that pass small —
the `near-miss` log points straight at whatever changed.
