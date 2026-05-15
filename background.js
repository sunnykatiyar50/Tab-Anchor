// ============================================================
// Storage helpers — always read from storage, never cache.
// Service workers can be killed at any time.
// ============================================================

async function getLockData(tabId) {
  const { lockedTabs = {} } = await chrome.storage.local.get('lockedTabs');
  const data = lockedTabs[String(tabId)];
  if (!data) return null;
  if (!data.mode) data.mode = 'hard'; // migrate entries stored before the mode field existed
  return data;
}

async function setLockData(tabId, data) {
  const { lockedTabs = {} } = await chrome.storage.local.get('lockedTabs');
  lockedTabs[String(tabId)] = data;
  await chrome.storage.local.set({ lockedTabs });
}

async function lockTab(tabId, url, mode = 'hard', pageTitle = null) {
  let groupId = -1; // TAB_GROUP_ID_NONE
  let groupInfo = null;
  if (chrome.tabGroups) {
    try {
      const tab = await chrome.tabs.get(tabId);
      groupId = tab.groupId ?? -1;
      if (groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const group = await chrome.tabGroups.get(groupId);
        groupInfo = { color: group.color, title: group.title || '' };
      }
    } catch {}
  }
  const historyId = await addHistoryEntry({ url, mode, pageTitle, groupInfo });
  await setLockData(tabId, { lockedUrl: url, attemptedUrl: null, mode, rename: null, groupId, groupInfo, historyId });
}

async function unlockTab(tabId) {
  const { lockedTabs = {} } = await chrome.storage.local.get('lockedTabs');
  const lockData = lockedTabs[String(tabId)];
  if (!lockData) return;
  await updateHistoryEntry(lockData.historyId, { unlockedAt: Date.now() });
  delete lockedTabs[String(tabId)];
  await chrome.storage.local.set({ lockedTabs });
  try {
    await chrome.tabs.sendMessage(Number(tabId), { type: 'HIDE_OVERLAY' });
  } catch { /* tab may be gone or on a restricted page */ }
}

async function setAttemptedUrl(tabId, url) {
  const lockData = await getLockData(tabId);
  if (!lockData) return;
  lockData.attemptedUrl = url;
  await setLockData(tabId, lockData);
}

async function isTabLocked(tabId) {
  return !!(await getLockData(tabId));
}

// ============================================================
// Tab history — persistent log of every lock/unlock session
// ============================================================

const HISTORY_LIMIT = 1000;

function generateId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

async function addHistoryEntry({ url, mode, pageTitle, groupInfo }) {
  const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
  const entry = {
    id: generateId(),
    url,
    pageTitle: pageTitle || null,
    rename: null,
    mode,
    groupInfo: groupInfo || null,
    lockedAt: Date.now(),
    unlockedAt: null,
  };
  tabHistory.unshift(entry);
  if (tabHistory.length > HISTORY_LIMIT) tabHistory.length = HISTORY_LIMIT;
  await chrome.storage.local.set({ tabHistory });
  return entry.id;
}

async function updateHistoryEntry(historyId, updates) {
  if (!historyId) return;
  const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
  const idx = tabHistory.findIndex(e => e.id === historyId);
  if (idx !== -1) {
    Object.assign(tabHistory[idx], updates);
    await chrome.storage.local.set({ tabHistory });
  }
}

// ============================================================
// URL helpers
// ============================================================

// Strip hash fragment for comparison — allows in-page anchor navigation.
// The redirect always uses the raw lockedUrl (with hash) to restore position.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

function isLockableUrl(url) {
  return /^(https?|file):\/\//.test(url ?? '');
}

// ============================================================
// Icon drawing — used for both toolbar icon and favicon overlay
// ============================================================

