# 🔒 Tab Anchor

> A browser extension that anchors a tab to its current URL — protecting it from accidental navigation, accidental closing, and unwanted title changes.

Inspired by the workspace tab-locking feature that Microsoft Edge included up to version 143.

**Compatible with Chrome, Edge, and Firefox (142+).**

---

## ✨ Features at a glance

| | Feature | Summary |
|---|---|---|
| 🔐 | **Hard lock** | Blocks all navigation away from the locked URL; a banner lets you stay or unlock and go |
| 🔓 | **Soft lock** | Navigation is allowed, but a floating chip keeps a one-click shortcut back to the pinned URL |
| 🛡️ | **Tab close protection** | Closed locked tabs (hard or soft) are automatically reopened and re-locked at the pinned URL |
| 🔗 | **Hard lock link behavior** | Choose whether links open a warning, a new tab in the same group, or a new tab outside any group |
| ✏️ | **Tab rename** | Assign a persistent custom title that survives page loads and navigation |
| 🌐 | **Favicon badge** | A gold lock badge is composited onto the tab's favicon while locked |
| 📋 | **Lock history** | Every session is logged with URL, title, custom name, group, mode, and timestamps |
| 📤 | **Import / Export** | Back up and restore history as JSON; merges by entry ID, reconciles stale active entries |
| 🗂️ | **Tab group awareness** | Group name and colour are recorded; the tab is restored to its group if closed |
| 🎨 | **Theming** | History and settings page supports System, Light, and Dark themes |
| 🖱️ | **Context menu** | All actions available by right-clicking the extension icon or tab strip |

---

## 🔐 Hard lock

When a tab is hard locked, any attempt to navigate away — by clicking a link, typing in the address bar, submitting a form, or being redirected by a script — is intercepted and cancelled. The tab is immediately returned to its locked URL.

A **red banner** appears at the top of the page with two action buttons:

- **Stay here** — dismisses the banner; the tab remains on the locked URL
- **Unlock & Go** — removes the lock and navigates to the URL that was originally requested

The banner auto-dismisses after **5 seconds**. The × button closes it immediately.

### Hard lock link behavior

Instead of blocking navigation with a warning, you can configure hard-locked tabs to open links in a new tab. Choose from the **Settings** page:

| Option | Behaviour |
|---|---|
| **Block** *(default)* | Redirect back to pinned URL and show warning banner |
| **New tab · same group** | Open the link in a new tab placed in the same tab group |
| **New tab · no group** | Open the link in a new tab outside any group |

---

## 🔓 Soft lock

Soft lock is a lighter alternative. Navigation is allowed, but a **floating chip** appears in the bottom-right corner of every page you navigate to. The chip shows:

- **Go to Pinned URL** — one click returns you to the locked URL *(only shown when you have navigated away from the pinned URL)*
- **×** — removes the soft lock entirely

The chip is visible while soft lock is active, making it easy to get back without hunting through browser history.

---

## 🔄 Three-state lock cycle

Click the toolbar icon to step through three lock states:

| Click | State | Icon colour |
|---|---|---|
| 1st | **Soft lock** | 🟡 Yellow — open padlock |
| 2nd | **Hard lock** | 🟠 Amber — closed padlock |
| 3rd | **Unlocked** | 🔵 Cyan — open padlock |

The icon always reflects the lock state of the currently visible tab.

---

## 🛡️ Tab close protection

If a locked tab (hard **or** soft) is closed, the extension automatically reopens it in the same window at its pinned URL and re-applies the lock. An **orange banner** confirms: *"Tab closing blocked by Tab Anchor — this tab has been restored to its locked URL."* It auto-dismisses after **2 seconds**.

The tab is also restored to its original tab group (or a new group with the same name and colour if the original was deleted).

> **Note:** if the entire browser window is closed, Tab Anchor does not reopen the tab. The lock is simply removed.

---

## ✏️ Tab rename

