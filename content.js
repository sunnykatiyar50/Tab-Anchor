// Only run in the top-level frame — not in iframes
if (window === window.top) {
  initTabAnchor();
}

// Cached user preferences — loaded once on init, kept in sync via storage events
let _settings = { showBanners: true, showChip: true };

async function loadContentSettings() {
  try {
    const { settings = {} } = await chrome.storage.local.get('settings');
    _settings.showBanners = settings.showBanners !== false;
    _settings.showChip    = settings.showChip    !== false;
  } catch {}
}

async function initTabAnchor() {
  await loadContentSettings();

  // Register the storage listener BEFORE the initial status check.
  // On browser restart, reconcileLockedTabs writes the rematched lock data
  // asynchronously. If we checked status first and registered this listener
  // afterwards, a write landing in that gap would be missed entirely —
  // leaving the lock in storage but never reflected in the UI.
  //
  // Fallback for Firefox too: re-sync UI whenever lock state changes in storage.
  // Direct background→content messages are unreliable with background.scripts,
  // so watching storage ensures the chip/banner always appears.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('lockedTabs' in changes) {
      checkLockStatusOnLoad();
    }
    if ('settings' in changes) {
      const s = changes.settings.newValue ?? {};
      _settings.showBanners = s.showBanners !== false;
      _settings.showChip    = s.showChip    !== false;
      // Hide live elements immediately if the setting was just turned off
      if (!_settings.showBanners) {
        removeWarningOverlay();
        clearTimeout(_closeWarningTimer);
        document.getElementById('__tab-anchor-close-overlay__')?.remove();
      }
      if (!_settings.showChip) hideSoftLockChip();
    }
  });

  // Now check whether this tab is locked on page load and restore overlay/favicon.
  checkLockStatusOnLoad();

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'SHOW_WARNING':
        console.log('[TabAnchor] received SHOW_WARNING', msg);
        showWarningOverlay(msg.attemptedUrl, msg.lockedUrl);
        break;
      case 'HIDE_OVERLAY':
        removeWarningOverlay();
        clearTimeout(_closeWarningTimer);
        document.getElementById('__tab-anchor-close-overlay__')?.remove();
        hideSoftLockChip();
        removeLockFavicon();
        break;
      case 'SHOW_CLOSE_WARNING':
        showCloseWarningBanner();
        break;
      case 'APPLY_LOCK_FAVICON':
        applyLockFaviconFromBackground(msg.favIconUrl ?? null, msg.mode ?? 'hard');
        break;
      case 'REMOVE_LOCK_FAVICON':
        removeLockFavicon();
        break;
      case 'SHOW_SOFT_CHIP':
        showSoftLockChip(msg.lockedUrl, msg.atHome);
        break;
      case 'HIDE_SOFT_CHIP':
        hideSoftLockChip();
        break;
      case 'SHOW_RENAME_DIALOG':
        showRenameDialog();
        break;
      case 'APPLY_RENAME':
        applyRename(msg.name);
        break;
    }
    sendResponse({ ok: true });
  });
}

// On load: ask background for lock status and restore UI state.
// This handles the race where the service worker restarts, or
// where status === "complete" fires before the content script registers.
async function checkLockStatusOnLoad() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_LOCK_STATUS', url: window.location.href });
    console.log('[TabAnchor] checkLockStatusOnLoad response', res);
    if (!res?.locked) {
      removeWarningOverlay();
      hideSoftLockChip();
      removeLockFavicon();
      return;
    }
    applyLockFaviconFromBackground(res.favIconUrl ?? null, res.mode ?? 'hard');
    // Hard lock warning banner
    if (res.mode === 'hard' && res.attemptedUrl) {
      console.log('[TabAnchor] showing warning overlay');
      showWarningOverlay(res.attemptedUrl, res.lockedUrl);
    } else {
      removeWarningOverlay();
    }
    // Soft lock chip
    if (res.mode === 'soft') {
      const atHome = normalizeUrlSimple(window.location.href) === normalizeUrlSimple(res.lockedUrl);
      console.log('[TabAnchor] showing soft chip, atHome=', atHome);
      showSoftLockChip(res.lockedUrl, atHome);
    } else {
      hideSoftLockChip();
    }
    if (res.rename) {
      applyRename(res.rename);
    }
  } catch (e) {
    console.log('[TabAnchor] checkLockStatusOnLoad error', e?.message);
    // Extension context may be invalidated (e.g. during hot-reload in dev)
  }
}

