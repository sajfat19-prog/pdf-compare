const oldFile = document.getElementById('oldFile');
const newFile = document.getElementById('newFile');
const oldName = document.getElementById('oldName');
const newName = document.getElementById('newName');
const compareBtn = document.getElementById('compareBtn');
const clearBtn = document.getElementById('clearBtn');
const progressBox = document.getElementById('progressBox');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const message = document.getElementById('message');
const resultsSection = document.getElementById('resultsSection');
const addedList = document.getElementById('addedList');
const removedList = document.getElementById('removedList');
const changedList = document.getElementById('changedList');
const addedCount = document.getElementById('addedCount');
const removedCount = document.getElementById('removedCount');
const changedCount = document.getElementById('changedCount');
const searchInput = document.getElementById('searchInput');

let pdfjsLib = null;
let resultData = { added: [], removed: [], changed: [] };

oldFile.addEventListener('change', () => oldName.textContent = oldFile.files[0]?.name || 'لم يتم اختيار ملف');
newFile.addEventListener('change', () => newName.textContent = newFile.files[0]?.name || 'لم يتم اختيار ملف');

function normalize(s = '') {
  return String(s)
    .replace(/[\u00a0\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(s = '') {
  return normalize(s).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function isNumberToken(s) { return /^\d+$/.test(digits(s)); }

function buildTextRows(items) {
  const groups = [];
  const Y_TOLERANCE = 3;
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    let group = groups.find(g => Math.abs(g.y - y) <= Y_TOLERANCE);
    if (!group) { group = { y, items: [] }; groups.push(group); }
    group.items.push({ x, y, str: item.str });
  }
  groups.sort((a, b) => b.y - a.y);
  return groups.map(g => {
    g.items.sort((a, b) => a.x - b.x);
    return g.items;
  });
}

function makeRecord(key, card, serial, name, total, eligible, blocked) {
  return {
    key: String(key).padStart(7, '0'),
    card: String(card || ''),
    serial: String(serial || ''),
    name: normalize(name),
    total: Number(total),
    eligible: Number(eligible),
    blocked: Number(blocked)
  };
}

function parseRowItems(rowItems) {
  if (!rowItems || rowItems.length < 7) return null;
  const raw = rowItems.map(x => normalize(x.str)).filter(Boolean);
  if (raw.length < 7) return null;
  const vals = raw.map(digits);

  // ترتيب جدول FLOUR المستخرج عادةً: المحجوب، المستحق، الكلي، الاسم، البطاقة القديمة، البطاقة، التسلسل
  if (!isNumberToken(vals[0]) || !isNumberToken(vals[1]) || !isNumberToken(vals[2])) return null;

  const oldCard = vals[vals.length - 3];
  const card = vals[vals.length - 2];
  const serial = vals[vals.length - 1];
  if (!/^\d{6,10}$/.test(oldCard) || !isNumberToken(card) || !isNumberToken(serial)) return null;

  const total = Number(vals[2]);
  const eligible = Number(vals[1]);
  const blocked = Number(vals[0]);
  if (eligible > total || blocked > total || total > 999) return null;

  const nameParts = raw.slice(3, -3);
  if (!nameParts.length) return null;
  const name = normalize(nameParts.reverse().join(' '));
  if (!name) return null;

  return makeRecord(oldCard, card, serial, name, total, eligible, blocked);
}

function parseCandidateText(text) {
  const t = normalize(digits(text));
  const out = [];
  const re = /(\d{1,4})\s+(\d{1,20})\s+(\d{6,10})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?=\s|$)/g;
  let m;
  while ((m = re.exec(t))) {
    const total = Number(m[5]), eligible = Number(m[6]), blocked = Number(m[7]);
    if (eligible > total || blocked > total) continue;
    out.push(makeRecord(m[3], m[2], m[1], m[4], total, eligible, blocked));
  }
  return out;
}

async function extractPdf(file, label) {
  if (!pdfjsLib) throw new Error('محرك قراءة PDF غير جاهز. أعد فتح الموقع مع اتصال بالإنترنت.');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const map = new Map();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent({ disableNormalization: false });
    const rows = buildTextRows(content.items);
    let pageRecords = [];
    for (const row of rows) {
      const record = parseRowItems(row);
      if (record) pageRecords.push(record);
    }
    if (!pageRecords.length) pageRecords = parseCandidateText(content.items.map(x => x.str).join(' '));
    for (const r of pageRecords) map.set(r.key, r);

    const pct = Math.round((p / pdf.numPages) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent = `${label}: الصفحة ${p} من ${pdf.numPages} — تم العثور على ${map.size} سجل`;
    await new Promise(requestAnimationFrame);
  }
  return [...map.values()];
}

function recordEqual(a, b) {
  return normalize(a.name) === normalize(b.name) &&
    String(a.card) === String(b.card) &&
    Number(a.total) === Number(b.total) &&
    Number(a.eligible) === Number(b.eligible) &&
    Number(a.blocked) === Number(b.blocked);
}

function compareRecords(oldRows, newRows) {
  const oldMap = new Map(oldRows.map(r => [r.key, r]));
  const newMap = new Map(newRows.map(r => [r.key, r]));
  const added = [], removed = [], changed = [];

  for (const [key, n] of newMap) {
    if (!oldMap.has(key)) added.push(n);
    else if (!recordEqual(oldMap.get(key), n)) changed.push({ key, old: oldMap.get(key), new: n });
  }
  for (const [key, o] of oldMap) if (!newMap.has(key)) removed.push(o);

  added.sort((a,b) => a.key.localeCompare(b.key));
  removed.sort((a,b) => a.key.localeCompare(b.key));
  changed.sort((a,b) => a.key.localeCompare(b.key));
  return { added, removed, changed, totalOld: oldRows.length, totalNew: newRows.length };
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function field(label, oldValue, newValue) {
  const same = normalize(String(oldValue)) === normalize(String(newValue));
  return `<div class="field ${same ? '' : 'different'}"><span>${label}</span><div><b class="old-val">${escapeHtml(oldValue)}</b><span class="arrow"> ← </span><b class="new-val">${escapeHtml(newValue)}</b></div></div>`;
}

function renderAdded(rows) {
  addedList.innerHTML = rows.length ? rows.map((r,i) => `
    <div class="record-card added-card"><div class="record-title"><span class="number">${i+1}</span><b>سجل جديد مضاف</b></div>
      <div class="field-grid">
        <div class="field"><span>رقم البطاقة القديم</span><b>${escapeHtml(r.key)}</b></div>
        <div class="field"><span>رقم البطاقة</span><b>${escapeHtml(r.card)}</b></div>
        <div class="field"><span>اسم رب الأسرة</span><b>${escapeHtml(r.name)}</b></div>
        <div class="field"><span>الأفراد الكلية</span><b>${r.total}</b></div>
        <div class="field"><span>الأفراد المستحقة</span><b>${r.eligible}</b></div>
        <div class="field"><span>الأفراد المحجوبين</span><b>${r.blocked}</b></div>
      </div></div>`).join('') : '<div class="empty">لا توجد سجلات جديدة مضافة</div>';
}

function renderRemoved(rows) {
  removedList.innerHTML = rows.length ? rows.map((r,i) => `
    <div class="record-card removed-card"><div class="record-title"><span class="number">${i+1}</span><b>سجل محذوف</b></div>
      <div class="field-grid">
        <div class="field"><span>رقم البطاقة القديم</span><b>${escapeHtml(r.key)}</b></div>
        <div class="field"><span>رقم البطاقة</span><b>${escapeHtml(r.card)}</b></div>
        <div class="field"><span>اسم رب الأسرة</span><b>${escapeHtml(r.name)}</b></div>
        <div class="field"><span>الأفراد الكلية</span><b>${r.total}</b></div>
        <div class="field"><span>الأفراد المستحقة</span><b>${r.eligible}</b></div>
        <div class="field"><span>الأفراد المحجوبين</span><b>${r.blocked}</b></div>
      </div></div>`).join('') : '<div class="empty">لا توجد سجلات محذوفة</div>';
}

function renderChanged(rows) {
  changedList.innerHTML = rows.length ? rows.map((r,i) => {
    const o=r.old, n=r.new;
    return `<div class="record-card changed-card"><div class="record-title"><span class="number">${i+1}</span><b>اختلاف في السجل</b><small>البطاقة القديمة: ${escapeHtml(r.key)}</small></div>
      ${field('رقم البطاقة', o.card, n.card)}
      ${field('اسم رب الأسرة', o.name, n.name)}
      ${field('الأفراد الكلية', o.total, n.total)}
      ${field('الأفراد المستحقة', o.eligible, n.eligible)}
      ${field('الأفراد المحجوبين', o.blocked, n.blocked)}
    </div>`;
  }).join('') : '<div class="empty">لا توجد سجلات متغيرة</div>';
}

function render() {
  const q = normalize(searchInput.value).toLowerCase();
  const matches = r => {
    const text = r.key + ' ' + r.name + ' ' + r.card;
    return text.toLowerCase().includes(q);
  };
  const added = resultData.added.filter(matches);
  const removed = resultData.removed.filter(matches);
  const changed = resultData.changed.filter(r => matches(r.new) || matches(r.old));
  renderAdded(added); renderRemoved(removed); renderChanged(changed);
  addedCount.textContent = added.length;
  removedCount.textContent = removed.length;
  changedCount.textContent = changed.length;
}

compareBtn.addEventListener('click', async () => {
  message.textContent = '';
  if (!oldFile.files[0] || !newFile.files[0]) {
    message.textContent = 'يرجى اختيار ملف PDF القديم وملف PDF الجديد أولاً.';
    return;
  }
  compareBtn.disabled = true;
  progressBox.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  try {
    progressBar.style.width = '0%';
    const oldRows = await extractPdf(oldFile.files[0], 'الملف القديم');
    progressBar.style.width = '0%';
    const newRows = await extractPdf(newFile.files[0], 'الملف الجديد');
    resultData = compareRecords(oldRows, newRows);
    searchInput.value = '';
    render();
    resultsSection.classList.remove('hidden');
    message.textContent = `تمت المقارنة: ${resultData.added.length} جديد، ${resultData.removed.length} محذوف، ${resultData.changed.length} متغير. السجلات المطابقة تمامًا لا تظهر.`;
  } catch (e) {
    console.error(e);
    message.textContent = 'حدث خطأ أثناء قراءة ملفات PDF: ' + (e?.message || e);
  } finally {
    compareBtn.disabled = false;
    progressBox.classList.add('hidden');
  }
});

searchInput.addEventListener('input', render);
clearBtn.addEventListener('click', () => {
  oldFile.value = ''; newFile.value = '';
  oldName.textContent = 'لم يتم اختيار ملف'; newName.textContent = 'لم يتم اختيار ملف';
  resultData = { added: [], removed: [], changed: [] };
  searchInput.value = '';
  resultsSection.classList.add('hidden'); message.textContent = ''; render();
});

async function loadPdfJs() {
  try {
    pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    message.textContent = 'جاهز للمقارنة.';
  } catch (e) {
    console.error(e);
    message.textContent = 'تعذر تحميل محرك PDF. افتح الموقع مع اتصال بالإنترنت.';
  }
}
loadPdfJs();
