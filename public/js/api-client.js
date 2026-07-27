// ====================================================
// api-client.js - API Client
// All API calls go through the server (no direct browser-to-API calls)
// This ensures compatibility with hosted environments (no CORS issues)
// ====================================================

// ----------------------------------------
// SETTINGS (localStorage)
// ----------------------------------------

function getLocalSettings() {
  try {
    return JSON.parse(localStorage.getItem('brain_settings') || '{}');
  } catch { return {}; }
}

function saveLocalSettings(s) {
  localStorage.setItem('brain_settings', JSON.stringify(s));
}

function hasLocalSettings() {
  const s = getLocalSettings();
  return !!(s.notionApiKey && s.notionDatabaseId);
}

// ----------------------------------------
// SERVER DETECTION
// ----------------------------------------

let _serverStatus = null;
let _serverCheckTime = 0;
const SERVER_CHECK_TTL = 30000;

async function checkServer() {
  const now = Date.now();
  if (_serverStatus !== null && (now - _serverCheckTime) < SERVER_CHECK_TTL) {
    return _serverStatus;
  }
  try {
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    const data = JSON.parse(text);
    _serverStatus = (data.success === true);
  } catch {
    _serverStatus = false;
  }
  _serverCheckTime = now;
  return _serverStatus;
}

function resetServerStatus() {
  _serverStatus = null;
  _serverCheckTime = 0;
}

// ----------------------------------------
// SETTINGS SYNC
// On first load from a new device, fetch settings
// from the server and save to localStorage
// ----------------------------------------

async function syncSettingsFromServer() {
  try {
    const res = await fetch('/api/settings', { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    const data = JSON.parse(text);
    if (data.success && data.settings) {
      const s = data.settings;
      if (s.notionApiKey || s.notionDatabaseId) {
        const current = getLocalSettings();
        const merged = {
          notionApiKey: s.notionApiKey || current.notionApiKey || '',
          notionDatabaseId: s.notionDatabaseId || current.notionDatabaseId || '',
          aiApiKey: s.aiApiKey || current.aiApiKey || '',
          aiApiUrl: s.aiApiUrl || current.aiApiUrl || '',
          aiModel: s.aiModel || current.aiModel || '',
        };
        saveLocalSettings(merged);
        return true;
      }
    }
  } catch (e) {
    console.warn('Settings sync failed:', e.message);
  }
  return false;
}

// ----------------------------------------
// SETTINGS HEADERS
// Sends localStorage settings to the server via headers
// so the server can use them (server reads these as fallback)
// ----------------------------------------

function buildSettingsHeaders() {
  const s = getLocalSettings();
  const h = {};
  if (s.notionApiKey) h['X-Notion-Api-Key'] = s.notionApiKey;
  if (s.notionDatabaseId) h['X-Notion-Database-Id'] = s.notionDatabaseId;
  if (s.aiApiKey) h['X-Ai-Api-Key'] = s.aiApiKey;
  if (s.aiApiUrl) h['X-Ai-Api-Url'] = s.aiApiUrl;
  if (s.aiModel) h['X-Ai-Model'] = s.aiModel;
  return h;
}

// ----------------------------------------
// SMART FETCH
// All requests go through the server.
// If the server is down, shows a clear error message.
// ----------------------------------------

async function smartFetch(path, options = {}) {
  const serverUp = await checkServer();

  if (serverUp) {
    try {
      const mergedHeaders = { ...buildSettingsHeaders(), ...(options.headers || {}) };
      const res = await fetch(path, { ...options, headers: mergedHeaders });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('الخادم لم يُرجع بيانات صحيحة'); }
      return data;
    } catch (e) {
      console.warn('Server request failed:', e.message);
      resetServerStatus();
    }
  }

  throw new Error('الخادم غير متاح. يرجى التأكد من تشغيل الخادم والمحاولة مرة أخرى.');
}

// ----------------------------------------
// FORMAT NOTION PAGE (kept for compatibility)
// ----------------------------------------

function formatNotionPage(page) {
  const props = page.properties || {};

  let title = 'بدون عنوان';
  const titleProp = props.Name || props.Title || props.title || props['الاسم'] || props['العنوان'];
  if (titleProp?.title?.[0]?.plain_text) {
    title = titleProp.title[0].plain_text;
  } else if (titleProp?.rich_text?.[0]?.plain_text) {
    title = titleProp.rich_text[0].plain_text;
  }

  const getValue = (prop) => {
    if (!prop) return null;
    if (prop.type === 'select') return prop.select?.name;
    if (prop.type === 'multi_select') return prop.multi_select?.map(s => s.name);
    if (prop.type === 'rich_text') return prop.rich_text?.[0]?.plain_text;
    if (prop.type === 'date') return prop.date?.start;
    if (prop.type === 'checkbox') return prop.checkbox;
    if (prop.type === 'number') return prop.number;
    if (prop.type === 'url') return prop.url;
    return null;
  };

  const result = {
    id: page.id,
    title,
    url: page.url,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    icon: page.icon?.emoji || '💡',
    cover: page.cover?.external?.url || page.cover?.file?.url || null,
    category: null,
    tags: [],
    status: null,
    description: null,
  };

  for (const [key, value] of Object.entries(props)) {
    const keyLower = key.toLowerCase();
    const val = getValue(value);

    if (keyLower.includes('categor') || keyLower.includes('فئ') || keyLower === 'type' || keyLower === 'نوع') {
      result.category = val;
    } else if (keyLower.includes('tag') || keyLower.includes('وسم') || keyLower === 'labels') {
      result.tags = Array.isArray(val) ? val : (val ? [val] : []);
    } else if (keyLower.includes('status') || keyLower.includes('حال')) {
      result.status = val;
    } else if (keyLower.includes('desc') || keyLower.includes('وصف') || keyLower.includes('notes') || keyLower.includes('ملاحظ')) {
      result.description = val;
    }
  }

  return result;
}

// ----------------------------------------
// AUTO-SYNC ON PAGE LOAD
// When opening from a new device, fetch settings
// from the server and store them in localStorage
// ----------------------------------------

(async function initSettingsSync() {
  await syncSettingsFromServer();
})();
