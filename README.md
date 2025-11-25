# GhostClock - ChatGPT Timestamp Extension

A browser extension that automatically prepends timestamps to both user messages and AI responses in ChatGPT conversations, ensuring temporal context is always included.

## Features

- **Dual Timestamp Injection**: Timestamps both your messages and ChatGPT's responses
- **ISO 8601 Format**: `[2025-10-01T12:34:56.789Z]` for machine readability
- **Human-Readable Time**: `(8:30 PM EST)` appended for easy reading
- **Line Break**: Timestamps appear on their own line for clean formatting
- **API-Level Interception**: Works by intercepting fetch calls, not DOM manipulation
- **Non-intrusive**: Runs silently in the background
- **Compatible**: Works with chatgpt.com and chat.openai.com

## Installation

### Chrome/Edge/Brave

1. Download or clone this repository
2. Open your browser and navigate to:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`

3. Enable "Developer mode" (toggle in top-right corner)

4. Click "Load unpacked"

5. Select the `GhostClock` folder

6. The extension is now active on ChatGPT!

### Firefox

1. Download or clone this repository

2. Open Firefox and navigate to: `about:debugging#/runtime/this-firefox`

3. Click "Load Temporary Add-on"

4. Navigate to the `GhostClock` folder and select `manifest.json`

5. The extension is now active on ChatGPT!

**Note**: In Firefox, temporary extensions are removed when you close the browser. For permanent installation, you'll need to sign the extension through Firefox Add-ons.

## Usage

1. Navigate to [ChatGPT](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)

2. Type your message as normal

3. Press Enter or click the send button

4. The extension automatically prepends timestamps to both your messages and AI responses

Example:
```
Your input: "What's the weather like?"

Sent to ChatGPT:
[2025-10-01T15:30:45.123Z] (3:30 PM EST)
What's the weather like?

ChatGPT's response:
[2025-10-01T15:30:47.456Z] (3:30 PM EST)
I don't have access to real-time weather data...
```

## How It Works

The extension uses a two-script injection pattern to intercept ChatGPT's API communication:

1. **Content Script** (`content.js`): Injects the interceptor script into the page context

2. **Injected Script** (`injected.js`): Runs in the page context to intercept `fetch()` API calls

3. **User Message Interception**: Modifies outgoing requests to ChatGPT's API, prepending timestamps to the `content.parts[]` array in user messages

4. **AI Response Interception**: Intercepts Server-Sent Event (SSE) streaming responses and injects timestamps into the first text delta (`{"v": "text"}`)

This approach works at the API level rather than DOM manipulation, ensuring compatibility even as ChatGPT's interface changes.

## Privacy

- All processing happens locally in your browser
- No data is sent to external servers
- No data collection or tracking
- Open source - inspect the code yourself

## Icons

The extension includes custom icons (black background with teal analog clock):
- `icon16.png` - 16x16 pixels (toolbar)
- `icon48.png` - 48x48 pixels (extensions page)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

SVG source files are also included if you want to customize the design. Use `generate-icons.html` to convert SVG to PNG.

## Troubleshooting

**Timestamps not appearing?**
- Refresh the ChatGPT page after installing the extension
- Check that the extension is enabled in your browser's extension manager
- Open browser console (F12) and look for "GhostClock v2.0.0: Injected script loaded" message
- Verify you see "GhostClock: Timestamp added to outgoing message" when sending messages

**Extension not loading?**
- Ensure all files are in the same folder (`manifest.json`, `content.js`, `injected.js`, icon files)
- Check browser console for errors
- Verify you're using a Chromium-based browser (Chrome/Edge/Brave) or Firefox
- Try completely removing and reinstalling the extension

**Extension updates not loading?**
- Chrome aggressively caches extension files
- Click "Reload" on the extension card in chrome://extensions/
- If that doesn't work, completely remove and reinstall the extension
- Close and reopen your browser

## Uninstallation

1. Navigate to your browser's extensions page
2. Find "GhostClock - ChatGPT Timestamp"
3. Click "Remove"

## Technical Details

**Version**: 2.0.0

**Files**:
- `manifest.json` - Extension manifest (Manifest V3)
- `content.js` - Content script that injects the interceptor
- `injected.js` - Main script that intercepts fetch API
- `icon16.png`, `icon48.png`, `icon128.png` - Extension icons
- `icon16.svg`, `icon48.svg`, `icon128.svg` - SVG source files
- `generate-icons.html` - SVG to PNG converter

**Timestamp Format**:
```
[2025-10-01T15:30:45.123Z] (3:30 PM EST)
```
- ISO 8601 timestamp for machine parsing
- 12-hour EST time for human readability
- Line break after timestamp

## License

MIT License - Feel free to modify and distribute

## Contributing

Issues and pull requests welcome!
