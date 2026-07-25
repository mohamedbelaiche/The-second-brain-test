// ====================================================
// map.js - D3.js Interactive Knowledge Graph
// ====================================================

let svg, simulation, zoom, g;
let allNodes = [], allLinks = [];
let physicsRunning = true;
let clusterData = null;

// ----------------------------------------
// LOCALSTORAGE SETTINGS HELPERS
// ----------------------------------------

function getLocalSettings() {
  try {
    const raw = localStorage.getItem('brain_settings');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function getSettingsHeaders() {
  const s = getLocalSettings();
  const headers = {};
  if (s.notionApiKey) headers['X-Notion-Api-Key'] = s.notionApiKey;
  if (s.notionDatabaseId) headers['X-Notion-Database-Id'] = s.notionDatabaseId;
  if (s.aiApiKey) headers['X-Ai-Api-Key'] = s.aiApiKey;
  if (s.aiApiUrl) headers['X-Ai-Api-Url'] = s.aiApiUrl;
  if (s.aiModel) headers['X-Ai-Model'] = s.aiModel;
  return headers;
}

const CATEGORY_COLORS = [
  '#6441e6', '#06b6d4', '#f59e0b', '#10b981',
  '#f43f5e', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f97316', '#84cc16'
];

const categoryColorMap = new Map();
let colorIndex = 0;

function getCategoryColor(category) {
  if (!category) return '#5555aa';
  if (!categoryColorMap.has(category)) {
    categoryColorMap.set(category, CATEGORY_COLORS[colorIndex % CATEGORY_COLORS.length]);
    colorIndex++;
  }
  return categoryColorMap.get(category);
}

// ----------------------------------------
// INIT
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initSVG();
  loadMapData();
});

function initSVG() {
  const container = document.getElementById('map-container');
  const width = container.offsetWidth || 1000;
  const height = container.offsetHeight || 600;

  svg = d3.select('#graph-svg')
    .attr('width', width)
    .attr('height', height);

  // Define gradient defs
  const defs = svg.append('defs');
  
  const linearGrad = defs.append('linearGradient')
    .attr('id', 'link-grad')
    .attr('gradientUnits', 'userSpaceOnUse');
  linearGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6441e6').attr('stop-opacity', 0.6);
  linearGrad.append('stop').attr('offset', '100%').attr('stop-color', '#06b6d4').attr('stop-opacity', 0.2);

  // Arrow marker
  defs.append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 22)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', 'rgba(100,65,230,0.5)');

  zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);
  g = svg.append('g').attr('class', 'graph-g');
}

// ----------------------------------------
// LOAD DATA
// ----------------------------------------

