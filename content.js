// Only run in the top-level frame — not in iframes
if (window === window.top) {
  initTabAnchor();
}

// Cached user preferences — loaded once on init, kept in sync via storage events
let _settings = { showBanners: true, showChip: true };
// Chip offsets from the viewport's bottom/right edges, shared across all tabs
let _chipPos = null;

async function loadContentSettings() {
  try {
    const { settings = {}, chipPosition = null } = await chrome.storage.local.get(['settings', 'chipPosition']);
    _chipPos = chipPosition;
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
    if ('chipPosition' in changes) {
      _chipPos = changes.chipPosition.newValue ?? null;
      const live = document.getElementById('__tab-anchor-chip__');
      if (live) applyChipPosition(live);
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHIP_ICONS = {
  lock:  ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z'],
  back:  ['M10 6l-6 6 6 6', 'M4 12h16'],
  unlock: ['M7 11V8a5 5 0 0 1 9.6-2', 'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z'],
};

function chipIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of CHIP_ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function showSoftLockChip(lockedUrl, atHome) {
  if (!_settings.showChip) return;
  hideSoftLockChip();

  const chip = document.createElement('div');
  chip.className = 'tl-chip';

  const icon = document.createElement('span');
  icon.className = 'tl-chip-icon';
  icon.appendChild(chipIcon('lock'));
  chip.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tl-chip-label';
  label.textContent = 'Pinned';
  chip.appendChild(label);

  if (!atHome) {
    const backBtn = document.createElement('button');
    backBtn.className = 'tl-chip-back';
    backBtn.title = 'Return to the pinned URL';
    backBtn.appendChild(chipIcon('back'));
    const text = document.createElement('span');
    text.textContent = 'Back to pinned';
    backBtn.appendChild(text);
    backBtn.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'GO_BACK_TO_LOCKED' }); } catch {}
    });
    chip.appendChild(backBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tl-chip-close';
  closeBtn.title = 'Unlock tab';
  closeBtn.setAttribute('aria-label', 'Unlock tab');
  closeBtn.appendChild(chipIcon('unlock'));
  closeBtn.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'REMOVE_SOFT_LOCK' }); } catch {}
    hideSoftLockChip();
    removeLockFavicon();
  });
  chip.appendChild(closeBtn);

  const el = document.createElement('div');
  el.id = '__tab-anchor-chip__';
  el.appendChild(chip);
  applyChipPosition(el);
  makeChipDraggable(el);
  document.body.appendChild(el);
}

function clampChipPosition(el, right, bottom) {
  const maxRight  = Math.max(0, document.documentElement.clientWidth  - el.offsetWidth);
  const maxBottom = Math.max(0, document.documentElement.clientHeight - el.offsetHeight);
  return {
    right:  Math.min(Math.max(0, right),  maxRight),
    bottom: Math.min(Math.max(0, bottom), maxBottom),
  };
}

function applyChipPosition(el) {
  if (!_chipPos) return;
  const { right, bottom } = clampChipPosition(el, _chipPos.right, _chipPos.bottom);
  el.style.right  = right + 'px';
  el.style.bottom = bottom + 'px';
}

function makeChipDraggable(el) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    el.setPointerCapture(e.pointerId);
    el.classList.add('tl-dragging');

    const onMove = (ev) => {
      const left = ev.clientX - offX;
      const top  = ev.clientY - offY;
      const pos = clampChipPosition(
        el,
        document.documentElement.clientWidth  - left - el.offsetWidth,
        document.documentElement.clientHeight - top  - el.offsetHeight
      );
      _chipPos = pos;
      el.style.right  = pos.right + 'px';
      el.style.bottom = pos.bottom + 'px';
    };
    const onUp = () => {
      el.classList.remove('tl-dragging');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      try { chrome.storage.local.set({ chipPosition: _chipPos }); } catch {}
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
  window.addEventListener('resize', () => {
    if (el.isConnected) applyChipPosition(el);
  });
}

function hideSoftLockChip() {
  document.getElementById('__tab-anchor-chip__')?.remove();
}

// ============================================================
// Tab rename
// ============================================================

function applyRename(name) {
  if (name) {
    if (window.__tlOriginalTitle === undefined) {
      window.__tlOriginalTitle = document.title;
    }
    document.title = name;
  } else if (window.__tlOriginalTitle !== undefined) {
    document.title = window.__tlOriginalTitle;
    window.__tlOriginalTitle = undefined;
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
