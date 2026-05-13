'use strict';

const LIMIT = 1000;
let allEntries = [];
let query = '';

// ── Theme ─────────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');

  const theme = settings.theme ?? 'system';
  applyTheme(theme);
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === theme);
    card.querySelector('input').checked = card.dataset.value === theme;
  });

  const showBanners = settings.showBanners !== false;
  const showChip    = settings.showChip    !== false;
  document.getElementById('toggle-banners').checked = showBanners;
  document.getElementById('toggle-chip').checked    = showChip;
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark')       root.dataset.theme = 'dark';
  else if (theme === 'light') root.dataset.theme = 'light';
  else                        delete root.dataset.theme; // 'system' → OS preference
}

async function saveSetting(key, value) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings[key] = value;
  await chrome.storage.local.set({ settings });
}

async function saveTheme(theme) {
  await saveSetting('theme', theme);
  applyTheme(theme);
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.value === theme);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const SUBTITLES = { history: 'Locked Tab History', settings: 'Settings' };

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.querySelectorAll('.pane').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== `pane-${name}`);
  });
  document.getElementById('history-toolbar').classList.toggle('hidden', name !== 'history');
  document.getElementById('header-subtitle').textContent = SUBTITLES[name] ?? '';
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
  allEntries = tabHistory;
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('tabHistory' in changes) { allEntries = changes.tabHistory.newValue ?? []; render(); }
  if ('settings'   in changes) {
    const theme = changes.settings.newValue?.theme ?? 'system';
    applyTheme(theme);
  }
});

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const q = query.trim().toLowerCase();
  const rows = q
    ? allEntries.filter(e =>
        e.url.toLowerCase().includes(q) ||
        (e.rename    ?? '').toLowerCase().includes(q) ||
        (e.pageTitle ?? '').toLowerCase().includes(q) ||
        (e.groupInfo?.title ?? '').toLowerCase().includes(q)
      )
    : allEntries;

  const empty = document.getElementById('empty');
  const tbl   = document.getElementById('tbl');
  const tbody = document.getElementById('tbody');
  const stats = document.getElementById('stats');

  if (allEntries.length > 0) {
    const active = allEntries.filter(e => !e.unlockedAt).length;
    document.getElementById('stat-total').textContent =
      `${allEntries.length} entr${allEntries.length === 1 ? 'y' : 'ies'}`;
    const activeEl = document.getElementById('stat-active');
    activeEl.textContent = active > 0 ? `${active} active` : '';
    activeEl.className   = active > 0 ? 'stat-active' : '';
    stats.classList.remove('hidden');
  } else {
    stats.classList.add('hidden');
  }

  if (rows.length === 0) {
    tbl.classList.add('hidden');
    empty.classList.remove('hidden');
    document.getElementById('empty-msg').textContent = allEntries.length === 0
      ? 'No history yet. Lock a tab to start tracking.'
      : 'No entries match your filter.';
    return;
  }

  tbl.classList.remove('hidden');
  empty.classList.add('hidden');
  tbody.innerHTML = '';
  for (const entry of rows) tbody.appendChild(buildRow(entry));
}