function drawLockIcon(ctx, size, state) {
  const s = size;
  const isLocked = state === 'locked';
  const isSoft   = state === 'soft';
  const bodyColor    = isLocked ? '#F59E0B' : isSoft ? '#FCD34D' : '#22D3EE';
  const shackleColor = isLocked ? '#B45309' : isSoft ? '#F59E0B' : '#0891B2';
  const keyholeColor = isLocked ? '#92400E' : isSoft ? '#D97706' : '#0E7490';

  ctx.clearRect(0, 0, s, s);

  // Drop shadow — keeps the icon readable on light toolbars
  ctx.shadowColor   = 'rgba(0,0,0,0.30)';
  ctx.shadowBlur    = s * 0.12;
  ctx.shadowOffsetY = s * 0.04;

  // Lock body
  const bw = s * 0.68;
  const bh = s * 0.50;
  const bx = (s - bw) / 2;
  const by = s * 0.44;
  const br = s * 0.09;
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, br);
  ctx.fill();

  ctx.shadowColor = 'transparent'; // clear shadow before detail layers

  // Keyhole
  ctx.fillStyle = keyholeColor;
  const kr = bw * 0.12;
  const kx = s / 2;
  const ky = by + bh * 0.38;
  ctx.beginPath();
  ctx.arc(kx, ky, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(kx - kr * 0.65, ky, kr * 1.3, bh * 0.32);

  // Shackle
  const sw = bw * 0.52;
  const sh = s * 0.38;
  const sy = by + s * 0.02;
  ctx.strokeStyle = shackleColor;
  ctx.lineWidth = Math.max(2, s * 0.10);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s / 2 - sw / 2, sy);
  ctx.lineTo(s / 2 - sw / 2, sy - sh * 0.55);
  ctx.arc(s / 2, sy - sh * 0.55, sw / 2, Math.PI, 0);
  if (isLocked) {
    ctx.lineTo(s / 2 + sw / 2, sy);
  } else {
    ctx.lineTo(s / 2 + sw / 2, sy - sh * 0.40);
  }
  ctx.stroke();
}

// ============================================================
// Toolbar icon — set per-tab via OffscreenCanvas
// ============================================================

async function updateToolbarIcon(tabId) {
  try {
    const lockData = await getLockData(tabId);
    const state = lockData?.mode === 'hard' ? 'locked'
                : lockData?.mode === 'soft' ? 'soft'
                : 'unlocked';
    const imageData = {};
    for (const size of [16, 32, 48, 128]) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');
      drawLockIcon(ctx, size, state);
      imageData[size] = ctx.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData, tabId });
    await chrome.action.setTitle({
      title: state === 'locked' ? 'Tab Anchor — Hard locked (click to unlock)'
           : state === 'soft'   ? 'Tab Anchor — Soft locked (click for hard lock)'
           : 'Tab Anchor — click to lock this tab',
      tabId
    });
  } catch { /* tab may be closed or on a restricted page */ }
}

// ============================================================
// Favicon lock overlay — composites a lock badge onto the
// page's existing favicon and returns it as a data URL.
// Called by the GET_FAVICON_DATA message handler.
// ============================================================

const _faviconCache = new Map();

async function generateLockedFavicon(originalFaviconUrl) {
  if (originalFaviconUrl && _faviconCache.has(originalFaviconUrl)) {
    return _faviconCache.get(originalFaviconUrl);
  }

  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Draw the original favicon, or a neutral placeholder on failure
  if (originalFaviconUrl) {
    try {
      const response = await fetch(originalFaviconUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0, size, size);
    } catch {
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, size, size);
    }
  } else {
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, size, size);
  }

  // Semi-transparent dark backdrop for the badge (bottom-right 18×18)
  const bs = 18;
  const bx = size - bs;
  const by = size - bs;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(bx + bs / 2, by + bs / 2, bs / 2, 0, Math.PI * 2);
  ctx.fill();

  // Mini lock body
  ctx.fillStyle = '#FFD54F';
  ctx.beginPath();
  ctx.roundRect(bx + 3.5, by + 8.5, 11, 8, 2);
  ctx.fill();

  // Mini shackle
  ctx.strokeStyle = '#FFB300';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(bx + 9, by + 8.5, 4, Math.PI, 0);
  ctx.stroke();

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  if (originalFaviconUrl) _faviconCache.set(originalFaviconUrl, dataUrl);
  return dataUrl;
}

