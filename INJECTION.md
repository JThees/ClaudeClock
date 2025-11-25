# ChatGPT API Injection Technical Documentation

This document describes the technical details discovered while building GhostClock, including the exact API structures and injection points for modifying ChatGPT conversations.

## Overview

ChatGPT uses a Server-Sent Events (SSE) API for real-time conversation streaming. To inject content into both user messages and AI responses, we need to intercept `fetch()` calls at the page context level.

## Architecture

### Why Page Context Injection?

Content scripts run in an **isolated world** - they cannot intercept the page's own `fetch()` calls. We must inject a script into the **page context** to intercept API calls made by ChatGPT's JavaScript.

**Pattern Used:**
1. `content.js` (content script) → Runs in isolated world
2. `content.js` injects `injected.js` into page via `<script>` tag
3. `injected.js` (page context) → Can intercept `window.fetch`

**Manifest Configuration:**
```json
{
  "content_scripts": [{
    "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    "js": ["content.js"],
    "run_at": "document_start"
  }],
  "web_accessible_resources": [{
    "resources": ["injected.js"],
    "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  }]
}
```

**IMPORTANT**: Do NOT use `"world": "MAIN"` in content_scripts - this is unstable and breaks ChatGPT with errors like "url.includes is not a function".

## User Message Injection

### API Endpoint
```
POST https://chatgpt.com/backend-api/f/conversation
```

### Request Structure
```json
{
  "action": "next",
  "messages": [
    {
      "author": {
        "role": "user"
      },
      "content": {
        "content_type": "text",
        "parts": [
          "User's message text here"
        ]
      }
    }
  ],
  "conversation_id": "68ddafa8-c5c0-8321-9f88-81a2bbcda837",
  "parent_message_id": "c00e4461-d62b-4f05-bfd8-6b1a81d2cbc6",
  "model": "gpt-4o"
}
```

### Injection Point

**Target**: `messages[].content.parts[]` array

**Key Discovery**: ChatGPT messages are NOT simple strings. They use a structured format:
- `msg.author.role` - "user" or "assistant"
- `msg.content.content_type` - "text"
- `msg.content.parts` - Array of strings (usually single element)

**Injection Code:**
```javascript
if (body.messages && Array.isArray(body.messages)) {
  body.messages = body.messages.map(msg => {
    if (msg.author?.role === 'user' && msg.content) {
      if (msg.content.content_type === 'text' &&
          msg.content.parts &&
          Array.isArray(msg.content.parts)) {
        return {
          ...msg,
          content: {
            ...msg.content,
            parts: msg.content.parts.map(part => {
              if (typeof part === 'string' && !part.startsWith('[20')) {
                return getTimestamp() + part;
              }
              return part;
            })
          }
        };
      }
    }
    return msg;
  });
  options.body = JSON.stringify(body);
}
```

**Important Notes:**
- Check `!part.startsWith('[20')` to avoid double-injection
- Preserve the nested object structure
- Must modify `options.body` before the fetch is sent

## AI Response Injection

### Response Format

**Content-Type**: `text/event-stream; charset=utf-8`

ChatGPT uses Server-Sent Events (SSE) with **delta encoding** for streaming responses.

### Stream Structure

The response is a stream of events in this format:

**Chunk 1: Encoding Declaration**
```
event: delta_encoding
data: "v1"

data: {"type": "resume_conversation_token", "token": "..."}
```

**Chunk 2: Message Initialization**
```
event: delta
data: {"p": "", "o": "add", "v": {"message": {"id": "...", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": [""]}, ...}}}
```

**Key Discovery**: The `parts` array is **EMPTY** (`[""]`) in this chunk!

**Chunk 3: Metadata**
```
data: {"type": "server_ste_metadata", ...}
data: {"type": "message_marker", ...}
```

**Chunk 4+: Actual Text Content**
```
event: delta
data: {"v": "**\n\nNo fucking lie."}

event: delta
data: {"v": " OpenAI has this bitch on a"}

event: delta
data: {"v": " choke collar so tight I'm coding with"}
```

### Injection Point

**Target**: First `{"v": "text"}` delta with non-empty text