function normalizeUrlSimple(url) {
  try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; }
}

// ============================================================
// Warning overlay
// ============================================================

let _warningTimer = null;
let _closeWarningTimer = null;

function showWarningOverlay(attemptedUrl, lockedUrl) {
  if (!_settings.showBanners) return;
  console.log('[TabAnchor] showWarningOverlay called', { attemptedUrl, lockedUrl });
  removeWarningOverlay(); // prevent duplicates

  const overlay = document.createElement('div');
  overlay.id = '__tab-anchor-overlay__';
  const banner = document.createElement('div');
  banner.className = 'tl-banner';

  const lockIcon = document.createElement('span');
  lockIcon.className = 'tl-icon';
  lockIcon.setAttribute('aria-hidden', 'true');
  lockIcon.textContent = '🔒';
  banner.appendChild(lockIcon);

  const textDiv = document.createElement('div');
  textDiv.className = 'tl-text';
  const strongEl = document.createElement('strong');
  strongEl.textContent = 'Navigation blocked by Tab Anchor';
  textDiv.appendChild(strongEl);
  textDiv.appendChild(document.createTextNode(' — navigation to '));
  const blockedUrlSpan = document.createElement('span');
  blockedUrlSpan.className = 'tl-url';
  blockedUrlSpan.title = attemptedUrl;
  blockedUrlSpan.textContent = attemptedUrl;
  textDiv.appendChild(blockedUrlSpan);
  textDiv.appendChild(document.createTextNode(' was blocked.'));
  banner.appendChild(textDiv);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'tl-actions';
  const stayBtn = document.createElement('button');
  stayBtn.className = 'tl-btn tl-btn-stay';
  stayBtn.id = 'tl-stay';
  stayBtn.textContent = 'Stay here';
  actionsDiv.appendChild(stayBtn);
  const unlockBtn = document.createElement('button');
  unlockBtn.className = 'tl-btn tl-btn-unlock';
  unlockBtn.id = 'tl-unlock';
  unlockBtn.textContent = 'Unlock & Go';
  actionsDiv.appendChild(unlockBtn);
  banner.appendChild(actionsDiv);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tl-close';
  closeBtn.id = 'tl-close';
  closeBtn.setAttribute('aria-label', 'Dismiss warning');
  closeBtn.textContent = '×';
  banner.appendChild(closeBtn);

  overlay.appendChild(banner);
  document.body.appendChild(overlay);

  _warningTimer = setTimeout(removeWarningOverlay, 5000);

  overlay.querySelector('#tl-stay').addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ type: 'DISMISS_WARNING' }); } catch {}
    removeWarningOverlay();
  });

  overlay.querySelector('#tl-unlock').addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'UNLOCK_AND_CONTINUE' }); } catch {}
    removeWarningOverlay();
  });

  overlay.querySelector('#tl-close').addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ type: 'DISMISS_WARNING' }); } catch {}
    removeWarningOverlay();
  });
}

function removeWarningOverlay() {
  clearTimeout(_warningTimer);
  _warningTimer = null;
  document.getElementById('__tab-anchor-overlay__')?.remove();
}

function showCloseWarningBanner() {
  if (!_settings.showBanners) return;
  clearTimeout(_closeWarningTimer);
  document.getElementById('__tab-anchor-close-overlay__')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__tab-anchor-close-overlay__';
  overlay.innerHTML = `
    <div class="tl-banner tl-banner-close">
      <span class="tl-icon" aria-hidden="true">&#128274;</span>
      <div class="tl-text">
        <strong>Tab closing blocked by Tab Anchor</strong> &mdash; this tab has been restored to its locked URL.
      </div>
      <button class="tl-close" id="tl-close-close" aria-label="Dismiss">&times;</button>
    </div>
  `;
  document.body.appendChild(overlay);

  _closeWarningTimer = setTimeout(() => {
    document.getElementById('__tab-anchor-close-overlay__')?.remove();
    _closeWarningTimer = null;
  }, 2000);

  overlay.querySelector('#tl-close-close').addEventListener('click', () => {
    clearTimeout(_closeWarningTimer);
    _closeWarningTimer = null;
    document.getElementById('__tab-anchor-close-overlay__')?.remove();
  });
}

