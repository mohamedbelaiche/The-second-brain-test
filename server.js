require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { Client } = require('@notionhq/client');
const fetch = require('node-fetch');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading config.json:', e.message);
  }
  return {};
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('✅ Config saved to config.json');
  } catch (e) {
    console.warn('⚠️ Could not write config.json (read-only filesystem?):', e.message);
  }
}

let config = loadConfig();

const app = express();
const PORT = process.env.PORT || 3000;

function getNotionKey() {
  return process.env.NOTION_API_KEY || config.notionApiKey || '';
}
function getDatabaseId() {
  return process.env.NOTION_DATABASE_ID || config.notionDatabaseId || '';
}
function getAiKey() {
  return process.env.OPENCODE_ZEN_API_KEY || config.aiApiKey || '';
}
function getAiUrl() {
  return process.env.OPENCODE_ZEN_API_URL || config.aiApiUrl || 'https://api.openai.com/v1';
}
function getAiModel() {
  return process.env.OPENCODE_ZEN_MODEL || config.aiModel || 'gpt-4o';
}

function getNotionClient() {
  return new Client({ auth: getNotionKey() });
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Notion-Api-Key', 'X-Notion-Database-Id', 'X-Ai-Api-Key', 'X-Ai-Api-Url', 'X-Ai-Model'],
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: read settings from client-sent headers (localStorage is source of truth)
app.use((req, res, next) => {
  const hKey = req.headers['x-notion-api-key'];
  const hDb = req.headers['x-notion-database-id'];
  const hAiKey = req.headers['x-ai-api-key'];
  const hAiUrl = req.headers['x-ai-api-url'];
  const hAiModel = req.headers['x-ai-model'];

  if (hKey) config.notionApiKey = hKey;
  if (hDb) config.notionDatabaseId = hDb;
  if (hAiKey) config.aiApiKey = hAiKey;
  if (hAiUrl) config.aiApiUrl = hAiUrl;
  if (hAiModel) config.aiModel = hAiModel;

  next();
});

// ============================================================
// STATUS & CONFIG ROUTES
// ============================================================
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    notion: !!getNotionKey(),
    ai: !!getAiKey()
  });
});

