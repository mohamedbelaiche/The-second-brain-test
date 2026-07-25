// ====================================================
// app.js - Dashboard Logic
// ====================================================

let allIdeas = [];
let currentEditId = null;
let dbCategories = [];

// ----------------------------------------
// SIDEBAR TOGGLE (Mobile)
// ----------------------------------------

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
  document.body.classList.toggle('sidebar-open');
}

// ----------------------------------------
// INIT
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  loadSchema();
  loadIdeas();
});

async function loadSchema() {
  try {
    const data = await smartFetch('/api/schema');
    if (data.success && data.schema['الفئة']?.select?.options) {
      dbCategories = data.schema['الفئة'].select.options.map(o => o.name);
      
      const newCatSelect = document.getElementById('new-category');
      if (newCatSelect) {
        newCatSelect.innerHTML = '<option value="">بدون فئة</option>' + 
          dbCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      }
    }
  } catch(e) { console.error('Failed to load schema', e); }
}

// ----------------------------------------
// LOAD IDEAS
// ----------------------------------------

async function loadIdeas() {
  const grid = document.getElementById('ideas-grid');
  grid.innerHTML = `
    <div class="empty-state" id="loading-state" style="grid-column:1/-1;">
      <div class="spinner" style="margin:0 auto 20px;"></div>
      <div class="empty-title">جارٍ تحميل الأفكار من Notion...</div>
    </div>`;

  try {
    const data = await smartFetch('/api/ideas');

    if (!data.success) throw new Error(data.error || 'خطأ في التحميل');

    allIdeas = data.ideas;
    updateStats(allIdeas);
    renderIdeas(allIdeas);
    populateCategoryFilter(allIdeas);
    updateConnectionStatus(true);
    showToast('✅ تم تحميل ' + allIdeas.length + ' فكرة من Notion', 'success');
  } catch (err) {
    console.error(err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-icon">⚠️</span>
        <div class="empty-title">تعذّر الاتصال بـ Notion</div>
        <div class="empty-desc" style="color:var(--accent-rose);">${err.message}</div>
        <div class="empty-desc" style="margin-top:12px;">تأكد من صحة API Key و Database ID في الإعدادات</div>
        <button class="btn btn-secondary" style="margin-top:16px;" onclick="loadIdeas()">🔄 إعادة المحاولة</button>
      </div>`;
    updateConnectionStatus(false);
    showToast('❌ فشل الاتصال بـ Notion', 'error');
  }
}

// ----------------------------------------
// STATS
// ----------------------------------------

function updateStats(ideas) {
  const total = ideas.length;
  const categories = new Set(ideas.map(i => i.category).filter(Boolean));
  const tags = new Set(ideas.flatMap(i => i.tags || []).filter(Boolean));
  
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayUpdates = ideas.filter(i => {
    const d = new Date(i.updatedAt);
    return d >= today;
  }).length;

  animateCount('stat-total', total);
  animateCount('stat-categories', categories.size);
  animateCount('stat-tags', tags.size);
  animateCount('stat-today', todayUpdates);
  document.getElementById('ideas-count').textContent = total;
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const step = Math.ceil(target / 30);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current;
    if (current >= target) clearInterval(timer);
  }, 30);
}

// ----------------------------------------
// RENDER IDEAS
// ----------------------------------------

function renderIdeas(ideas) {
  const grid = document.getElementById('ideas-grid');
  
  if (!ideas.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-icon">💭</span>
        <div class="empty-title">لا توجد أفكار بعد</div>
        <div class="empty-desc">ابدأ بإضافة أول فكرة في قاعدة معرفتك</div>
        <button class="btn btn-primary" style="margin-top:20px;" onclick="openAddModal()">✨ إضافة فكرة</button>
      </div>`;
    return;
  }

  grid.innerHTML = ideas.map((idea, index) => createIdeaCard(idea, index)).join('');
}

function createIdeaCard(idea, index) {
  const date = new Date(idea.updatedAt).toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'short', day: 'numeric'
  });

  const tags = (idea.tags || []).slice(0, 3).map(t =>
    `<span class="tag tag-general">${t}</span>`
  ).join('');

  const categoryBadge = idea.category
    ? `<span class="tag tag-category">${idea.category}</span>`
    : '';

  const statusBadge = idea.status
    ? `<span class="tag tag-status">${idea.status}</span>`
    : '';

  const desc = idea.description
    ? `<div class="idea-desc">${idea.description}</div>`
    : '';

  return `
    <div class="idea-card fade-in" 
         style="animation-delay:${Math.min(index * 0.05, 0.4)}s"
         onclick="openEditModal('${idea.id}')">
      <span class="idea-icon">${idea.icon}</span>
      <div class="idea-title">${escapeHtml(idea.title)}</div>
      ${desc}
      <div class="idea-meta">
        ${categoryBadge}
        ${statusBadge}
        ${tags}
      </div>
      <div class="idea-date">🕐 ${date}</div>
      <div class="idea-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditModal('${idea.id}'); event.stopPropagation();">
          ✏️ تعديل
        </button>
        <a href="${idea.url}" target="_blank" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();">
          🔗 Notion
        </a>
      </div>
    </div>`;
}