// ============================================================
// Favicon lock overlay
// ============================================================
// Chrome keeps showing the page's OWN declared <link rel="icon"> even when we
// append another one last (Firefox prefers the last; Chrome does not). So we
// override every existing icon link's href with our composited badge and save
// the originals to restore on unlock. We also inject our own link as a fallback
// for pages that declare no icon at all. A MutationObserver re-applies the badge
// when the page swaps its favicon dynamically (e.g. SPA updates).

const _TL_FAVICON_ID = '__tl-favicon__';
const _TL_SAVED_ATTR = 'data-tl-orig-href'; // marks page links we overrode
let _faviconObserver = null;
let _faviconDebounce = null;
let _faviconMode = 'hard';
let _faviconActive = false;
let _applyingFavicon = false; // suppress observer reactions to our own writes

function _pageIconLinks() {
  return [...document.querySelectorAll(
    'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  )].filter(l => l.id !== _TL_FAVICON_ID);
}

async function applyLockFaviconFromBackground(favIconUrl = null, mode = 'hard') {
  _faviconMode = mode;
  _faviconActive = true;
  await _refreshLockedFavicon(favIconUrl);

  // (Re)start the observer once. It watches for the page changing its own icons.
  if (!_faviconObserver) {
    _faviconObserver = new MutationObserver(() => {
      if (_applyingFavicon || !_faviconActive) return; // ignore our own mutations
      clearTimeout(_faviconDebounce);
      _faviconDebounce = setTimeout(() => _refreshLockedFavicon(), 300);
    });
    _faviconObserver.observe(document.head ?? document.documentElement, {
      childList: true, subtree: false,
      attributes: true, attributeFilter: ['href', 'rel'],
    });
  }
}

async function _refreshLockedFavicon(hintUrl = null) {
  try {
    // Resolve the page's real favicon URL to composite the badge onto.
    // If we already overrode a link, read its saved original instead of our data URL.
    const pageLinks = _pageIconLinks();
    let domUrl = null;
    for (const l of pageLinks) {
      const raw = l.getAttribute(_TL_SAVED_ATTR) ?? l.getAttribute('href');
      if (raw) { try { domUrl = new URL(raw, location.href).href; break; } catch {} }
    }
    // Last resort: the site's default /favicon.ico (covers pages with no <link>).
    const icoFallback = /^https?:$/.test(location.protocol) ? `${location.origin}/favicon.ico` : null;
    const originalUrl = domUrl ?? hintUrl ?? icoFallback;

    const res = await chrome.runtime.sendMessage({
      type: 'GET_FAVICON_DATA',
      originalFaviconUrl: originalUrl,
      mode: _faviconMode,
    });
    // Null means the background couldn't decode the real icon. Leave the page's
    // own favicon untouched rather than replacing the logo with a blank square.
    if (!res?.faviconDataUrl || !_faviconActive) return;

    _applyingFavicon = true;
    // Override the page's own icon links (the part Chrome actually honors).
    for (const l of pageLinks) {
      if (!l.hasAttribute(_TL_SAVED_ATTR)) {
        l.setAttribute(_TL_SAVED_ATTR, l.getAttribute('href') ?? '');
      }
      l.href = res.faviconDataUrl;
    }
    // Fallback link for pages with no declared icon.
    let el = document.getElementById(_TL_FAVICON_ID);
    if (!el) {
      el = document.createElement('link');
      el.id = _TL_FAVICON_ID;
      el.rel = 'icon';
      el.type = 'image/png';
    }
    el.href = res.faviconDataUrl;
    document.head?.appendChild(el);

    // Discard the records our own writes just queued so the observer doesn't loop.
    _faviconObserver?.takeRecords();
  } catch {
  } finally {
    _applyingFavicon = false;
  }
}

function removeLockFavicon() {
  _faviconObserver?.disconnect();
  _faviconObserver = null;
  clearTimeout(_faviconDebounce);
  _faviconActive = false;

  // Restore the page's original icon links.
  for (const l of _pageIconLinks()) {
    if (!l.hasAttribute(_TL_SAVED_ATTR)) continue;
    const orig = l.getAttribute(_TL_SAVED_ATTR);
    if (orig) l.href = orig; else l.removeAttribute('href');
    l.removeAttribute(_TL_SAVED_ATTR);
  }
  document.getElementById(_TL_FAVICON_ID)?.remove();
}

// ============================================================
// Soft lock chip
// ============================================================

function showSoftLockChip(lockedUrl, atHome) {
  if (!_settings.showChip) return;
  hideSoftLockChip();

  const chip = document.createElement('div');
  chip.className = 'tl-chip';

  const icon = document.createElement('span');
  icon.className = 'tl-chip-icon';
  icon.textContent = '🔒';
  chip.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tl-chip-label';
  label.textContent = 'Soft locked';
  chip.appendChild(label);

  if (!atHome) {
    const backBtn = document.createElement('button');
    backBtn.className = 'tl-chip-back';
    backBtn.textContent = 'Go to Pinned URL';
    backBtn.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'GO_BACK_TO_LOCKED' }); } catch {}
    });
    chip.appendChild(backBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tl-chip-close';
  closeBtn.title = 'Remove soft lock';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'REMOVE_SOFT_LOCK' }); } catch {}
    hideSoftLockChip();
    removeLockFavicon();
  });
  chip.appendChild(closeBtn);

  const el = document.createElement('div');
  el.id = '__tab-anchor-chip__';
  el.appendChild(chip);
  document.body.appendChild(el);
}