// ============================================================
// SETTINGS ROUTES
// ============================================================
app.get('/api/settings', (req, res) => {
  res.json({
    success: true,
    settings: {
      notionApiKey: getNotionKey(),
      notionDatabaseId: getDatabaseId(),
      aiApiKey: getAiKey(),
      aiApiUrl: getAiUrl(),
      aiModel: getAiModel(),
    }
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const { notionApiKey, notionDatabaseId, aiApiKey, aiApiUrl, aiModel } = req.body;
    config = {
      notionApiKey: notionApiKey || config.notionApiKey || '',
      notionDatabaseId: notionDatabaseId || config.notionDatabaseId || '',
      aiApiKey: aiApiKey || config.aiApiKey || '',
      aiApiUrl: aiApiUrl || config.aiApiUrl || '',
      aiModel: aiModel || config.aiModel || '',
    };
    saveConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// NOTION API ROUTES
// ============================================================

// Get all ideas from Notion database
app.get('/api/ideas', async (req, res) => {
  try {
    const notion = getNotionClient();
    const response = await notion.databases.query({
      database_id: getDatabaseId(),
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
    });

    const ideas = response.results.map(page => formatPage(page));
    res.json({ success: true, ideas, total: ideas.length });
  } catch (error) {
    console.error('Notion query error:', error);
    res.status(500).json({ success: false, error: error.message, details: error.body });
  }
});

// Get database schema/properties
app.get('/api/schema', async (req, res) => {
  try {
    const notion = getNotionClient();
    const db = await notion.databases.retrieve({ database_id: getDatabaseId() });
    res.json({ success: true, schema: db.properties, title: db.title });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single idea by page ID
app.get('/api/ideas/:id', async (req, res) => {
  try {
    const notion = getNotionClient();
    const page = await notion.pages.retrieve({ page_id: req.params.id });
    const blocks = await notion.blocks.children.list({ block_id: req.params.id });
    res.json({ success: true, idea: formatPage(page), content: blocks.results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new idea in Notion
app.post('/api/ideas', async (req, res) => {
  try {
    const notion = getNotionClient();
    const { title, content, tags, category, status } = req.body;
    
    const properties = {
      Name: { title: [{ text: { content: title || 'فكرة جديدة' } }] },
    };

    if (tags) properties['الوسوم'] = { multi_select: tags.map(t => ({ name: t })) };
    if (category) properties['الفئة'] = { select: { name: category } };
    if (status) properties['الحالة'] = { select: { name: status } };

    const children = content ? [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content } }] }
    }] : [];

    const page = await notion.pages.create({
      parent: { database_id: getDatabaseId() },
      properties,
      children,
    });

    res.json({ success: true, idea: formatPage(page) });
  } catch (error) {
    console.error('Create idea error:', error);
    res.status(500).json({ success: false, error: error.message, details: error.body });
  }
});

// Update idea in Notion
app.patch('/api/ideas/:id', async (req, res) => {
  try {
    const notion = getNotionClient();
    const { title, tags, category, status } = req.body;
    const properties = {};

    if (title) properties.Name = { title: [{ text: { content: title } }] };
    if (tags) properties['الوسوم'] = { multi_select: tags.map(t => ({ name: t })) };
    if (category) properties['الفئة'] = { select: { name: category } };
    if (status) properties['الحالة'] = { select: { name: status } };

    const page = await notion.pages.update({
      page_id: req.params.id,
      properties,
    });

    res.json({ success: true, idea: formatPage(page) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete (archive) idea
app.delete('/api/ideas/:id', async (req, res) => {
  try {
    const notion = getNotionClient();
    await notion.pages.update({
      page_id: req.params.id,
      archived: true,
    });
    res.json({ success: true, message: 'تم أرشفة الفكرة بنجاح' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// AI ANALYSIS ROUTES (OpenCode Zen / Gemini compatible)
// ============================================================

// Analyze connections between ideas
app.post('/api/ai/analyze-connections', async (req, res) => {
  try {
    const { ideas } = req.body;
    
    const ideasText = ideas.map((idea, i) => 
      `${i + 1}. "${idea.title}" - التصنيف: ${idea.category || 'غير محدد'} - الوسوم: ${idea.tags?.join(', ') || 'لا يوجد'}`
    ).join('\n');

    const prompt = `أنت مساعد ذكاء اصطناعي متخصص في تحليل الأفكار وبناء العقل الثاني.

لديك قاعدة بيانات الأفكار التالية:
${ideasText}

المطلوب:
1. حلّل الروابط والعلاقات بين هذه الأفكار
2. اقترح 3-5 مجموعات (clusters) من الأفكار المترابطة
3. اقترح 3 أفكار جديدة يمكن إضافتها لتعميق قاعدة المعرفة
4. قيّم قوة الشبكة الفكرية من 1 إلى 10

أجب بتنسيق JSON هكذا:
{
  "clusters": [{"name": "...", "ideas": [1, 2, 3], "theme": "..."}],
  "newIdeas": [{"title": "...", "rationale": "..."}],
  "networkScore": 8,
  "insights": "تحليل نصي شامل...",
  "connections": [{"from": 1, "to": 3, "strength": 0.8, "reason": "..."}]
}`;

    const aiResponse = await callAI(prompt);
    res.json({ success: true, analysis: aiResponse });
  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Evaluate performance of the knowledge base
app.post('/api/ai/evaluate', async (req, res) => {
  try {
    const { ideas, stats } = req.body;
    
    const ideasText = ideas.slice(0, 50).map((idea, i) => 
      `${i + 1}. "${idea.title}" (${idea.category || 'عام'})`
    ).join('\n');

    const prompt = `أنت خبير في بناء قواعد المعرفة والعقل الثاني.

إحصائيات قاعدة الأفكار:
- العدد الكلي: ${stats.total} فكرة
- الفئات: ${stats.categories?.join(', ') || 'غير محدد'}
- آخر تحديث: ${stats.lastUpdated || 'غير محدد'}

عينة من الأفكار:
${ideasText}

قيّم قاعدة المعرفة وأعطِ تقريراً شاملاً بتنسيق JSON:
{
  "overallScore": 7.5,
  "dimensions": {
    "diversity": {"score": 8, "comment": "..."},
    "depth": {"score": 7, "comment": "..."},
    "connections": {"score": 6, "comment": "..."},
    "actionability": {"score": 8, "comment": "..."},
    "freshness": {"score": 9, "comment": "..."}
  },
  "strengths": ["نقطة قوة 1", "نقطة قوة 2"],
  "weaknesses": ["نقطة ضعف 1"],
  "recommendations": [{"priority": "عالي", "action": "...", "impact": "..."}],
  "summary": "ملخص شامل..."
}`;

    const aiResponse = await callAI(prompt);
    res.json({ success: true, evaluation: aiResponse });
  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Suggest new ideas based on existing ones
app.post('/api/ai/suggest', async (req, res) => {
  try {
    const { ideas, count = 5 } = req.body;
    
    const ideasSample = ideas.slice(0, 30).map(i => i.title).join('\n');
    
    const prompt = `بناءً على قاعدة الأفكار التالية، اقترح ${count} أفكار جديدة ومتعمقة:

${ideasSample}

أجب بـ JSON:
{
  "suggestions": [
    {
      "title": "عنوان الفكرة",
      "description": "وصف مختصر",
      "category": "الفئة",
      "tags": ["وسم1", "وسم2"],
      "relatedTo": ["فكرة موجودة 1"],
      "priority": "عالي/متوسط/منخفض"
    }
  ]
}`;

    const aiResponse = await callAI(prompt);
    res.json({ success: true, suggestions: aiResponse });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// AI HELPER FUNCTION
// ============================================================

async function callAI(prompt) {
  const apiKey = getAiKey();
  const apiUrl = getAiUrl();
  const model = getAiModel();

  if (!apiKey) {
    console.warn('No AI API key set — using demo data');
    return getMockAIResponse(prompt);
  }

  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: 'أنت مساعد ذكاء اصطناعي متخصص في إدارة المعرفة والعقل الثاني. دائماً أجب بـ JSON صالح فقط بدون أي نص خارج JSON.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  try {
    console.log(`🤖 Calling AI: ${apiUrl}/chat/completions (model: ${model})`);
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      // If model not found, try with gpt-4o-mini
      if (response.status === 404 || response.status === 400) {
        console.warn(`Model ${model} not found, trying gpt-4o-mini...`);
        return await callAIWithModel(prompt, apiUrl, apiKey, 'gpt-4o-mini');
      }
      throw new Error(`API Error ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.content || '{}';

    try {
      return JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return { raw: content };
    }
  } catch (error) {
    console.error('AI call failed:', error.message);
    // Fallback to mock for seamless demo
    return getMockAIResponse(prompt);
  }
}

async function callAIWithModel(prompt, apiUrl, apiKey, model) {
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: 'أنت مساعد ذكاء اصطناعي متخصص في إدارة المعرفة والعقل الثاني. أجب بـ JSON صالح فقط.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fallback API Error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/(\{[\s\S]*\})/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    return getMockAIResponse(prompt);
  }
}

function getMockAIResponse(prompt) {
  if (prompt.includes('analyze-connections') || prompt.includes('الروابط')) {
    return {
      clusters: [
        { name: "المفاهيم الأساسية", ideas: [1, 2, 3], theme: "الأفكار الجوهرية المترابطة" },
        { name: "التطبيقات العملية", ideas: [4, 5], theme: "أفكار قابلة للتطبيق" }
      ],
      newIdeas: [
        { title: "تكامل المعرفة والتجربة", rationale: "ربط الأفكار النظرية بالتطبيق الفعلي" },
        { title: "خريطة المفاهيم الذهنية", rationale: "تنظيم بصري للأفكار المترابطة" }
      ],
      networkScore: 7,
      insights: "قاعدة الأفكار تُظهر تنوعاً جيداً مع إمكانية تعميق الروابط بين الفئات المختلفة.",
      connections: [
        { from: 1, to: 2, strength: 0.8, reason: "مفاهيم مشتركة" },
        { from: 2, to: 3, strength: 0.6, reason: "تكمل بعضها" }
      ]
    };
  }
  return {
    overallScore: 7.5,
    dimensions: {
      diversity: { score: 8, comment: "تنوع جيد في الموضوعات" },
      depth: { score: 7, comment: "يمكن تعميق بعض الأفكار" },
      connections: { score: 6, comment: "هناك فرص لربط أفكار أكثر" },
      actionability: { score: 8, comment: "الأفكار قابلة للتطبيق" },
      freshness: { score: 9, comment: "محتوى حديث ومُحدَّث" }
    },
    strengths: ["تنوع الموضوعات", "انتظام الإضافة", "وضوح التصنيف"],
    weaknesses: ["قلة الروابط بين الأفكار"],
    recommendations: [
      { priority: "عالي", action: "إضافة روابط بين الأفكار المتشابهة", impact: "تعزيز التفكير الشبكي" }
    ],
    summary: "قاعدة معرفة واعدة مع إمكانات عالية للتطوير."
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function formatPage(page) {
  const props = page.properties || {};
  
  // Extract title from various property types
  let title = 'بدون عنوان';
  const titleProp = props.Name || props.Title || props.title || props['الاسم'] || props['العنوان'];
  if (titleProp?.title?.[0]?.plain_text) {
    title = titleProp.title[0].plain_text;
  } else if (titleProp?.rich_text?.[0]?.plain_text) {
    title = titleProp.rich_text[0].plain_text;
  }

  // Extract other properties safely
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

  // Try to extract common properties
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

  // Map all properties dynamically
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

// Serve frontend pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));
app.get('/evaluation', (req, res) => res.sendFile(path.join(__dirname, 'public', 'evaluation.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🧠 العقل الثاني - لوحة التحكم`);
  console.log(`✅ الخادم يعمل على: http://localhost:${PORT}`);
  console.log(`📊 Dashboard:   http://localhost:${PORT}/`);
  console.log(`🗺️  الخريطة:    http://localhost:${PORT}/map`);
  console.log(`📈 التقييم:     http://localhost:${PORT}/evaluation\n`);
});
