# ClaudeClock

A small Chrome (Manifest V3) extension that prepends a timestamp to the messages
you send on **claude.ai — including Cowork** — so Claude actually knows the current
date and time instead of guessing.

## Why

Claude has no reliable sense of wall-clock time between turns, and when it doesn't
know the time it will happily *confabulate* one. ClaudeClock stamps each outgoing
message with an ISO timestamp plus a human-readable Eastern-time string, e.g.:

```
[2026-09-19T02:23:06.010Z] (10:23 PM ET)
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

## How it works (v3.3)

Earlier versions overrode `window.fetch` and edited a plain-string request body,
assuming the message rode in a `prompt` or `messages[].content` string. Cowork
broke that: the message now leaves as a **gzip-compressed JSON body** on a `fetch`
to the `/completion` endpoint, so a plain-string hook never saw the text.

v3.3 is transport-, schema-, **and compression-agnostic**:

1. **Capture** — it watches the composer (a TipTap/ProseMirror `contenteditable`)
   and, the moment you send, captures the exact text you typed plus a timestamp. It
   never writes back into the editor.
2. **Inject** — it hooks `fetch`, `XMLHttpRequest.prototype.send`, and
   `WebSocket.prototype.send`. While a send is pending it finds your captured text
   in the outgoing payload and prepends the stamp. For the live path — a gzip body
   — it inflates (`DecompressionStream`), stamps the message in the JSON, and
   re-compresses (`CompressionStream`) before sending. It also still handles plain
   strings, Request-object bodies, and other non-string bodies.

See [`INJECTION.md`](./INJECTION.md) for the full story, including how the
v3.1→v3.3 instrumentation tracked the message from "invisible" down to the gzip
layer.

## Debugging

`injected.js` ships with `DEBUG = false` at the top — a quiet console with one
`stamped outgoing message via …` line per message. If it ever stops working
(claude.ai changes its front-end again), set **`DEBUG = true`**, reload the
extension, refresh the tab, and send a message. That turns on the full forensic
trace — outgoing request shapes, a `PEEK` of decoded/decompressed bodies with a
printable-ratio and magic-byte sniff, and `near-miss` context — which points
straight at whatever changed.

## Timezone

Timestamps render in US Eastern (`America/New_York`), which matches Indianapolis.
Change the `timeZone` in `getTimestamp()` inside `injected.js` for a different zone.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest; host `https://claude.ai/*` |
| `content.js` | Content script (isolated world); injects `injected.js` into the page |
| `injected.js` | The capture + inject logic; runs in page context to hook fetch/XHR/WebSocket and do the gzip round-trip |

## History & durability

Descended from **GhostClock** (originally a ChatGPT tool), ported to Claude as
**ClaudeClock**, rewritten as **v3** for the Cowork / ProseMirror era, and taken to
**v3.3** once instrumentation revealed the completion body is gzip-compressed. It
is known to be *finite*: it rides on the app's current front-end, so a large enough
UI refactor will eventually need another pass. v3.3 is built to make that pass
small — flip `DEBUG` and the console tells you exactly what moved.