// ----------------------------------------
// FILTER & SEARCH
// ----------------------------------------

function filterIdeas() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const category = document.getElementById('category-filter').value;
  const sort = document.getElementById('sort-select').value;

  let filtered = allIdeas.filter(idea => {
    const matchQuery = !query ||
      idea.title.toLowerCase().includes(query) ||
      (idea.description || '').toLowerCase().includes(query) ||
      (idea.tags || []).some(t => t.toLowerCase().includes(query));
    const matchCategory = !category || idea.category === category;
    return matchQuery && matchCategory;
  });

  if (sort === 'newest') filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  else if (sort === 'oldest') filtered.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
  else if (sort === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title, 'ar'));

  renderIdeas(filtered);
  document.getElementById('ideas-count').textContent = filtered.length;
}

function populateCategoryFilter(ideas) {
  const categories = [...new Set(ideas.map(i => i.category).filter(Boolean))].sort();
  const select = document.getElementById('category-filter');
  const current = select.value;
  select.innerHTML = `<option value="">كل الفئات</option>` +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (current) select.value = current;
}

// ----------------------------------------
// ADD IDEA
// ----------------------------------------

function openAddModal() {
  document.getElementById('new-title').value = '';
  document.getElementById('new-content').value = '';
  document.getElementById('new-category').value = '';
  document.getElementById('new-tags').value = '';
  openModal('add-modal');
}

