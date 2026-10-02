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
const summary = document.getElementById('summary');
const resultsBody = document.getElementById('resultsBody');
const searchInput = document.getElementById('searchInput');
const filterSelect = document.getElementById('filterSelect');
const excelBtn = document.getElementById('excelBtn');

let allResults = [];

oldFile.addEventListener('change', () => oldName.textContent = oldFile.files[0]?.name || 'لم يتم اختيار ملف');
newFile.addEventListener('change', () => newName.textContent = newFile.files[0]?.name || 'لم يتم اختيار ملف');

function normalize(s=''){
  return s.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
}
function digits(s=''){
  return s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
function cleanNumber(s){ return parseInt(digits(s),10); }

function parseCandidateText(text){
  // The PDFs used for this project contain rows with:
  // serial, card number, old card number, household name, total, eligible, blocked.
  // This parser searches for the old-card number and the three trailing counts.
  const t = normalize(digits(text));
  const out = [];

  const re = /(\d{1,6})\s+(\d{1,20})\s+(\d{6,10})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?=\s|$)/g;
  let m;
  while((m = re.exec(t))){
    const total=cleanNumber(m[5]), eligible=cleanNumber(m[6]), blocked=cleanNumber(m[7]);
    if(eligible > total || blocked > total) continue;
    out.push({
      key:m[3].padStart(7,'0'),
      card:m[2],
      name:normalize(m[4]),
      total, eligible, blocked
    });
  }
  return out;
}

async function extractPdf(file, label){
  const pdfjs = globalThis.pdfjsLib;
  if(!pdfjs) throw new Error('لم يتم تحميل محرك قراءة PDF. تحقق من اتصال الإنترنت ثم أعد المحاولة.');
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({data}).promise;
  const records = [];
  for(let p=1;p<=pdf.numPages;p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map(x => x.str).join(' ');
    records.push(...parseCandidateText(text));
    const pct = Math.round((p/pdf.numPages)*100);
    progressBar.style.width = pct+'%';
    progressText.textContent = `${label}: الصفحة ${p} من ${pdf.numPages}`;
  }
  // Keep the last occurrence for duplicate keys.
  const map = new Map();
  for(const r of records) map.set(r.key,r);
  return [...map.values()];
}

function compare(oldRows,newRows){
  const oldMap = new Map(oldRows.map(r=>[r.key,r]));
  const newMap = new Map(newRows.map(r=>[r.key,r]));
  const keys = [...new Set([...oldMap.keys(),...newMap.keys()])];

  return keys.map(key=>{
    const a=oldMap.get(key), b=newMap.get(key);
    if(!a) return {...b,status:'added',details:'السجل موجود في الملف الجديد فقط'};
    if(!b) return {...a,status:'removed',details:'السجل موجود في الملف القديم فقط'};

    const changes=[];
    if(a.name!==b.name) changes.push(`الاسم: «${a.name}» ← «${b.name}»`);
    if(a.total!==b.total) changes.push(`الأفراد الكلية: ${a.total} ← ${b.total}`);
    if(a.eligible!==b.eligible) changes.push(`المستحقة: ${a.eligible} ← ${b.eligible}`);
    if(a.blocked!==b.blocked) changes.push(`المحجوبين: ${a.blocked} ← ${b.blocked}`);

    return {...b,status:changes.length?'changed':'same',
      oldName:a.name,oldTotal:a.total,oldEligible:a.eligible,oldBlocked:a.blocked,
      details:changes.join(' | ')};
  });
}

function render(){
  const q=normalize(searchInput.value).toLowerCase();
  const f=filterSelect.value;
  const rows=allResults.filter(r=>{
    const matchesFilter=f==='all'||r.status===f;
    const hay=[r.key,r.card,r.name,r.oldName||'',r.details||''].join(' ').toLowerCase();
    return matchesFilter && hay.includes(q);
  });
  resultsBody.innerHTML='';
  const labels={added:'مضاف',removed:'محذوف',changed:'متغير',same:'بدون تغيير'};
  for(const r of rows){
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><span class="status ${r.status}">${labels[r.status]}</span></td>
      <td>${escapeHtml(r.key)}</td>
      <td>${escapeHtml(r.name||'')}</td>
      <td>${r.total ?? ''}</td>
      <td>${r.eligible ?? ''}</td>
      <td>${r.blocked ?? ''}</td>
      <td class="diff">${escapeHtml(r.details||'—')}</td>`;
    resultsBody.appendChild(tr);
  }
}
function escapeHtml(s=''){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

compareBtn.addEventListener('click', async()=>{
  message.textContent='';
  if(!oldFile.files[0]||!newFile.files[0]){
    message.textContent='يرجى اختيار ملف PDF القديم وملف PDF الجديد أولاً.';
    return;
  }
  progressBox.classList.remove('hidden');
  summary.classList.add('hidden'); resultsSection.classList.add('hidden');
  compareBtn.disabled=true;
  try{
    progressBar.style.width='0%';
    const oldRows=await extractPdf(oldFile.files[0],'الملف القديم');
    progressBar.style.width='0%';
    const newRows=await extractPdf(newFile.files[0],'الملف الجديد');
    allResults=compare(oldRows,newRows);
    const counts={added:0,removed:0,changed:0,same:0};
    allResults.forEach(r=>counts[r.status]++);
    document.getElementById('totalCount').textContent=allResults.length;
    document.getElementById('addedCount').textContent=counts.added;
    document.getElementById('removedCount').textContent=counts.removed;
    document.getElementById('changedCount').textContent=counts.changed;
    document.getElementById('sameCount').textContent=counts.same;
    summary.classList.remove('hidden');
    resultsSection.classList.remove('hidden');
    render();
    if(!allResults.length) message.textContent='لم يتم العثور على سجلات. قد يحتاج تنسيق PDF إلى تعديل في محلل الصفوف.';
  }catch(e){
    console.error(e);
    message.textContent='حدث خطأ أثناء قراءة الملفات: '+e.message;
  }finally{
    compareBtn.disabled=false;
    progressBox.classList.add('hidden');
  }
});

searchInput.addEventListener('input',render);
filterSelect.addEventListener('change',render);

excelBtn.addEventListener('click',()=>{
  if(!allResults.length) return;
  const labels={added:'مضاف',removed:'محذوف',changed:'متغير',same:'بدون تغيير'};
  const data=allResults.map(r=>({
    'الحالة':labels[r.status],
    'رقم البطاقة القديم':r.key,
    'اسم رب الأسرة':r.name||'',
    'الأفراد الكلية':r.total??'',
    'المستحقة':r.eligible??'',
    'المحجوبين':r.blocked??'',
    'تفاصيل التغيير':r.details||''
  }));
  const ws=XLSX.utils.json_to_sheet(data);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'المقارنة');
  XLSX.writeFile(wb,'نتيجة_مقارنة_PDF.xlsx');
});

clearBtn.addEventListener('click',()=>{
  oldFile.value=''; newFile.value='';
  oldName.textContent='لم يتم اختيار ملف'; newName.textContent='لم يتم اختيار ملف';
  allResults=[]; resultsBody.innerHTML='';
  summary.classList.add('hidden'); resultsSection.classList.add('hidden');
  message.textContent=''; searchInput.value=''; filterSelect.value='all';
});

(async function loadPdfJs(){
  // PDF.js is an ES module on the CDN. Import it dynamically so the page remains a simple HTML site.
  try{
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    globalThis.pdfjsLib=pdfjs;
  }catch(e){
    console.error(e);
    message.textContent='تعذر تحميل مكتبة قراءة PDF. افتح الموقع مع اتصال بالإنترنت.';
  }
})();