Assign a custom title to any tab via the context menu. The name persists across navigation — the extension re-applies it on every page load within that tab. Clear it at any time using **Clear Tab Name** in the same menu.

---

## 🌐 Favicon badge

When a tab is locked, the extension composites a small gold lock badge onto the tab's existing favicon. The badge is generated in the background without altering the page's own favicon elements — the page's original icon is fully restored when the tab is unlocked. The badge also updates automatically if the page changes its favicon dynamically (e.g. Gmail updating its unread count icon).

---

## 🖱️ Context menu

All actions are available by right-clicking the extension icon (Chrome/Edge) or a tab in the tab strip (Firefox):

| Menu item | Description |
|---|---|
| **Lock Tab / Unlock Tab** | Toggle hard lock |
| **Soft Lock Tab / Remove Soft Lock** | Toggle soft lock |
| **Go to Pinned URL** | Navigate to the locked URL (enabled when locked) |
| **Rename Tab / Clear Tab Name** | Set or remove a custom tab title |
| — | *(separator)* |
| **Tab History** | Open the history and settings page |

---

## 📋 Lock history

Every time a tab is locked or unlocked, an entry is written to a persistent history log (up to **1 000 entries**). Each entry stores:

- 🔗 The locked URL and original page title (clickable — opens the URL in a new tab)
- ✏️ Custom name (if set)
- 🔒 Lock mode (Hard / Soft)
- 🗂️ Tab group name and colour (if the tab was in a group)
- 🕐 Timestamps for when the tab was locked and unlocked