// Tell the content script to apply or remove the favicon overlay.
async function notifyFaviconState(tabId) {
  try {
    const lockData = await getLockData(tabId);
    if (lockData) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      await chrome.tabs.sendMessage(tabId, {
        type: 'APPLY_LOCK_FAVICON',
        mode: lockData.mode,
        favIconUrl: tab?.favIconUrl || null,
      });
    } else {
      await chrome.tabs.sendMessage(tabId, { type: 'REMOVE_LOCK_FAVICON' });
    }
  } catch { /* content script not available on this tab */ }
}

// ============================================================
// Context menu
// ============================================================

// "tab" context (right-click on tab strip) is Firefox-only.
// Chrome validates context values in its bindings layer before JS can catch
// the error, so we must branch before calling contextMenus.create.
const IS_FIREFOX = navigator.userAgent.includes('Firefox');

function setupContextMenus() {
  // Chrome supports 'action' (extension icon right-click); Firefox does not.
  // Firefox supports 'tab' (tab-strip right-click); Chrome validates against
  // the bindings layer before JS can catch it, so we must branch.
  const contexts = IS_FIREFOX ? ['page', 'tab'] : ['page', 'action'];
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'toggleLock',     title: 'Lock Tab',          contexts });
    chrome.contextMenus.create({ id: 'toggleSoftLock', title: 'Soft Lock Tab',     contexts });
    chrome.contextMenus.create({ id: 'goToPinnedUrl',  title: 'Go to Pinned URL',  contexts, enabled: false });
    chrome.contextMenus.create({ id: 'renameTab',      title: 'Rename Tab',        contexts });
    chrome.contextMenus.create({ id: 'sep-history',    type: 'separator',          contexts });
    chrome.contextMenus.create({ id: 'openHistory',    title: 'Tab History',       contexts });
  });
}

async function updateContextMenuTitles(tabId) {
  try {
    const lockData = await getLockData(tabId);
    chrome.contextMenus.update('toggleLock',     { title: lockData?.mode === 'hard' ? 'Unlock Tab'       : 'Lock Tab'      });
    chrome.contextMenus.update('toggleSoftLock', { title: lockData?.mode === 'soft' ? 'Remove Soft Lock' : 'Soft Lock Tab' });
    chrome.contextMenus.update('goToPinnedUrl',  { enabled: !!lockData?.lockedUrl });
    chrome.contextMenus.update('renameTab',      { title: lockData?.rename          ? 'Clear Tab Name'  : 'Rename Tab'    });
  } catch { /* context menus may not be ready yet */ }
}

// ============================================================
// Core toggle — shared by icon click and context menu
// ============================================================

async function toggleLock(tabId, url, pageTitle = null) {
  const lockData = await getLockData(tabId);
  if (lockData?.mode === 'hard') {
    await unlockTab(tabId);
  } else {
    if (lockData) await unlockTab(tabId); // remove soft lock before applying hard lock
    await lockTab(tabId, url, 'hard', pageTitle);
  }
  await updateToolbarIcon(tabId);
  await notifyFaviconState(tabId);
  await updateContextMenuTitles(tabId);
}

// ============================================================
// Startup reconciliation — handles cases where the service
// worker was killed while tabs were still locked.
// ============================================================

async function reconcileLockedTabs() {
  const { lockedTabs = {} } = await chrome.storage.local.get('lockedTabs');
  const updated = { ...lockedTabs };

  for (const [tabIdStr, lockData] of Object.entries(lockedTabs)) {
    const tabId = Number(tabIdStr);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (normalizeUrl(tab.url) !== normalizeUrl(lockData.lockedUrl)) {
        updated[tabIdStr] = { ...lockData, attemptedUrl: tab.url };
        chrome.tabs.update(tabId, { url: lockData.lockedUrl }).catch(() => {});
      }
    } catch {
      // Tab no longer exists
      delete updated[tabIdStr];
    }
  }

  await chrome.storage.local.set({ lockedTabs: updated });
}

