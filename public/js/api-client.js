// ====================================================
// api-client.js - Smart API Client
// Works with server OR directly from browser (no server needed)
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

// ----------------------------------------
// SERVER DETECTION
// ----------------------------------------

let _serverStatus = null;

async function checkServer() {
  if (_serverStatus !== null) return _serverStatus;
  try {
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
    const text = await res.text();
    const data = JSON.parse(text);
    _serverStatus = (data.success === true);
  } catch {
    _serverStatus = false;
  }
  return _serverStatus;
}

// ----------------------------------------
// SMART FETCH
// Tries server first, falls back to direct Notion/AI API
// ----------------------------------------

async function smartFetch(path, options = {}) {
  const serverUp = await checkServer();

  if (serverUp) {
    try {
      const res = await fetch(path, options);
      const text = await res.text();
      const data = JSON.parse(text);
      return data;
    } catch {
      _serverStatus = false;
    }
  }

  return await directApiCall(path, options);
}

// ----------------------------------------
// DIRECT API CALLS (no server needed)
// ----------------------------------------

async function directApiCall(path, options = {}) {
  const s = getLocalSettings();
  const method = options.method || 'GET';
  let body = null;
  if (options.body) {
    try { body = JSON.parse(options.body); } catch {}
  }

  // --- Settings ---
  if (path === '/api/settings') {
    if (method === 'GET') {
      return { success: true, settings: { ...getLocalSettings() } };
    }
    if (method === 'POST' && body) {
      saveLocalSettings(body);
      return { success: true };
    }
  }

  // --- Status ---
  if (path === '/api/status') {
    return { success: true, notion: !!s.notionApiKey, ai: !!s.aiApiKey };
  }

  // --- Notion endpoints ---
  if (!s.notionApiKey || !s.notionDatabaseId) {
    throw new Error('يرجى إدخال Notion API Key و Database ID في الإعدادات أولاً');
  }

  const nHeaders = {
    'Authorization': 'Bearer ' + s.notionApiKey,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // Schema
  if (path === '/api/schema' && method === 'GET') {
    const r = await fetch('https://api.notion.com/v1/databases/' + s.notionDatabaseId, { headers: nHeaders });
    if (!r.ok) { const e = await r.text(); throw new Error('Notion Error ' + r.status + ': ' + e.substring(0, 200)); }
    const d = await r.json();
    return { success: true, schema: d.properties, title: d.title };
  }

  // List ideas
  if (path === '/api/ideas' && method === 'GET') {
    const r = await fetch('https://api.notion.com/v1/databases/' + s.notionDatabaseId + '/query', {
      method: 'POST', headers: nHeaders,
      body: JSON.stringify({ sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }], page_size: 100 }),
    });
    if (!r.ok) { const e = await r.text(); throw new Error('Notion Error ' + r.status + ': ' + e.substring(0, 200)); }
    const d = await r.json();
    const ideas = d.results.map(p => formatNotionPage(p));
    return { success: true, ideas, total: ideas.length };
  }

  // Create idea
  if (path === '/api/ideas' && method === 'POST' && body) {
    const props = { Name: { title: [{ text: { content: body.title || 'idea' } }] } };
    if (body.tags) props['الوسوم'] = { multi_select: body.tags.map(t => ({ name: t })) };
    if (body.category) props['الفئة'] = { select: { name: body.category } };
    if (body.status) props['الحالة'] = { select: { name: body.status } };
    const children = body.content ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: body.content } }] } }] : [];
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST', headers: nHeaders,
      body: JSON.stringify({ parent: { database_id: s.notionDatabaseId }, properties: props, children }),
    });
    if (!r.ok) { const e = await r.text(); throw new Error('Notion Error ' + r.status + ': ' + e.substring(0, 200)); }
    const d = await r.json();
    return { success: true, idea: formatNotionPage(d) };
  }

  // Single idea
  const ideaMatch = path.match(/^\/api\/ideas\/(.+)$/);
  if (ideaMatch) {
    const pageId = ideaMatch[1];
    if (method === 'GET') {
      const r = await fetch('https://api.notion.com/v1/pages/' + pageId, { headers: nHeaders });
      if (!r.ok) throw new Error('Notion Error ' + r.status);
      const d = await r.json();
      return { success: true, idea: formatNotionPage(d), content: [] };
    }
    if (method === 'PATCH' && body) {
      const props = {};
      if (body.title) props.Name = { title: [{ text: { content: body.title } }] };
      if (body.tags) props['الوسوم'] = { multi_select: body.tags.map(t => ({ name: t })) };
      if (body.category) props['الفئة'] = { select: { name: body.category } };
      if (body.status) props['الحالة'] = { select: { name: body.status } };
      const r = await fetch('https://api.notion.com/v1/pages/' + pageId, {
        method: 'PATCH', headers: nHeaders, body: JSON.stringify({ properties: props }),
      });
      if (!r.ok) throw new Error('Notion Error ' + r.status);
      const d = await r.json();
      return { success: true, idea: formatNotionPage(d) };
    }
    if (method === 'DELETE') {
      const r = await fetch('https://api.notion.com/v1/pages/' + pageId, {
        method: 'PATCH', headers: nHeaders, body: JSON.stringify({ archived: true }),
      });
      if (!r.ok) throw new Error('Notion Error ' + r.status);
      return { success: true, message: 'تم أرشفة الفكرة بنجاح' };
    }
  }

  // --- AI endpoints ---
  if (path.startsWith('/api/ai/')) {
    return await directAiCall(path, body, s);
  }

  throw new Error('الخادم غير متاح والإعدادات غير مكتملة');
}

