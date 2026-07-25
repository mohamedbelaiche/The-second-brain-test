// ====================================================
// evaluation.js - Performance Evaluation Page
// ====================================================

let allIdeas = [];
let radarChart = null;

// ----------------------------------------
// INIT
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  loadData();
});

// ----------------------------------------
// LOAD IDEAS
// ----------------------------------------

async function loadData() {
  try {
    const data = await smartFetch('/api/ideas');
    if (!data.success) throw new Error(data.error);
    
    allIdeas = data.ideas;
    document.getElementById('notion-dot').className = 'status-dot';
    document.getElementById('notion-text').textContent = `Notion: متصل (${allIdeas.length} فكرة)`;
    showToast('✅ تم تحميل البيانات - جاهز للتقييم', 'success');
  } catch (err) {
    document.getElementById('notion-dot').className = 'status-dot offline';
    document.getElementById('notion-text').textContent = 'Notion: غير متصل';
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// RUN FULL EVALUATION
// ----------------------------------------

async function runEvaluation() {
  if (!allIdeas.length) {
    await loadData();
    if (!allIdeas.length) {
      showToast('⚠️ لا توجد بيانات للتقييم', 'error');
      return;
    }
  }

  const hero = document.getElementById('eval-hero');
  document.querySelector('#eval-hero > div').innerHTML = `
    <div id="loading-hero" style="padding:20px;">
      <div class="spinner" style="margin:0 auto 16px;"></div>
      <div style="color:var(--text-muted);">🤖 Big Pickle يحلل ${allIdeas.length} فكرة...</div>
      <div style="color:var(--text-muted);font-size:0.75rem;margin-top:8px;">قد يستغرق هذا 15-30 ثانية</div>
    </div>`;

  showDimensionLoading();

  try {
    const categories = [...new Set(allIdeas.map(i => i.category).filter(Boolean))];
    const lastUpdated = allIdeas.length
      ? new Date(Math.max(...allIdeas.map(i => new Date(i.updatedAt)))).toLocaleDateString('ar-SA')
      : 'غير محدد';

    const stats = {
      total: allIdeas.length,
      categories,
      lastUpdated,
    };

    const data = await smartFetch('/api/ai/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideas: allIdeas, stats }),
    });
    if (!data.success) throw new Error(data.error);

    renderEvaluation(data.evaluation);
    showToast('✅ اكتمل التقييم الكامل!', 'success');
  } catch (err) {
    document.querySelector('#eval-hero > div').innerHTML = `
      <div style="color:var(--accent-rose);padding:20px;">❌ ${err.message}</div>
      <button class="btn btn-primary" style="margin-top:16px;" onclick="runEvaluation()">إعادة المحاولة</button>`;
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// RENDER EVALUATION RESULTS
// ----------------------------------------

function renderEvaluation(ev) {
  const score = ev.overallScore || 0;
  document.querySelector('#eval-hero > div').innerHTML = `
    <div class="score-ring" style="display:inline-block;">
      <svg viewBox="0 0 120 120" width="160" height="160">
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(100,65,230,0.15)" stroke-width="10"/>
        <circle id="score-arc" cx="60" cy="60" r="50" fill="none"
          stroke="url(#evalGrad)" stroke-width="10"
          stroke-linecap="round"
          stroke-dasharray="314"
          stroke-dashoffset="314"/>
        <defs>
          <linearGradient id="evalGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#6441e6"/>
            <stop offset="100%" stop-color="#06b6d4"/>
          </linearGradient>
        </defs>
      </svg>
      <div class="score-ring-value">
        <span id="overall-score">${score}</span>
        <span class="score-ring-label">/ 10</span>
      </div>
    </div>
    <div style="margin-top:16px;" id="score-pills"></div>`;

  setTimeout(() => {
    const arc = document.getElementById('score-arc');
    if (arc) {
      const circumference = 2 * Math.PI * 50;
      const offset = circumference - (score / 10) * circumference;
      arc.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)';
      arc.style.strokeDashoffset = offset;
    }
  }, 100);

  const pillsContainer = document.getElementById('score-pills');
  if (pillsContainer && ev.dimensions) {
    const dims = ev.dimensions;
    pillsContainer.innerHTML = Object.entries(dims).map(([key, val]) => {
      const labels = {
        diversity: 'التنوع', depth: 'العمق', connections: 'الروابط',
        actionability: 'التطبيق', freshness: 'الحداثة'
      };
      const color = val.score >= 8 ? 'var(--accent-emerald)' : val.score >= 6 ? 'var(--accent-gold)' : 'var(--accent-rose)';
      return `<span class="metric-pill" style="color:${color};border-color:${color}55;background:${color}15;">
        ${labels[key] || key}: ${val.score}/10
      </span>`;
    }).join('');
  }

  if (ev.dimensions) {
    renderDimensions(ev.dimensions);
    renderRadarChart(ev.dimensions);
  }

  if (ev.strengths?.length) {
    document.getElementById('strengths-section').innerHTML =
      ev.strengths.map(s => `
        <div class="strength-item">
          <span class="strength-icon">✅</span>
          <span>${s}</span>
        </div>`).join('');
  }

  if (ev.weaknesses?.length) {
    document.getElementById('weaknesses-section').innerHTML =
      ev.weaknesses.map(w => `
        <div class="weakness-item">
          <span class="weakness-icon">⚠️</span>
          <span>${w}</span>
        </div>`).join('');
  }

  if (ev.recommendations?.length) {
    document.getElementById('recommendations-section').innerHTML =
      ev.recommendations.map(rec => {
        const priorityClass = rec.priority === 'عالي' ? 'high' : rec.priority === 'متوسط' ? 'medium' : 'low';
        return `
          <div class="rec-card">
            <span class="rec-priority ${priorityClass}">${rec.priority}</span>
            <div>
              <div style="font-weight:700;font-size:0.88rem;margin-bottom:4px;">${rec.action}</div>
              ${rec.impact ? `<div style="font-size:0.78rem;color:var(--text-muted);">💫 ${rec.impact}</div>` : ''}
            </div>
          </div>`;
      }).join('');
  }

  if (ev.summary) {
    document.getElementById('summary-section').innerHTML = `
      <div class="summary-box">${ev.summary}</div>`;
  }
}

// ----------------------------------------
// DIMENSIONS BARS
// ----------------------------------------

function renderDimensions(dims) {
  const labels = {
    diversity: { label: 'التنوع الموضوعاتي', icon: '🌈' },
    depth: { label: 'عمق المعالجة', icon: '🔍' },
    connections: { label: 'الروابط الفكرية', icon: '🔗' },
    actionability: { label: 'قابلية التطبيق', icon: '⚡' },
    freshness: { label: 'حداثة المحتوى', icon: '✨' },
  };

  document.getElementById('dimensions-section').innerHTML =
    Object.entries(dims).map(([key, val]) => {
      const meta = labels[key] || { label: key, icon: '📊' };
      const color = val.score >= 8 ? '#10b981' : val.score >= 6 ? '#f59e0b' : '#f43f5e';
      return `
        <div class="dimension-bar">
          <div class="dimension-header">
            <span class="dimension-name">${meta.icon} ${meta.label}</span>
            <span class="dimension-score">${val.score}/10</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${val.score * 10}%;background:${color};" data-target="${val.score * 10}"></div>
          </div>
          ${val.comment ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${val.comment}</div>` : ''}
        </div>`;
    }).join('');

  setTimeout(() => {
    document.querySelectorAll('.progress-fill').forEach(bar => {
      const target = bar.dataset.target;
      bar.style.width = '0%';
      setTimeout(() => bar.style.width = target + '%', 50);
    });
  }, 100);
}

function showDimensionLoading() {
  document.getElementById('dimensions-section').innerHTML = `
    <div style="text-align:center;padding:40px;color:var(--text-muted);">
      <div class="spinner" style="margin:0 auto 12px;"></div>
      جارٍ التحليل...
    </div>`;
  document.getElementById('strengths-section').innerHTML =
    '<div style="color:var(--text-muted);text-align:center;padding:20px;">جارٍ التحليل...</div>';
  document.getElementById('weaknesses-section').innerHTML =
    '<div style="color:var(--text-muted);text-align:center;padding:20px;">جارٍ التحليل...</div>';
  document.getElementById('recommendations-section').innerHTML =
    '<div style="color:var(--text-muted);text-align:center;padding:30px;">جارٍ التحليل...</div>';
  document.getElementById('summary-section').innerHTML =
    '<div style="color:var(--text-muted);text-align:center;padding:20px;">جارٍ التحليل...</div>';
}

// ----------------------------------------
// RADAR CHART (Chart.js)
// ----------------------------------------

function renderRadarChart(dims) {
  const labels = {
    diversity: 'التنوع',
    depth: 'العمق',
    connections: 'الروابط',
    actionability: 'التطبيق',
    freshness: 'الحداثة',
  };

  const dataLabels = Object.keys(dims).map(k => labels[k] || k);
  const dataValues = Object.values(dims).map(d => d.score || 0);

  const canvas = document.getElementById('radar-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (radarChart) {
    radarChart.destroy();
    radarChart = null;
  }

  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: dataLabels,
      datasets: [{
        label: 'الأداء الحالي',
        data: dataValues,
        backgroundColor: 'rgba(100, 65, 230, 0.2)',
        borderColor: '#6441e6',
        borderWidth: 2,
        pointBackgroundColor: '#06b6d4',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#6441e6',
        pointRadius: 5,
        pointHoverRadius: 7,
      }, {
        label: 'الهدف المثالي',
        data: [10, 10, 10, 10, 10],
        backgroundColor: 'rgba(6, 182, 212, 0.05)',
        borderColor: 'rgba(6, 182, 212, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: 'rgba(153,153,187,0.9)',
            font: { family: 'Cairo', size: 11 },
            boxWidth: 12,
          },
        },
      },
      scales: {
        r: {
          min: 0, max: 10,
          ticks: { display: false, stepSize: 2 },
          grid: { color: 'rgba(100,65,230,0.15)', circular: true },
          angleLines: { color: 'rgba(100,65,230,0.2)' },
          pointLabels: {
            color: 'rgba(153,153,187,0.9)',
            font: { family: 'Cairo', size: 12, weight: '600' },
          },
        },
      },
      animation: { duration: 1200, easing: 'easeInOutQuart' },
    },
  });
}

// ----------------------------------------
// AI SUGGESTIONS
// ----------------------------------------

async function getSuggestions() {
  if (!allIdeas.length) {
    await loadData();
    if (!allIdeas.length) {
      showToast('⚠️ لا توجد بيانات', 'error');
      return;
    }
  }

  const panel = document.getElementById('suggestions-panel');
  const grid = document.getElementById('suggestions-grid');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });

  grid.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1;">
      <div class="loading-dots" style="justify-content:center;"><span></span><span></span><span></span></div>
      <div class="empty-title" style="margin-top:16px;">Big Pickle يقترح أفكاراً جديدة...</div>
    </div>`;

  try {
    const data = await smartFetch('/api/ai/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ideas: allIdeas, count: 6 }),
    });
    if (!data.success) throw new Error(data.error);

    const suggestions = data.suggestions?.suggestions || data.suggestions || [];
    
    if (!suggestions.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <span class="empty-icon">💭</span>
        <div class="empty-title">لا توجد اقتراحات متاحة</div>
      </div>`;
      return;
    }

    grid.innerHTML = suggestions.map((s, i) => {
      const tags = (s.tags || []).map(t => `<span class="tag tag-general">${t}</span>`).join('');
      const priorityColor = s.priority === 'عالي' ? 'var(--accent-rose)' :
        s.priority === 'متوسط' ? 'var(--accent-gold)' : 'var(--accent-emerald)';

      return `
        <div class="idea-card fade-in" style="animation-delay:${i * 0.07}s;">
          <span class="idea-icon">✨</span>
          <div class="idea-title">${escapeHtml(s.title)}</div>
          ${s.description ? `<div class="idea-desc">${escapeHtml(s.description)}</div>` : ''}
          <div class="idea-meta">
            ${s.category ? `<span class="tag tag-category">${escapeHtml(s.category)}</span>` : ''}
            ${s.priority ? `<span class="tag" style="background:${priorityColor}18;color:${priorityColor};border:1px solid ${priorityColor}44;">${escapeHtml(s.priority)}</span>` : ''}
            ${tags}
          </div>
          ${s.relatedTo?.length ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px;">🔗 يرتبط بـ: ${s.relatedTo.slice(0,2).join(', ')}</div>` : ''}
          <div class="idea-actions" style="opacity:1;margin-top:12px;">
            <button class="btn btn-primary btn-sm" onclick="addToNotion('${escapeHtml(s.title).replace(/'/g,'\\&apos;')}', '${escapeHtml(s.description || '').replace(/'/g,'\\&apos;')}', '${escapeHtml(s.category || '').replace(/'/g,'\\&apos;')}')">
              ✨ إضافة لـ Notion
            </button>
          </div>
        </div>`;
    }).join('');

    showToast('💡 ' + suggestions.length + ' اقتراح جاهز!', 'success');
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <span class="empty-icon">❌</span>
      <div class="empty-title">${err.message}</div>
      <button class="btn btn-secondary" style="margin-top:16px;" onclick="getSuggestions()">إعادة المحاولة</button>
    </div>`;
    showToast('❌ ' + err.message, 'error');
  }
}

async function addToNotion(title, description, category) {
  try {
    showToast('⏳ جارٍ الإضافة إلى Notion...', 'info');
    const data = await smartFetch('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content: description, category: category || 'AI مقترح' }),
    });
    if (!data.success) throw new Error(data.error);
    showToast('✅ تمت الإضافة إلى Notion!', 'success');
    allIdeas = [...allIdeas, data.idea];
  } catch (err) {
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// UTILS
// ----------------------------------------

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