async function updateAllTabIcons() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null) await updateToolbarIcon(tab.id);
  }
}

// ============================================================
// Event listeners
// ============================================================

chrome.runtime.onInstalled.addListener(async () => {
  setupContextMenus();
  await updateAllTabIcons();
});

chrome.runtime.onStartup.addListener(async () => {
  setupContextMenus();
  await reconcileLockedTabs();
  await updateAllTabIcons();
});

// Icon click cycles: unlocked → soft lock → hard lock → unlocked
chrome.action.onClicked.addListener(async (tab) => {
  if (!isLockableUrl(tab.url)) return;
  const lockData = await getLockData(tab.id);
  console.log('[TabAnchor] icon click, mode=', lockData?.mode ?? 'none');

  if (!lockData) {
    console.log('[TabAnchor] → soft locking');
    await lockTab(tab.id, tab.url, 'soft', tab.title);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_SOFT_CHIP', lockedUrl: tab.url, atHome: true });
    } catch {}
  } else if (lockData.mode === 'soft') {
    console.log('[TabAnchor] → switching to hard');
    await unlockTab(tab.id);
    await lockTab(tab.id, tab.url, 'hard', tab.title);
  } else {
    console.log('[TabAnchor] → unlocking (was hard)');
    await unlockTab(tab.id); // hard → unlocked
  }

  await updateToolbarIcon(tab.id);
  await notifyFaviconState(tab.id);
  await updateContextMenuTitles(tab.id);
});

// Right-click tab strip menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'openHistory') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (!isLockableUrl(tab.url)) return;

  if (info.menuItemId === 'toggleLock') {
    await toggleLock(tab.id, tab.url, tab.title);

  } else if (info.menuItemId === 'toggleSoftLock') {
    const lockData = await getLockData(tab.id);
    if (lockData?.mode === 'soft') {
      await unlockTab(tab.id); // unlockTab sends HIDE_OVERLAY which hides the chip
    } else {
      if (lockData) await unlockTab(tab.id); // remove any existing hard lock first
      await lockTab(tab.id, tab.url, 'soft', tab.title);
      // Page is already loaded — show the chip immediately without waiting for a page event
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_SOFT_CHIP',
          lockedUrl: tab.url,
          atHome: true
        });
      } catch {}
    }
    await updateToolbarIcon(tab.id);
    await notifyFaviconState(tab.id);
    await updateContextMenuTitles(tab.id);

  } else if (info.menuItemId === 'goToPinnedUrl') {
    const lockData = await getLockData(tab.id);
    if (lockData?.lockedUrl) chrome.tabs.update(tab.id, { url: lockData.lockedUrl });

  } else if (info.menuItemId === 'renameTab') {
    let lockData = await getLockData(tab.id);
    if (!lockData) {
      await lockTab(tab.id, tab.url, 'hard', tab.title);
      await updateToolbarIcon(tab.id);
      await notifyFaviconState(tab.id);
      lockData = await getLockData(tab.id);
    }
    if (lockData.rename) {
      lockData.rename = null;
      await setLockData(tab.id, lockData);
      try { await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_RENAME', name: null }); } catch {}
    } else {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_RENAME_DIALOG' }); } catch {}
    }
    await updateContextMenuTitles(tab.id);
  }
});

// Update toolbar icon and menu titles whenever the active tab changes
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateToolbarIcon(tabId);
  await updateContextMenuTitles(tabId);
});