// ----------------------------------------
// DIRECT AI API CALL
// ----------------------------------------

async function directAiCall(path, body, s) {
  if (!s.aiApiKey || !s.aiApiUrl) {
    return getMockAIResponse(path, body);
  }

  const prompt = buildPrompt(path, body);
  const model = s.aiModel || 'gpt-4o';
  const apiUrl = s.aiApiUrl.replace(/\/+$/, '');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: 'أنت مساعد ذكاء اصطناعي متخصص في إدارة المعرفة والعقل الثاني. دائماً أجب بـ JSON صالح فقط بدون أي نص خارج JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  };

  try {
    const r = await fetch(apiUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.aiApiKey },
      body: JSON.stringify(requestBody),
    });

    if (!r.ok) {
      if (r.status === 404 || r.status === 400) {
        return await directAiCallModel(path, body, s, apiUrl, 'gpt-4o-mini');
      }
      return getMockAIResponse(path, body);
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || data.content || '{}';
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
      parsed = m ? JSON.parse(m[1] || m[0]) : { raw: content };
    }

    if (path.includes('analyze-connections')) return { success: true, analysis: parsed };
    if (path.includes('evaluate')) return { success: true, evaluation: parsed };
    if (path.includes('suggest')) return { success: true, suggestions: parsed };
    return { success: true, data: parsed };
  } catch {
    return getMockAIResponse(path, body);
  }
}