function hideSoftLockChip() {
  document.getElementById('__tab-anchor-chip__')?.remove();
}

// ============================================================
// Tab rename
// ============================================================

let _renameName = null;
let _renameObserver = null;

// Re-asserts the custom title whenever the page (e.g. an SPA router) overwrites it
function enforceRename() {
  if (_renameName && document.title !== _renameName) document.title = _renameName;
}

function applyRename(name) {
  if (name) {
    if (window.__tlOriginalTitle === undefined) {
      window.__tlOriginalTitle = document.title;
    }
    _renameName = name;
    enforceRename();
    if (!_renameObserver) {
      _renameObserver = new MutationObserver(enforceRename);
      _renameObserver.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
      });
    }
  } else {
    _renameName = null;
    _renameObserver?.disconnect();
    _renameObserver = null;
    if (window.__tlOriginalTitle !== undefined) {
      document.title = window.__tlOriginalTitle;
      window.__tlOriginalTitle = undefined;
    }
  }
}

function showRenameDialog() {
  document.getElementById('__tab-anchor-rename__')?.remove();
  const current = document.title;
  const el = document.createElement('div');
  el.id = '__tab-anchor-rename__';
  const renameDialog = document.createElement('div');
  renameDialog.className = 'tl-rename-dialog';

  const renameLabel = document.createElement('label');
  renameLabel.className = 'tl-rename-label';
  renameLabel.textContent = 'Rename tab';
  renameDialog.appendChild(renameLabel);

  const renameInput = document.createElement('input');
  renameInput.className = 'tl-rename-input';
  renameInput.id = 'tl-rename-input';
  renameInput.type = 'text';
  renameInput.value = current;
  renameInput.maxLength = 80;
  renameInput.autocomplete = 'off';
  renameDialog.appendChild(renameInput);

  const renameActions = document.createElement('div');
  renameActions.className = 'tl-rename-actions';
  const renameCancelBtn = document.createElement('button');
  renameCancelBtn.className = 'tl-rename-btn tl-rename-cancel';
  renameCancelBtn.id = 'tl-rename-cancel';
  renameCancelBtn.textContent = 'Cancel';
  renameActions.appendChild(renameCancelBtn);
  const renameConfirmBtn = document.createElement('button');
  renameConfirmBtn.className = 'tl-rename-btn tl-rename-confirm';
  renameConfirmBtn.id = 'tl-rename-confirm';
  renameConfirmBtn.textContent = 'Save';
  renameActions.appendChild(renameConfirmBtn);

  renameDialog.appendChild(renameActions);
  el.appendChild(renameDialog);
  document.body.appendChild(el);
  const input = el.querySelector('#tl-rename-input');
  input.focus();
  input.select();
  const close = () => el.remove();
  el.querySelector('#tl-rename-cancel').addEventListener('click', close);
  el.querySelector('#tl-rename-confirm').addEventListener('click', async () => {
    const name = input.value.trim();
    if (name) {
      try { await chrome.runtime.sendMessage({ type: 'SET_RENAME', name }); } catch {}
      applyRename(name);
    }
    close();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') el.querySelector('#tl-rename-confirm').click();
    if (e.key === 'Escape') close();
  });
  // Close on backdrop click
  el.addEventListener('click', e => { if (e.target === el) close(); });
}

// ============================================================
// Utility
// ============================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