// Navigation interception — the core of the extension
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Sync group membership whenever a locked tab is moved in/out of a group
  if (chrome.tabGroups && 'groupId' in changeInfo) {
    const lockData = await getLockData(tabId);
    if (lockData) {
      lockData.groupId = changeInfo.groupId;
      lockData.groupInfo = null;
      if (changeInfo.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        try {
          const group = await chrome.tabGroups.get(changeInfo.groupId);
          lockData.groupInfo = { color: group.color, title: group.title || '' };
        } catch {}
      }
      await setLockData(tabId, lockData);
    }
  }

  // Phase 1 — URL is changing: intercept if the tab is hard-locked
  if (changeInfo.url) {
    const lockData = await getLockData(tabId);
    if (!lockData) return;
    // Allow navigation if the URL (ignoring hash) matches the lock target
    if (normalizeUrl(changeInfo.url) === normalizeUrl(lockData.lockedUrl)) return;
    console.log('[TabAnchor] Phase1 intercept', { tabId, mode: lockData.mode, url: changeInfo.url });
    if (lockData.mode === 'hard') {
      const { settings = {} } = await chrome.storage.local.get('settings');
      const linkBehavior = settings.linkBehavior ?? 'block';

      if (linkBehavior === 'block') {
        // Redirect the locked tab back to its pinned URL
        chrome.tabs.update(tabId, { url: lockData.lockedUrl }).catch(() => {});
        // Record the attempted URL and show warning banner
        await setAttemptedUrl(tabId, changeInfo.url);
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_WARNING',
            attemptedUrl: changeInfo.url,
            lockedUrl: lockData.lockedUrl
          });
          console.log('[TabAnchor] Phase1 SHOW_WARNING sent');
        } catch (e) {
          console.log('[TabAnchor] Phase1 SHOW_WARNING failed (will rely on Phase2/onLoad)', e?.message);
        }
      } else {
        // Open the link in a new tab instead of blocking
        try {
          const newTab = await chrome.tabs.create({
            url: changeInfo.url,
            windowId: tab.windowId,
            index: tab.index + 1,
          });
          if (
            linkBehavior === 'new-tab-same-group' &&
            chrome.tabGroups &&
            lockData.groupId != null &&
            lockData.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
          ) {
            try { await chrome.tabs.group({ tabIds: [newTab.id], groupId: lockData.groupId }); } catch {}
          }
        } catch {}
      }
    }
    // Soft lock: allow navigation freely — chip is updated in Phase 2
    return;
  }

  // Phase 2 — Page fully loaded
  if (changeInfo.status === 'complete') {
    const lockData = await getLockData(tabId);
    if (!lockData) return;
    console.log('[TabAnchor] Phase2 complete', { tabId, mode: lockData.mode, attemptedUrl: lockData.attemptedUrl });
    // Keep the toolbar icon in sync (catches tabs loaded before activation)
    await updateToolbarIcon(tabId);
    // Notify the user if this tab was just recreated after being closed
    if (lockData.showCloseWarning) {
      lockData.showCloseWarning = false;
      await setLockData(tabId, lockData);
      try { await chrome.tabs.sendMessage(tabId, { type: 'SHOW_CLOSE_WARNING' }); } catch {}
    }
    if (lockData.mode === 'hard' && lockData.attemptedUrl) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_WARNING',
          attemptedUrl: lockData.attemptedUrl,
          lockedUrl: lockData.lockedUrl
        });
        console.log('[TabAnchor] Phase2 SHOW_WARNING sent');
      } catch (e) {
        console.log('[TabAnchor] Phase2 SHOW_WARNING failed', e?.message);
      }
    } else if (lockData.mode === 'soft') {
      const atHome = normalizeUrl(tab.url) === normalizeUrl(lockData.lockedUrl);
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_SOFT_CHIP',
          lockedUrl: lockData.lockedUrl,
          atHome
        });
      } catch {}
    }
    if (lockData.rename) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'APPLY_RENAME', name: lockData.rename });
      } catch {}
    }
  }
});