function buildRow(entry) {
  const tr = document.createElement('tr');
  if (!entry.unlockedAt) tr.classList.add('row-active');

  // Site
  const siteTd = document.createElement('td');
  siteTd.className = 'col-site';
  let host = '';
  try { host = new URL(entry.url).hostname.replace(/^www\./, ''); } catch {}
  siteTd.innerHTML = `
    <div class="site-cell">
      <span class="site-host">${esc(host)}</span>
      ${entry.pageTitle ? `<span class="site-title">${esc(entry.pageTitle)}</span>` : ''}
      <span class="site-url" title="${esc(entry.url)}">${esc(entry.url)}</span>
    </div>`;

  // Custom name
  const nameTd = document.createElement('td');
  nameTd.className = 'col-name';
  nameTd.innerHTML = entry.rename
    ? `<span class="name-tag">${esc(entry.rename)}</span>`
    : `<span class="empty-val">—</span>`;

  // Mode
  const modeTd = document.createElement('td');
  modeTd.className = 'col-mode';
  modeTd.innerHTML = `<span class="mode-badge mode-${entry.mode}">${entry.mode === 'hard' ? 'Hard' : 'Soft'}</span>`;

  // Group
  const groupTd = document.createElement('td');
  groupTd.className = 'col-group';
  if (entry.groupInfo) {
    groupTd.innerHTML = `<span class="group-tag">
      <span class="group-dot" style="background:${groupColor(entry.groupInfo.color)}"></span>
      ${esc(entry.groupInfo.title || 'Group')}
    </span>`;
  } else {
    groupTd.innerHTML = `<span class="empty-val">—</span>`;
  }

  // Locked at
  const lockedTd = document.createElement('td');
  lockedTd.className = 'col-time';
  lockedTd.innerHTML = `<span title="${fmtFull(entry.lockedAt)}">${fmtRel(entry.lockedAt)}</span>`;

  // Unlocked at
  const unlockedTd = document.createElement('td');
  unlockedTd.className = 'col-time';
  unlockedTd.innerHTML = entry.unlockedAt
    ? `<span title="${fmtFull(entry.unlockedAt)}">${fmtRel(entry.unlockedAt)}</span>`
    : `<span class="active-badge">Active</span>`;

  // Delete
  const actionsTd = document.createElement('td');
  actionsTd.className = 'col-actions';
  const del = document.createElement('button');
  del.className = 'btn-del';
  del.title = 'Delete entry';
  del.textContent = '×';
  del.addEventListener('click', () => deleteEntry(entry.id));
  actionsTd.appendChild(del);

  tr.append(siteTd, nameTd, modeTd, groupTd, lockedTd, unlockedTd, actionsTd);
  return tr;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function deleteEntry(id) {
  const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
  await chrome.storage.local.set({ tabHistory: tabHistory.filter(e => e.id !== id) });
  toast('Entry deleted');
}

async function clearAll() {
  const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
  const active   = tabHistory.filter(e => !e.unlockedAt);
  const toDelete = tabHistory.filter(e =>  e.unlockedAt);
  if (toDelete.length === 0) { toast('Nothing to clear — all entries are active'); return; }
  if (!confirm(`Delete ${toDelete.length} closed session${toDelete.length === 1 ? '' : 's'}? Active locks will not be affected.`)) return;
  await chrome.storage.local.set({ tabHistory: active });
  toast(`Cleared ${toDelete.length} entr${toDelete.length === 1 ? 'y' : 'ies'}`);
}

function exportData() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), entries: allEntries };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `tab-anchor-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
}

async function importData(file) {
  try {
    const raw      = JSON.parse(await file.text());
    const incoming = Array.isArray(raw) ? raw : (raw.entries ?? []);
    if (!Array.isArray(incoming)) throw new Error('bad format');
    const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
    const existing = new Set(tabHistory.map(e => e.id));
    const added    = incoming.filter(e => e?.id && e?.url && !existing.has(e.id));
    const merged   = [...added, ...tabHistory].slice(0, LIMIT);
    await chrome.storage.local.set({ tabHistory: merged });
    toast(`Imported ${added.length} new ${added.length === 1 ? 'entry' : 'entries'}`);
  } catch {
    toast('Import failed — invalid file', true);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupColor(name) {
  return {
    grey: '#9e9e9e', blue: '#4285f4', red: '#ea4335', yellow: '#fbbc04',
    green: '#34a853', pink: '#f472b6', purple: '#9c27b0', cyan: '#22d3ee',
    orange: '#f97316',
  }[name] ?? '#9e9e9e';
}

function fmtRel(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtFull(ts) { return new Date(ts).toLocaleString(); }

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => saveTheme(card.dataset.value));
});

document.getElementById('toggle-banners').addEventListener('change', e => saveSetting('showBanners', e.target.checked));
document.getElementById('toggle-chip').addEventListener('change',    e => saveSetting('showChip',    e.target.checked));

document.getElementById('search').addEventListener('input', e => { query = e.target.value; render(); });
document.getElementById('btn-export').addEventListener('click', exportData);
document.getElementById('btn-clear').addEventListener('click', clearAll);
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});

loadSettings();
load();
