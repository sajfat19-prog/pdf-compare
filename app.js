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
const addedCount = document.getElementById('addedCount');
const removedCount = document.getElementById('removedCount');
const searchInput = document.getElementById('searchInput');

let pdfjsLib = null;
let addedNames = [];
let removedNames = [];

oldFile.addEventListener('change', () => {
  oldName.textContent = oldFile.files[0]?.name || 'لم يتم اختيار ملف';
});

newFile.addEventListener('change', () => {
  newName.textContent = newFile.files[0]?.name || 'لم يتم اختيار ملف';
});

function normalize(s = '') {
  return String(s)
    .replace(/[\u00a0\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function digits(s = '') {
  return normalize(s).replace(/[٠-٩]/g, d =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  );
}

function isNumberToken(s) {
  return /^\d+$/.test(digits(s));
}

function buildTextRows(items) {
  const groups = [];
  const Y_TOLERANCE = 3;

  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;

    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);

    let group = groups.find(g => Math.abs(g.y - y) <= Y_TOLERANCE);

    if (!group) {
      group = { y, items: [] };
      groups.push(group);
    }

    group.items.push({ x, y, str: item.str });
  }

  groups.sort((a, b) => b.y - a.y);

  return groups.map(g => {
    g.items.sort((a, b) => a.x - b.x);
    return g.items;
  });
}

function parseRowItems(rowItems) {
  if (!rowItems || rowItems.length < 7) return null;

  const raw = rowItems.map(x => normalize(x.str)).filter(Boolean);
  if (raw.length < 7) return null;

  const vals = raw.map(digits);

  // FLOUR table: blocked, eligible, total, name, old card, card, serial
  if (!isNumberToken(vals[0]) ||
      !isNumberToken(vals[1]) ||
      !isNumberToken(vals[2])) {
    return null;
  }

  const oldCard = vals[vals.length - 3];

  if (!/^\d{6,10}$/.test(oldCard)) return null;
  if (!isNumberToken(vals[vals.length - 2])) return null;
  if (!isNumberToken(vals[vals.length - 1])) return null;

  const total = Number(vals[2]);
  const eligible = Number(vals[1]);
  const blocked = Number(vals[0]);

  if (eligible > total || blocked > total || total > 999) return null;

  const nameParts = raw.slice(3, -3);
  if (!nameParts.length) return null;

  const name = normalize(nameParts.reverse().join(' '));
  if (!name) return null;

  return {
    key: oldCard.padStart(7, '0'),
    name
  };
}

function parseCandidateText(text) {
  const t = normalize(digits(text));
  const out = [];

  const re =
    /(\d{1,4})\s+(\d{1,20})\s+(\d{6,10})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?=\s|$)/g;

  let m;

  while ((m = re.exec(t))) {
    const total = Number(m[5]);
    const eligible = Number(m[6]);
    const blocked = Number(m[7]);

    if (eligible > total || blocked > total) continue;

    out.push({
      key: m[3].padStart(7, '0'),
      name: normalize(m[4])
    });
  }

  return out;
}

async function extractPdf(file, label) {
  if (!pdfjsLib) {
    throw new Error('محرك قراءة PDF غير جاهز. أعد فتح الموقع مع اتصال بالإنترنت.');
  }

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

    if (!pageRecords.length) {
      const text = content.items.map(x => x.str).join(' ');
      pageRecords = parseCandidateText(text);
    }

    for (const r of pageRecords) {
      map.set(r.key, r);
    }

    const pct = Math.round((p / pdf.numPages) * 100);
    progressBar.style.width = pct + '%';
    progressText.textContent =
      `${label}: الصفحة ${p} من ${pdf.numPages}`;
  }

  return [...map.values()];
}