The **Tab History** page (accessible from the context menu or the browser's extension settings) shows the full log as a **searchable, filterable table**. Entries still actively locked are highlighted and marked **Active**.

### Multi-select actions

Each row has a checkbox. When one or more rows are selected, two action buttons appear in the toolbar:

- **Open Selected (N)** — opens each selected URL in a new tab
- **Delete Selected (N)** — permanently removes the selected entries

The header checkbox selects or deselects all visible rows at once. Selection is cleared when the search filter changes.

---

## 📤 Import and export

The history page supports:

- **Export** — saves all entries as a `.json` file
- **Import** — merges from a previously exported file; duplicate entries (matched by ID) are skipped. Any entry that was marked *active* in the source browser but has no corresponding open locked tab in the current browser is automatically marked as closed on import.
- **Clear All** — removes only closed sessions that have no custom name; active locks and custom-named entries are never deleted

---

## ⚙️ Settings

Open **Tab History → Settings** to configure:

**🎨 Appearance**
- **Theme** — System (follows OS), Light, or Dark. Applied immediately and persisted across sessions.

**⚙️ Behaviour**
- **Navigation & close banners** — show or hide the red and orange warning banners. The lock remains active; only the banners are suppressed.
- **Soft lock chip** — show or hide the floating bottom-right chip. The soft lock itself remains active.
- **Hard lock — link behavior** — choose what happens when a link is clicked on a hard-locked tab: block navigation, open in a new tab in the same group, or open in a new tab outside any group.

---

## 🗂️ Tab group awareness

When a tab that belongs to a group is locked, the extension records the group's name and colour. If the tab is closed and automatically reopened, it is placed back into the same group — or a new group with the same name and colour if the original was deleted.

---

## ⚓ Anchor navigation always allowed

Hash fragment changes (`#section`, `#top`, etc.) are intentionally permitted — locking only activates when the actual page origin or path changes. Documentation sites, single-page apps, and anchor-heavy pages work normally inside a locked tab.

---

## 💾 Persists across browser restarts

Lock state is stored in `chrome.storage.local`. When the browser is restarted, all previously locked tabs that are still open are automatically re-locked, their toolbar icons updated, and their favicon badges re-applied.

---

## 📖 Usage reference

| Action | Result |
|---|---|
| Click toolbar icon (1×) | Apply soft lock |
| Click toolbar icon (2×) | Upgrade to hard lock |
| Click toolbar icon (3×) | Unlock |
| Right-click → **Lock Tab** | Apply hard lock directly |
| Right-click → **Unlock Tab** | Remove hard lock |
| Right-click → **Soft Lock Tab** | Apply soft lock directly |
| Right-click → **Remove Soft Lock** | Remove soft lock |
| Right-click → **Go to Pinned URL** | Navigate to the locked URL |
| Right-click → **Rename Tab** | Open rename dialog |
| Right-click → **Clear Tab Name** | Restore the page's own title |
| Right-click → **Tab History** | Open history & settings page |
| Banner → **Stay here** | Dismiss warning, remain on locked URL |
| Banner → **Unlock & Go** | Unlock and continue to blocked URL |
| Chip → **Go to Pinned URL** | Return to the soft-locked URL (shown only when away from pinned URL) |
| Chip → **×** | Remove soft lock |
| History → hostname or URL | Open the locked URL in a new tab |
| History → checkbox + **Open Selected** | Open all selected URLs as new tabs |
| History → checkbox + **Delete Selected** | Remove selected history entries |

---

## 🔑 Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read tab URLs, intercept navigations, and redirect locked tabs back |
| `tabGroups` | Read and restore tab group membership when a locked tab is reopened |
| `storage` | Persist lock state, history, and settings across sessions |
| `contextMenus` | Add actions to the tab strip and extension icon right-click menu |
| `host_permissions: <all_urls>` | Inject the warning banner, chip, and favicon badge into any page the user locks |

> 🔒 No data is sent anywhere. Everything runs locally in the browser.

---

## 🌐 Browser support

| Browser | Min version | Notes |
|---|---|---|
| ![Chrome](https://img.shields.io/badge/Chrome-99+-4285F4?logo=googlechrome&logoColor=white) | 99+ | Full support including tab groups |
| ![Edge](https://img.shields.io/badge/Edge-99+-0078D7?logo=microsoftedge&logoColor=white) | 99+ | Identical to Chrome (same engine) |
| ![Firefox](https://img.shields.io/badge/Firefox-142+-FF7139?logo=firefox&logoColor=white) | 142+ | Tab groups not supported |

---

## 🗂️ Project structure

```
Tab Anchor/
├── manifest.json          Extension configuration (Manifest V3)
├── background.js          Service worker — lock state, navigation interception, history
├── content.js             Injected into pages — banners, chip, favicon badge
├── options.html           History & settings page
├── options.js             History & settings page logic
├── styles/
│   ├── content.css        Styles for banners, chip, and rename dialog
│   └── options.css        Styles for the history & settings page (theming via CSS variables)
├── icons/                 Toolbar and extension management icons (including logo assets)
├── images/                Store listing screenshots
├── docs/
│   └── privacy-policy.html  Privacy policy (hosted via GitHub Pages)
├── scripts/
│   ├── build.js           Build and packaging script
│   └── generate-icons.html  One-time icon generator (open in Chrome)
└── package.json           Node.js project config
```

---

## 🛠️ Building and packaging

### Prerequisites

- [Node.js](https://nodejs.org/) 16 or later

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This produces:

- `dist/chrome/` — unpacked Chrome extension ready to load for development
- `dist/firefox/` — unpacked Firefox extension (includes `browser_specific_settings` and `data_collection_permissions` for AMO)
- `releases/tab-anchor-chrome-v{version}.zip` — ready for Chrome Web Store submission
- `releases/tab-anchor-firefox-v{version}.zip` — ready for Firefox Add-ons (AMO) submission

Each build run removes the previous release zip for that browser, so `releases/` always contains only the latest version.

### Load unpacked (development)

**Chrome / Edge**
1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/chrome/` folder

**Firefox**
1. Go to `about:debugging` → **This Firefox**
2. Click **Load Temporary Add-on**
3. Select any file inside `dist/firefox/`

### Releasing a new version

1. Bump `"version"` in `package.json` (the build script reads it from there)
2. Run `npm run build`
3. Submit the zip from `releases/` to the respective store