async function addIdea() {
  const title = document.getElementById('new-title').value.trim();
  if (!title) {
    showToast('⚠️ يرجى إدخال عنوان الفكرة', 'error');
    document.getElementById('new-title').focus();
    return;
  }

  const tagsRaw = document.getElementById('new-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const payload = {
    title,
    content: document.getElementById('new-content').value.trim(),
    category: document.getElementById('new-category').value.trim(),
    tags,
  };

  try {
    showToast('⏳ جارٍ الحفظ في Notion...', 'info');
    const data = await smartFetch('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!data.success) throw new Error(data.error);

    closeModal('add-modal');
    showToast('✅ تمت إضافة الفكرة بنجاح!', 'success');
    await loadIdeas();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// EDIT IDEA
// ----------------------------------------

function openEditModal(id) {
  const idea = allIdeas.find(i => i.id === id);
  if (!idea) return;

  currentEditId = id;

  document.getElementById('edit-modal-content').innerHTML = `
    <div class="form-group">
      <label class="form-label">عنوان الفكرة *</label>
      <input type="text" id="edit-title" class="form-input" value="${escapeHtml(idea.title)}">
    </div>
    <div class="form-group">
      <label class="form-label">الفئة</label>
      <select id="edit-category" class="form-select">
        <option value="">بدون فئة</option>
        ${dbCategories.map(c => `<option value="${escapeHtml(c)}" ${idea.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">الوسوم (مفصولة بفاصلة)</label>
      <input type="text" id="edit-tags" class="form-input" value="${escapeHtml((idea.tags || []).join(', '))}">
    </div>
    <div style="margin-top:12px;">
      <a href="${idea.url}" target="_blank" class="btn btn-ghost btn-sm">
        🔗 فتح في Notion
      </a>
    </div>
  `;

  openModal('edit-modal');
}

async function saveEdit() {
  if (!currentEditId) return;

  const title = document.getElementById('edit-title').value.trim();
  if (!title) {
    showToast('⚠️ يرجى إدخال عنوان الفكرة', 'error');
    return;
  }

  const tagsRaw = document.getElementById('edit-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  try {
    const data = await smartFetch(`/api/ideas/${currentEditId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category: document.getElementById('edit-category').value.trim(),
        tags,
      }),
    });
    if (!data.success) throw new Error(data.error);

    closeModal('edit-modal');
    showToast('✅ تم تحديث الفكرة', 'success');
    await loadIdeas();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

async function deleteIdea(id) {
  if (!confirm('هل تريد حذف هذه الفكرة؟ (سيتم أرشفتها في Notion)')) return;

  try {
    const data = await smartFetch(`/api/ideas/${id}`, { method: 'DELETE' });
    if (!data.success) throw new Error(data.error);

    closeModal('edit-modal');
    showToast('🗑️ تم حذف الفكرة', 'info');
    await loadIdeas();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// AI ANALYSIS
// ----------------------------------------

async function triggerAIAnalysis() {
  if (!allIdeas.length) {
    showToast('⚠️ لا توجد أفكار للتحليل', 'error');
    return;
  }

  const panel = document.getElementById('ai-panel');
  const result = document.getElementById('ai-result');
  const actions = document.getElementById('ai-actions');

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  result.className = 'ai-result loading';
  result.innerHTML = `
    <div style="text-align:center;width:100%;">
      <div class="loading-dots" style="justify-content:center;margin-bottom:12px;">
        <span></span><span></span><span></span>
      </div>
      <div style="color:var(--text-muted);font-size:0.8rem;">Big Pickle يحلل ${allIdeas.length} فكرة...</div>
    </div>`;
  actions.style.display = 'none';

  try {
    const data = await smartFetch('/api/ai/analyze-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideas: allIdeas }),
    });
    if (!data.success) throw new Error(data.error);

    const analysis = data.analysis;
    result.className = 'ai-result';
    result.innerHTML = formatAIResult(analysis);

    if (analysis.newIdeas?.length) {
      actions.style.display = 'flex';
      actions.innerHTML = analysis.newIdeas.map(idea => `
        <button class="btn btn-secondary btn-sm" 
                onclick="addSuggestedIdea('${escapeHtml(idea.title)}', '${escapeHtml(idea.rationale || '')}')">
          ✨ ${escapeHtml(idea.title)}
        </button>`).join('');
    }

    showToast('🤖 اكتمل التحليل!', 'success');
  } catch (err) {
    result.className = 'ai-result';
    result.innerHTML = `<span style="color:var(--accent-rose);">❌ ${err.message}</span>`;
    showToast('❌ فشل التحليل: ' + err.message, 'error');
  }
}

function formatAIResult(analysis) {
  let html = '';

  if (analysis.insights) {
    html += `<div style="margin-bottom:14px;">${analysis.insights}</div>`;
  }

  if (analysis.networkScore !== undefined) {
    const score = analysis.networkScore;
    const color = score >= 8 ? 'var(--accent-emerald)' : score >= 6 ? 'var(--accent-gold)' : 'var(--accent-rose)';
    html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:0.8rem;color:var(--text-muted);">قوة الشبكة:</span>
      <span style="font-weight:900;color:${color};font-size:1.2rem;">${score}/10</span>
    </div>`;
  }

  if (analysis.clusters?.length) {
    html += `<div style="margin-top:10px;font-size:0.78rem;color:var(--text-muted);">
      <strong style="color:var(--text-secondary);">المجموعات المكتشفة:</strong><br>
      ${analysis.clusters.map(c => `• ${c.name}: ${c.theme}`).join('<br>')}
    </div>`;
  }

  return html || '<span style="color:var(--text-muted);">اكتمل التحليل</span>';
}

async function addSuggestedIdea(title, rationale) {
  if (!confirm(`إضافة الفكرة: "${title}"؟`)) return;

  try {
    const data = await smartFetch('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: rationale, category: 'AI مقترح' }),
    });
    if (!data.success) throw new Error(data.error);
    showToast('✅ تمت إضافة الفكرة المقترحة!', 'success');
    await loadIdeas();
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// STATUS
// ----------------------------------------

function updateConnectionStatus(connected) {
  smartFetch('/api/status')
    .then(data => {
      const notionDot = document.getElementById('notion-status-dot');
      const notionText = document.getElementById('notion-status-text');
      if (data.notion && connected !== false) {
        notionDot.className = 'status-dot';
        notionText.textContent = 'Notion: متصل ✓';
      } else {
        notionDot.className = 'status-dot offline';
        notionText.textContent = 'Notion: غير متصل';
      }

      const aiDot = document.getElementById('ai-status-dot');
      const aiText = document.getElementById('ai-status-text');
      if (aiDot && aiText) {
        if (data.ai) {
          aiDot.className = 'status-dot';
          aiText.textContent = 'AI: متصل ✓';
        } else {
          aiDot.className = 'status-dot offline';
          aiText.textContent = 'AI: غير متصل';
        }
      }
    })
    .catch(err => console.error('Status check error:', err));
}

// ----------------------------------------
// MODAL HELPERS
// ----------------------------------------

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
  }
});

// ----------------------------------------
// TOAST
// ----------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ----------------------------------------
// SETTINGS
// ----------------------------------------

async function openSettingsModal() {
  openModal('settings-modal');
  const statusEl = document.getElementById('settings-status');
  statusEl.style.display = 'none';

  try {
    const data = await smartFetch('/api/settings');
    if (data.success && data.settings) {
      const s = data.settings;
      document.getElementById('settings-notion-key').value = s.notionApiKey || '';
      document.getElementById('settings-database-id').value = s.notionDatabaseId || '';
      document.getElementById('settings-ai-key').value = s.aiApiKey || '';
      document.getElementById('settings-ai-url').value = s.aiApiUrl || '';
      document.getElementById('settings-ai-model').value = s.aiModel || '';
    }
  } catch(e) {
    console.warn('Failed to load settings:', e);
  }
}

async function saveSettings() {
  const statusEl = document.getElementById('settings-status');
  const notionKey = document.getElementById('settings-notion-key').value.trim();
  const databaseId = document.getElementById('settings-database-id').value.trim();

  if (!notionKey || !databaseId) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(239,68,68,0.1)';
    statusEl.style.color = 'var(--accent-rose)';
    statusEl.textContent = '❌ يرجى إدخال Notion API Key و Database ID على الأقل';
    return;
  }

  const settings = {
    notionApiKey: notionKey,
    notionDatabaseId: databaseId,
    aiApiKey: document.getElementById('settings-ai-key').value.trim(),
    aiApiUrl: document.getElementById('settings-ai-url').value.trim(),
    aiModel: document.getElementById('settings-ai-model').value.trim(),
  };

  saveLocalSettings(settings);

  let serverOk = false;
  try {
    const data = await smartFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    serverOk = data.success === true;
  } catch(e) {
    console.warn('Server save failed, using localStorage:', e.message);
  }

  statusEl.style.display = 'block';
  statusEl.style.background = 'rgba(16,185,129,0.1)';
  statusEl.style.color = 'var(--accent-emerald)';
  statusEl.textContent = serverOk
    ? '✅ تم حفظ الإعدادات بنجاح!'
    : '✅ تم حفظ الإعدادات في المتصفح!';
  setTimeout(() => {
    closeModal('settings-modal');
    location.reload();
  }, 1500);
}

// ----------------------------------------
// UTILS
// ----------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