async function directAiCallModel(path, body, s, apiUrl, model) {
  const prompt = buildPrompt(path, body);
  const r = await fetch(apiUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.aiApiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'أنت مساعد ذكاء اصطناعي متخصص في إدارة المعرفة والعقل الثاني. أجب بـ JSON صالح فقط.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7, max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) return getMockAIResponse(path, body);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); } catch { return getMockAIResponse(path, body); }
  if (path.includes('analyze-connections')) return { success: true, analysis: parsed };
  if (path.includes('evaluate')) return { success: true, evaluation: parsed };
  if (path.includes('suggest')) return { success: true, suggestions: parsed };
  return { success: true, data: parsed };
}

function buildPrompt(path, body) {
  if (path.includes('analyze-connections')) {
    const ideas = body?.ideas || [];
    const ideasText = ideas.map((idea, i) =>
      (i + 1) + '. "' + idea.title + '" - التصنيف: ' + (idea.category || 'غير محدد') + ' - الوسوم: ' + (idea.tags?.join(', ') || 'لا يوجد')
    ).join('\n');
    return 'أنت مساعد ذكاء اصطناعي متخصص في تحليل الأفكار وبناء العقل الثاني.\n\nلديك قاعدة بيانات الأفكار التالية:\n' + ideasText + '\n\nالمطلوب:\n1. حلّل الروابط والعلاقات بين هذه الأفكار\n2. اقترح 3-5 مجموعات (clusters) من الأفكار المترابطة\n3. اقترح 3 أفكار جديدة يمكن إضافتها لتعميق قاعدة المعرفة\n4. قيّم قوة الشبكة الفكرية من 1 إلى 10\n\nأجب بتنسيق JSON هكذا:\n{"clusters": [{"name": "...", "ideas": [1, 2, 3], "theme": "..."}], "newIdeas": [{"title": "...", "rationale": "..."}], "networkScore": 8, "insights": "تحليل نصي شامل...", "connections": [{"from": 1, "to": 3, "strength": 0.8, "reason": "..."}]}';
  }
  if (path.includes('evaluate')) {
    const ideas = body?.ideas || [];
    const stats = body?.stats || {};
    const ideasText = ideas.slice(0, 50).map((idea, i) => (i + 1) + '. "' + idea.title + '" (' + (idea.category || 'عام') + ')').join('\n');
    return 'أنت خبير في بناء قواعد المعرفة والعقل الثاني.\n\nإحصائيات قاعدة الأفكار:\n- العدد الكلي: ' + (stats.total || 0) + ' فكرة\n- الفئات: ' + (stats.categories?.join(', ') || 'غير محدد') + '\n\nعينة من الأفكار:\n' + ideasText + '\n\nقيّم قاعدة المعرفة وأعطِ تقريراً شاملاً بتنسيق JSON:\n{"overallScore": 7.5, "dimensions": {"diversity": {"score": 8, "comment": "..."}, "depth": {"score": 7, "comment": "..."}, "connections": {"score": 6, "comment": "..."}, "actionability": {"score": 8, "comment": "..."}, "freshness": {"score": 9, "comment": "..."}}, "strengths": ["نقطة قوة 1"], "weaknesses": ["نقطة ضعف 1"], "recommendations": [{"priority": "عالي", "action": "...", "impact": "..."}], "summary": "ملخص شامل..."}';
  }
  if (path.includes('suggest')) {
    const ideas = body?.ideas || [];
    const count = body?.count || 5;
    const ideasSample = ideas.slice(0, 30).map(i => i.title).join('\n');
    return 'بناءً على قاعدة الأفكار التالية، اقترح ' + count + ' أفكار جديدة ومتعمقة:\n\n' + ideasSample + '\n\nأجب بـ JSON:\n{"suggestions": [{"title": "عنوان الفكرة", "description": "وصف مختصر", "category": "الفئة", "tags": ["وسم1"], "relatedTo": ["فكرة موجودة"], "priority": "عالي/متوسط/منخفض"}]}';
  }
  return '';
}

function getMockAIResponse(path, body) {
  if (path.includes('analyze-connections')) {
    return {
      success: true,
      analysis: {
        clusters: [
          { name: 'المفاهيم الأساسية', ideas: [1, 2, 3], theme: 'الأفكار الجوهرية المترابطة' },
          { name: 'التطبيقات العملية', ideas: [4, 5], theme: 'أفكار قابلة للتطبيق' },
        ],
        newIdeas: [
          { title: 'تكامل المعرفة والتجربة', rationale: 'ربط الأفكار النظرية بالتطبيق الفعلي' },
          { title: 'خريطة المفاهيم الذهنية', rationale: 'تنظيم بصري للأفكار المترابطة' },
        ],
        networkScore: 7,
        insights: 'قاعدة الأفكار تُظهر تنوعاً جيداً مع إمكانية تعميق الروابط بين الفئات المختلفة.',
        connections: [{ from: 1, to: 2, strength: 0.8, reason: 'مفاهيم مشتركة' }],
      },
    };
  }
  return {
    success: true,
    evaluation: {
      overallScore: 7.5,
      dimensions: {
        diversity: { score: 8, comment: 'تنوع جيد في الموضوعات' },
        depth: { score: 7, comment: 'يمكن تعميق بعض الأفكار' },
        connections: { score: 6, comment: 'هناك فرص لربط أفكار أكثر' },
        actionability: { score: 8, comment: 'الأفكار قابلة للتطبيق' },
        freshness: { score: 9, comment: 'محتوى حديث ومُحدَّث' },
      },
      strengths: ['تنوع الموضوعات', 'انتظام الإضافة'],
      weaknesses: ['قلة الروابط بين الأفكار'],
      recommendations: [{ priority: 'عالي', action: 'إضافة روابط بين الأفكار المتشابهة', impact: 'تعزيز التفكير الشبكي' }],
      summary: 'قاعدة معرفة واعدة مع إمكانات عالية للتطوير.',
    },
  };
}

// ----------------------------------------
// FORMAT NOTION PAGE (client-side version of server's formatPage)
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