async function loadMapData() {
  document.getElementById('map-loading').style.display = 'flex';
  g.selectAll('*').remove();

  try {
    const res = await fetch('/api/ideas', { headers: getSettingsHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    buildGraph(data.ideas);
    document.getElementById('map-loading').style.display = 'none';
    showToast('✅ تم تحميل ' + data.ideas.length + ' فكرة', 'success');
  } catch (err) {
    document.getElementById('map-loading').style.display = 'none';
    showToast('❌ ' + err.message, 'error');
  }
}

// ----------------------------------------
// BUILD GRAPH
// ----------------------------------------

function buildGraph(ideas) {
  // Build nodes
  allNodes = ideas.map(idea => ({
    id: idea.id,
    title: idea.title,
    category: idea.category,
    tags: idea.tags || [],
    status: idea.status,
    url: idea.url,
    icon: idea.icon,
    updatedAt: idea.updatedAt,
    color: getCategoryColor(idea.category),
    r: 10 + Math.min((idea.tags || []).length * 2, 10),
  }));

  // Build links based on shared tags or category
  allLinks = [];
  for (let i = 0; i < allNodes.length; i++) {
    for (let j = i + 1; j < allNodes.length; j++) {
      const nodeA = allNodes[i];
      const nodeB = allNodes[j];
      const strength = calculateLinkStrength(nodeA, nodeB);
      if (strength > 0) {
        allLinks.push({
          source: nodeA.id,
          target: nodeB.id,
          strength,
        });
      }
    }
  }

  // Keep only strong links (top connections per node)
  const linksPerNode = new Map();
  allLinks.forEach(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    if (!linksPerNode.has(src)) linksPerNode.set(src, []);
    if (!linksPerNode.has(tgt)) linksPerNode.set(tgt, []);
    linksPerNode.get(src).push(l);
    linksPerNode.get(tgt).push(l);
  });

  const filteredLinks = new Set();
  linksPerNode.forEach((links) => {
    links.sort((a, b) => b.strength - a.strength).slice(0, 5).forEach(l => filteredLinks.add(l));
  });

  allLinks = [...filteredLinks];

  document.getElementById('node-count').textContent = allNodes.length;
  document.getElementById('link-count').textContent = allLinks.length;

  renderGraph();
  buildLegend();
}

function calculateLinkStrength(a, b) {
  let strength = 0;

  // Same category
  if (a.category && b.category && a.category === b.category) strength += 0.4;

  // Shared tags
  const sharedTags = a.tags.filter(t => b.tags.includes(t));
  strength += sharedTags.length * 0.3;

  // Similar title words
  const wordsA = a.title.split(/\s+/).filter(w => w.length > 3);
  const wordsB = b.title.split(/\s+/).filter(w => w.length > 3);
  const sharedWords = wordsA.filter(w => wordsB.includes(w));
  strength += sharedWords.length * 0.2;

  return Math.min(strength, 1);
}

// ----------------------------------------
// RENDER GRAPH
// ----------------------------------------

function renderGraph() {
  const container = document.getElementById('map-container');
  const width = container.offsetWidth;
  const height = container.offsetHeight;

  // Simulation
  simulation = d3.forceSimulation(allNodes)
    .force('link', d3.forceLink(allLinks)
      .id(d => d.id)
      .distance(d => 100 + (1 - d.strength) * 100)
      .strength(d => d.strength * 0.5))
    .force('charge', d3.forceManyBody()
      .strength(-300)
      .distanceMax(400))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.r + 18))
    .alpha(1)
    .alphaDecay(0.02);

  // Links layer
  const linkGroup = g.append('g').attr('class', 'links');
  const link = linkGroup.selectAll('line')
    .data(allLinks)
    .enter().append('line')
    .attr('class', 'link-line')
    .attr('stroke', d => {
      const srcNode = allNodes.find(n => n.id === (typeof d.source === 'object' ? d.source.id : d.source));
      return srcNode ? srcNode.color : 'rgba(100,65,230,0.4)';
    })
    .attr('stroke-width', d => 1 + d.strength * 2.5)
    .attr('stroke-opacity', d => 0.2 + d.strength * 0.5)
    .attr('marker-end', 'url(#arrow)');

  // Nodes layer
  const nodeGroup = g.append('g').attr('class', 'nodes');
  const node = nodeGroup.selectAll('.node')
    .data(allNodes)
    .enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragStart)
      .on('drag', dragged)
      .on('end', dragEnd))
    .on('click', (event, d) => showNodeInfo(d))
    .on('mouseover', (event, d) => showTooltip(event, d))
    .on('mouseout', hideTooltip);

  // Glow filter
  const filter = svg.select('defs').append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'coloredBlur');
  const feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Outer ring (glow)
  node.append('circle')
    .attr('r', d => d.r + 4)
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.3)
    .attr('filter', 'url(#glow)');

  // Main circle
  node.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => d.r)
    .attr('fill', d => d.color)
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => d.color)
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.5)
    .on('mouseover', function() {
      d3.select(this).transition().duration(200).attr('r', d => d.r + 4);
    })
    .on('mouseout', function() {
      d3.select(this).transition().duration(200).attr('r', d => d.r);
    });

  // Icon
  node.append('text')
    .attr('class', 'node-label')
    .attr('dy', '0.4em')
    .attr('y', 0)
    .style('font-size', '12px')
    .text(d => d.icon);

  // Label
  node.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => d.r + 14)
    .attr('y', 0)
    .style('font-size', '10px')
    .style('fill', 'rgba(240,240,255,0.7)')
    .text(d => truncate(d.title, 18));

  // Tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// ----------------------------------------