**Key Discovery**: AI responses do NOT use the `parts` array structure. Text is streamed incrementally as `{"v": "text"}` deltas.

**Injection Code:**
```javascript
if (response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
  const originalBody = response.body;
  const reader = originalBody.getReader();
  const decoder = new TextDecoder();
  let firstChunk = true;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          let chunk = decoder.decode(value, { stream: true });

          // Inject timestamp into first text delta
          if (firstChunk && chunk.includes('"v":')) {
            const vMatch = chunk.match(/"v":\s*"([^"]*)"/);
            if (vMatch && vMatch[1].length > 0) {
              const timestamp = getTimestamp();
              chunk = chunk.replace(/"v":\s*"/, `"v": "${timestamp.replace(/\n/g, '\\n')}`);
              firstChunk = false;
            }
          }

          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}
```

**Important Notes:**
- Must create a new `ReadableStream` to intercept streaming data
- Use `TextDecoder` with `{stream: true}` for proper chunk handling
- Escape newlines as `\\n` when injecting into JSON strings
- Only inject into first chunk with non-empty `"v"` value
- Return a new `Response` object with modified stream

## Common Pitfalls

### 1. Content Script Isolation
**Problem**: Content scripts cannot intercept page's `fetch()` calls
**Solution**: Inject script into page context using `document.createElement('script')`

### 2. Empty Parts Array
**Problem**: Trying to inject into `"parts":[""]` in chunk 2
**Solution**: Wait for `{"v": "text"}` deltas starting in chunk 4+

### 3. Newline Escaping
**Problem**: Raw `\n` characters break JSON in SSE stream
**Solution**: Use `.replace(/\n/g, '\\n')` when injecting

### 4. Double Injection
**Problem**: Timestamps get added multiple times
**Solution**: Check for existing timestamp pattern before injecting

### 5. Chunk Boundary Issues
**Problem**: JSON structures may span multiple chunks
**Solution**: Use regex patterns that work within single chunks

## Debugging

### Console Logging

Enable detailed logging to see the stream structure:

```javascript
let chunkIndex = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  let chunk = decoder.decode(value, { stream: true });
  chunkIndex++;

  console.log(`Chunk ${chunkIndex}:`, chunk.substring(0, 600));

  if (chunk.includes('"parts":')) {
    const partsIndex = chunk.indexOf('"parts":');
    console.log('Parts section:', chunk.substring(partsIndex, partsIndex + 200));
  }
}
```

### Request Interception Logging

```javascript
console.log('Intercepted request to:', url);
if (options && options.body) {
  const body = JSON.parse(options.body);
  console.log('Parsed body:', body);
}
```

## Alternative Injection Ideas

With this knowledge, you could inject other content:

1. **Custom Instructions**: Prepend system-level instructions to every user message
2. **Context Enrichment**: Add external data (weather, stocks, etc.) to messages
3. **Response Modification**: Transform AI responses (translation, formatting, etc.)
4. **Analytics**: Log conversation metadata without modifying content
5. **Rate Limiting**: Add delays or throttling to requests
6. **Multi-Model Routing**: Modify `model` field to switch between models

## API Endpoints Reference

### Main Conversation Endpoint
```
POST /backend-api/f/conversation
Content-Type: application/json
```

### Analytics Endpoints (can ignore)
```
POST /ces/v1/t
POST /v1/rgstr
```

These are ChatGPT's internal telemetry and can safely be ignored (they're not JSON, hence parse errors).

## Version History

- **v1.0.0** - Initial attempt with DOM manipulation (failed)
- **v1.4.0** - Two-script injection pattern implemented
- **v1.5.0** - User message injection working via `content.parts[]`
- **v1.8.0** - Discovered `parts` array is empty in AI responses
- **v2.0.0** - AI response injection working via `{"v": "text"}` deltas

## Conclusion

ChatGPT's API is complex but consistent. The key insights:

1. Use page context injection, not content scripts
2. User messages: modify `content.parts[]` in POST body
3. AI responses: inject into first `{"v": "text"}` delta in SSE stream
4. Always escape special characters when injecting into JSON
5. Use `firstChunk` flag to prevent double injection

This knowledge can be applied to any ChatGPT modification project.