// When a tab is closed, clean up state.
// For locked tabs (hard or soft), reopen the tab at the pinned URL (unless the whole window is closing).
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const { lockedTabs = {} } = await chrome.storage.local.get('lockedTabs');
  const lockData = lockedTabs[String(tabId)];
  if (!lockData) return;

  delete lockedTabs[String(tabId)];
  await chrome.storage.local.set({ lockedTabs });

  if (removeInfo.isWindowClosing) return;

  try {
    const newTab = await chrome.tabs.create({ url: lockData.lockedUrl, windowId: removeInfo.windowId });
    await lockTab(newTab.id, lockData.lockedUrl, lockData.mode);

    // Restore rename and group into the new lock entry
    const ld = await getLockData(newTab.id);
    if (lockData.rename) ld.rename = lockData.rename;
    ld.showCloseWarning = true;

    if (chrome.tabGroups && lockData.groupId != null && lockData.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      try {
        // Group still exists — add the new tab to it
        await chrome.tabs.group({ tabIds: [newTab.id], groupId: lockData.groupId });
        ld.groupId = lockData.groupId;
        ld.groupInfo = lockData.groupInfo;
      } catch {
        // Group was deleted (last tab in it) — recreate with same colour/title
        const newGroupId = await chrome.tabs.group({ tabIds: [newTab.id] });
        if (lockData.groupInfo) {
          await chrome.tabGroups.update(newGroupId, {
            color: lockData.groupInfo.color,
            title: lockData.groupInfo.title,
          });
        }
        ld.groupId = newGroupId;
        ld.groupInfo = lockData.groupInfo;
      }
    }

    await setLockData(newTab.id, ld);
    await updateToolbarIcon(newTab.id);
    await updateContextMenuTitles(newTab.id);
  } catch { /* window may have already closed */ }
});

// ============================================================
// Message handler — from content.js
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ error: true }));
  return true; // keep message channel open for async response
});

async function handleMessage(msg, sender) {
  const senderTabId = sender.tab?.id;

  switch (msg.type) {
    case 'GET_LOCK_STATUS': {
      const tabId = msg.tabId ?? senderTabId;
      const lockData = await getLockData(tabId);
      const tab = lockData ? await chrome.tabs.get(tabId).catch(() => null) : null;
      return {
        locked: !!lockData,
        mode: lockData?.mode ?? null,
        lockedUrl: lockData?.lockedUrl ?? null,
        attemptedUrl: lockData?.attemptedUrl ?? null,
        rename: lockData?.rename ?? null,
        favIconUrl: tab?.favIconUrl || null,
      };
    }

    case 'UNLOCK_AND_CONTINUE': {
      const lockData = await getLockData(senderTabId);
      const target = lockData?.attemptedUrl;
      await unlockTab(senderTabId);
      await updateToolbarIcon(senderTabId);
      await updateContextMenuTitles(senderTabId);
      if (target) chrome.tabs.update(senderTabId, { url: target });
      return { ok: true };
    }

    case 'DISMISS_WARNING': {
      await setAttemptedUrl(senderTabId, null);
      return { ok: true };
    }

    case 'GET_FAVICON_DATA': {
      const dataUrl = await generateLockedFavicon(msg.originalFaviconUrl ?? null);
      return { faviconDataUrl: dataUrl };
    }

    case 'SET_RENAME': {
      const lockData = await getLockData(senderTabId);
      if (!lockData) return { ok: false };
      lockData.rename = msg.name || null;
      await setLockData(senderTabId, lockData);
      await updateHistoryEntry(lockData.historyId, { rename: lockData.rename });
      await updateContextMenuTitles(senderTabId);
      return { ok: true };
    }

    case 'GO_BACK_TO_LOCKED': {
      const lockData = await getLockData(senderTabId);
      if (lockData?.lockedUrl) chrome.tabs.update(senderTabId, { url: lockData.lockedUrl });
      return { ok: true };
    }

    case 'REMOVE_SOFT_LOCK': {
      await unlockTab(senderTabId);
      await updateToolbarIcon(senderTabId);
      await updateContextMenuTitles(senderTabId);
      return { ok: true };
    }
  }

  return { ok: false };
}