function compareNames(oldRows, newRows) {
  const oldMap = new Map(oldRows.map(r => [r.key, r.name]));
  const newMap = new Map(newRows.map(r => [r.key, r.name]));

  const added = [];
  const removed = [];

  // جديد بالكامل
  for (const [key, name] of newMap) {
    if (!oldMap.has(key)) {
      added.push({ key, name });
    }
  }

  // محذوف بالكامل
  for (const [key, name] of oldMap) {
    if (!newMap.has(key)) {
      removed.push({ key, name });
    }
  }

  // نفس البطاقة ولكن الاسم تغيّر:
  // الاسم القديم = محذوف، الاسم الجديد = مضاف
  for (const [key, newName] of newMap) {
    if (oldMap.has(key)) {
      const oldName = oldMap.get(key);

      if (normalize(oldName) !== normalize(newName)) {
        removed.push({ key, name: oldName });
        added.push({ key, name: newName });
      }
    }
  }

  // منع التكرار
  const unique = arr => {
    const seen = new Set();
    return arr.filter(x => {
      const id = `${x.key}|${normalize(x.name)}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  return {
    added: unique(added).sort((a, b) => a.key.localeCompare(b.key)),
    removed: unique(removed).sort((a, b) => a.key.localeCompare(b.key))
  };
}

function renderList(container, rows, emptyText) {
  container.innerHTML = '';

  if (!rows.length) {
    container.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  rows.forEach((row, i) => {
    const item = document.createElement('div');
    item.className = 'name-row';
    item.innerHTML = `
      <span class="number">${i + 1}</span>
      <div class="name-content">
        <strong>${escapeHtml(row.name)}</strong>
        <small>رقم البطاقة القديم: ${escapeHtml(row.key)}</small>
      </div>
    `;
    container.appendChild(item);
  });
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c]));
}

function render() {
  const q = normalize(searchInput.value).toLowerCase();

  const filter = rows =>
    rows.filter(r =>
      `${r.name} ${r.key}`.toLowerCase().includes(q)
    );

  const a = filter(addedNames);
  const r = filter(removedNames);

  renderList(addedList, a, 'لا توجد أسماء جديدة مضافة');
  renderList(removedList, r, 'لا توجد أسماء محذوفة');

  addedCount.textContent = a.length;
  removedCount.textContent = r.length;
}

compareBtn.addEventListener('click', async () => {
  message.textContent = '';

  if (!oldFile.files[0] || !newFile.files[0]) {
    message.textContent =
      'يرجى اختيار ملف PDF القديم وملف PDF الجديد أولاً.';
    return;
  }

  compareBtn.disabled = true;
  progressBox.classList.remove('hidden');
  resultsSection.classList.add('hidden');

  try {
    progressBar.style.width = '0%';

    const oldRows = await extractPdf(
      oldFile.files[0],
      'الملف القديم'
    );

    progressBar.style.width = '0%';

    const newRows = await extractPdf(
      newFile.files[0],
      'الملف الجديد'
    );

    const result = compareNames(oldRows, newRows);

    addedNames = result.added;
    removedNames = result.removed;

    searchInput.value = '';
    render();

    resultsSection.classList.remove('hidden');

    message.textContent =
      `تمت المقارنة: ${addedNames.length} اسم مضاف، و${removedNames.length} اسم محذوف.`;
  } catch (e) {
    console.error(e);
    message.textContent =
      'حدث خطأ أثناء قراءة ملفات PDF: ' + (e?.message || e);
  } finally {
    compareBtn.disabled = false;
    progressBox.classList.add('hidden');
  }
});

searchInput.addEventListener('input', render);

clearBtn.addEventListener('click', () => {
  oldFile.value = '';
  newFile.value = '';

  oldName.textContent = 'لم يتم اختيار ملف';
  newName.textContent = 'لم يتم اختيار ملف';

  addedNames = [];
  removedNames = [];

  searchInput.value = '';
  resultsSection.classList.add('hidden');
  message.textContent = '';
  render();
});

async function loadPdfJs() {
  try {
    pdfjsLib = await import(
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
    );

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

    message.textContent = 'جاهز للمقارنة.';
  } catch (e) {
    console.error(e);
    message.textContent =
      'تعذر تحميل محرك PDF. افتح الموقع مع اتصال بالإنترنت.';
  }
}

loadPdfJs();