// DRAG
// ----------------------------------------

function dragStart(event, d) {
  if (!event.active && physicsRunning) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// ----------------------------------------
// ZOOM
// ----------------------------------------

function zoomIn() {
  svg.transition().duration(400).call(zoom.scaleBy, 1.4);
}

function zoomOut() {
  svg.transition().duration(400).call(zoom.scaleBy, 0.7);
}

function resetZoom() {
  const container = document.getElementById('map-container');
  svg.transition().duration(600).call(
    zoom.transform,
    d3.zoomIdentity.translate(container.offsetWidth / 2, container.offsetHeight / 2).scale(0.8)
  );
}

// ----------------------------------------
// PHYSICS TOGGLE
// ----------------------------------------

function togglePhysics() {
  physicsRunning = !physicsRunning;
  if (physicsRunning) {
    simulation.alphaTarget(0.3).restart();
    document.getElementById('physics-icon').textContent = '⏸️';
    document.getElementById('physics-label').textContent = 'إيقاف الفيزياء';
  } else {
    simulation.alphaTarget(0);
    document.getElementById('physics-icon').textContent = '▶️';
    document.getElementById('physics-label').textContent = 'تشغيل الفيزياء';
  }
}

// ----------------------------------------
// NODE INFO
// ----------------------------------------

function showNodeInfo(d) {
  const panel = document.getElementById('node-info');
  document.getElementById('info-title').textContent = d.icon + ' ' + d.title;
  document.getElementById('info-category').innerHTML = d.category
    ? `<span style="color:var(--accent-violet);">📁 ${d.category}</span>`
    : '';
  document.getElementById('info-tags').innerHTML = d.tags.length
    ? `<div style="margin-top:6px;">${d.tags.map(t => `<span class="tag tag-general" style="margin-left:4px;">${t}</span>`).join('')}</div>`
    : '';
  document.getElementById('info-date').innerHTML = `
    <div style="margin-top:8px;color:var(--text-muted);">
      🕐 ${new Date(d.updatedAt).toLocaleDateString('ar-SA')}
    </div>`;
  document.getElementById('info-link').href = d.url;
  panel.classList.add('show');
}

function closeNodeInfo() {
  document.getElementById('node-info').classList.remove('show');
}

// ----------------------------------------
// TOOLTIP
// ----------------------------------------

function showTooltip(event, d) {
  const tooltip = document.getElementById('map-tooltip');
  tooltip.style.display = 'block';
  tooltip.style.left = (event.clientX + 12) + 'px';
  tooltip.style.top = (event.clientY - 30) + 'px';
  tooltip.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">${d.icon} ${d.title}</div>
    ${d.category ? `<div style="color:var(--accent-violet);font-size:0.75rem;">${d.category}</div>` : ''}
    ${d.tags.length ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${d.tags.slice(0,3).join(' • ')}</div>` : ''}
  `;
}

function hideTooltip() {
  document.getElementById('map-tooltip').style.display = 'none';
}

// ----------------------------------------
// AI CLUSTERING
// ----------------------------------------

async function runAICluster() {
  if (!allNodes.length) {
    showToast('⚠️ لا توجد بيانات بعد', 'error');
    return;
  }

  const panel = document.getElementById('cluster-panel');
  const result = document.getElementById('cluster-result');
  const controls = document.getElementById('cluster-controls');

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
  result.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div>`;
  controls.innerHTML = '';

  try {
    const ideas = allNodes.map(n => ({
      title: n.title,
      category: n.category,
      tags: n.tags,
    }));

    const res = await fetch('/api/ai/analyze-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getSettingsHeaders() },
      body: JSON.stringify({ ideas }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    clusterData = data.analysis;
    result.innerHTML = renderClusterResult(clusterData);

    // Cluster filter buttons
    if (clusterData.clusters?.length) {
      controls.innerHTML = clusterData.clusters.map((c, i) => {
        const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
        return `<button class="cluster-btn" style="background:${color}22;color:${color};border-color:${color}66;"
                  onclick="highlightCluster(${i})">${c.name}</button>`;
      }).join('') + 
      `<button class="cluster-btn" style="background:rgba(255,255,255,0.05);color:var(--text-muted);border-color:var(--border-subtle);"
                onclick="clearHighlights()">إظهار الكل</button>`;
    }

    applyAIConnections(clusterData.connections || []);
    showToast('🤖 اكتمل تحليل الروابط!', 'success');
  } catch (err) {
    result.innerHTML = `<span style="color:var(--accent-rose);">❌ ${err.message}</span>`;
    showToast('❌ ' + err.message, 'error');
  }
}

function renderClusterResult(analysis) {
  let html = '';
  if (analysis.insights) {
    html += `<p style="margin-bottom:12px;">${analysis.insights}</p>`;
  }
  if (analysis.networkScore !== undefined) {
    const score = analysis.networkScore;
    const color = score >= 8 ? 'var(--accent-emerald)' : score >= 6 ? 'var(--accent-gold)' : 'var(--accent-rose)';
    html += `<div style="font-size:0.85rem;">قوة الشبكة الفكرية: <strong style="color:${color}">${score}/10</strong></div>`;
  }
  return html || 'اكتمل التحليل';
}

function applyAIConnections(connections) {
  // Add AI-discovered connections as dashed lines
  if (!connections.length || !allNodes.length) return;

  const nodeMap = new Map(allNodes.map(n => [n.title, n]));
  const extraLinks = [];

  connections.forEach(conn => {
    const srcNode = allNodes[conn.from - 1];
    const tgtNode = allNodes[conn.to - 1];
    if (srcNode && tgtNode) {
      extraLinks.push({
        source: srcNode.id,
        target: tgtNode.id,
        strength: conn.strength || 0.5,
        isAI: true,
      });
    }
  });

  if (extraLinks.length) {
    const linkGroup = g.select('.links');
    linkGroup.selectAll('.ai-link')
      .data(extraLinks)
      .enter().append('line')
      .attr('class', 'ai-link')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,4')
      .attr('stroke-opacity', 0.6);

    simulation.force('link').links([...allLinks, ...extraLinks]);
    simulation.alpha(0.3).restart();
  }
}

function highlightCluster(clusterIndex) {
  if (!clusterData?.clusters?.[clusterIndex]) return;
  const cluster = clusterData.clusters[clusterIndex];
  const clusterIndices = new Set(cluster.ideas.map(i => i - 1));

  g.selectAll('.node circle').attr('opacity', (d, i) => {
    return clusterIndices.has(i) ? 1 : 0.2;
  });
  g.selectAll('.link-line').attr('stroke-opacity', 0.05);
}

function clearHighlights() {
  g.selectAll('.node circle').attr('opacity', 1);
  g.selectAll('.link-line').attr('stroke-opacity', d => 0.2 + d.strength * 0.5);
}

// ----------------------------------------
// LEGEND
// ----------------------------------------

function buildLegend() {
  const container = document.getElementById('legend-items');
  const categories = [...categoryColorMap.entries()].slice(0, 8);
  container.innerHTML = categories.map(([cat, color]) => `
    <div class="legend-item">
      <div class="legend-color" style="background:${color};"></div>
      <span>${cat}</span>
    </div>`).join('') || 
    `<div class="legend-item">
      <div class="legend-color" style="background:#6441e6;"></div>
      <span>الأفكار</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background:#f59e0b;border-radius:0;height:2px;"></div>
      <span>روابط AI</span>
    </div>`;
}

// ----------------------------------------
// EXPORT
// ----------------------------------------

function exportMap() {
  const svgEl = document.getElementById('graph-svg');
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'second-brain-map.svg';
  link.click();
  showToast('✅ تم تصدير الخريطة!', 'success');
}

// ----------------------------------------
// UTILS
// ----------------------------------------

function truncate(str, len) {
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Resize handler
window.addEventListener('resize', () => {
  const container = document.getElementById('map-container');
  svg.attr('width', container.offsetWidth).attr('height', container.offsetHeight);
  if (simulation) {
    simulation.force('center', d3.forceCenter(container.offsetWidth / 2, container.offsetHeight / 2));
    simulation.alpha(0.1).restart();
  }
});
