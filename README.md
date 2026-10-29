# Smart Message Reminder

A local-first React, TypeScript, Vite, and Chrome Manifest V3 application for turning a selected WhatsApp Web message into a reminder. Message parsing and reminder data stay on this device. The extension does not request WhatsApp credentials, QR codes, cookies, or tokens and does not upload message content.

## Project structure

```text
.
├── index.html
├── package.json
├── public/
│   ├── icon.png
│   └── manifest.json
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── extension/
│   │   ├── background.ts
│   │   └── content.ts
│   ├── services/
│   │   ├── messageParser.ts
│   │   └── reminderStore.ts
│   └── shared/
│       └── types.ts
├── tests/
│   └── messageParser.test.ts
├── tsconfig.json
└── vite.config.ts
```

## Development

Requirements: Node.js 18+ and npm.

```powershell
npm install
npm run dev
npm test
npm run build
```

The web dashboard runs without Chrome APIs and stores preview data in `localStorage`. The built extension uses `chrome.storage.local`.

## Deploy the dashboard to Render

The included `render.yaml` configures a Render Static Site named `smart-message-reminder-sanjaikumar`. Push this repository to GitHub, then in Render choose **New → Blueprint**, connect the repository, and apply the Blueprint. It builds with `npm ci && npm run build` and publishes `dist/`. The configured site URL is `https://smart-message-reminder-sanjaikumar.onrender.com`.

The Chrome extension must still be installed separately in each browser. The manifest permits the configured Render URL to connect to the extension; after changing the manifest, rebuild and reload or republish the extension. The dashboard's **Settings → WhatsApp Web** page accepts the installed extension ID and connects to that browser's local reminder storage. Data is not synchronized between users or devices.

## Load the Chrome extension

1. Run `npm run build`.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select this project's `dist` folder.
4. Open WhatsApp Web and reload the tab so the extension content script is installed.
5. In WhatsApp Web, use the **Monitor this chat** control to explicitly enable one open chat. Newly added visible messages in that chat are checked locally; the currently rendered messages are marked as baseline and are not backfilled.
6. To import a particular message, select its text and choose **Add reminder**. This works in the explicitly enabled chat too.

The WhatsApp Web UI is not a stable integration surface. The extension uses a small isolated DOM adapter for currently visible messages and a best-effort chat header label; this may stop working if WhatsApp changes its UI. It does not use undocumented WhatsApp APIs, scan the history, or process any chat until that chat is explicitly enabled. The adapter only processes newly added visible messages while the chat is at its latest-message position; messages loaded while scrolling history are ignored. If automatic detection or selection does not work, paste the message into the dashboard's manual import box. Parsing is local and rule-based. A date without a specific time is scheduled for 9:00 AM local time. Messages without a clear date are saved as **Needs review** until a user schedules them.

### Connect the hosted or localhost dashboard to Chrome storage

The extension popup already shares Chrome storage. If you use the dashboard at `http://localhost:5173` or the configured Render URL, go to **Settings → WhatsApp Web**, copy the extension ID shown under `chrome://extensions`, paste it into the connection field, and choose **Connect extension**. The bridge accepts only the configured local origins and Render hostname. Rebuild and reload the unpacked extension after changing its manifest.

## Privacy and notifications

- Monitoring is off by default and must be enabled for one open chat.
- The extension processes only newly added visible messages in that enabled chat, or text explicitly selected by the user. It does not backfill already displayed chat history.
- Original excerpts are not saved unless **Save original message excerpt** is enabled.
- Reminder records and settings are stored with Chrome Storage API in the extension and are never transmitted.
- Chrome alarms and notifications require Chrome to be running. Reminders might not fire while Chrome is closed or the device is asleep.
- **Delete all stored data** clears reminders and resets settings on this device.

## Notes

The parser recognizes common relative dates, weekdays, month/day dates, ISO dates, and 12-hour times. Natural-language dates and times can still be ambiguous; verify them in the dashboard. The processing service is separated from the UI so a future AI adapter can be added without changing the extension's privacy defaults.
