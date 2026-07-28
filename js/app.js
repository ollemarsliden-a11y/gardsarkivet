import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const CATEGORY_NAMES = {
  kopekontrakt: 'Köpekontrakt', servitut: 'Servitut', gavobrev: 'Gåvobrev',
  avtal: 'Avtal', foton: 'Foton', ovrigt: 'Övrigt',
};

const configured = !SUPABASE_URL.startsWith('FYLL_I');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = (id) => document.getElementById(id);
let currentCategory = 'alla';
let currentDocs = [];
let searchTerm = '';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function showStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('error', isError);
}

// ---------- Inloggning ----------

async function init() {
  if (!configured) {
    showStatus($('login-status'), 'Appen är inte konfigurerad ännu – fyll i js/config.js enligt README.', true);
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  setView(session);
  supabase.auth.onAuthStateChange((_event, session) => setView(session));
}

function setView(session) {
  $('login-view').hidden = !!session;
  $('main-view').hidden = !session;
  if (session) {
    $('user-email').textContent = session.user.email;
    loadDocuments();
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.href },
  });
  if (error) {
    showStatus($('login-status'), 'Kunde inte skicka länk: ' + error.message, true);
  } else {
    showStatus($('login-status'), 'Klart! Kolla din mejl och klicka på länken.');
  }
});

$('google-btn').addEventListener('click', async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) showStatus($('login-status'), 'Google-inloggningen misslyckades: ' + error.message, true);
});

$('logout-btn').addEventListener('click', () => supabase.auth.signOut());

// ---------- Dokumentlista ----------

async function loadDocuments() {
  const list = $('doc-list');
  let query = supabase.from('documents').select('*').order('created_at', { ascending: false });
  if (currentCategory !== 'alla') query = query.eq('category', currentCategory);
  const { data, error } = await query;
  if (error) {
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-msg';
    p.textContent = 'Kunde inte hämta dokument: ' + error.message;
    list.appendChild(p);
    return;
  }
  currentDocs = data;
  await loadCommentCounts();
  renderDocuments(filteredDocs());
}

// ---------- Kommentarer ----------

let commentCounts = {};
let commentDoc = null;

async function loadCommentCounts() {
  const { data } = await supabase.from('comments').select('document_id');
  commentCounts = {};
  for (const row of data ?? []) {
    commentCounts[row.document_id] = (commentCounts[row.document_id] ?? 0) + 1;
  }
}

async function openComments(doc) {
  commentDoc = doc;
  $('comment-title').textContent = 'Kommentarer – ' + doc.title;
  $('comment-input').value = '';
  $('comment-dialog').showModal();
  await renderComments();
}

async function renderComments() {
  const list = $('comment-list');
  list.innerHTML = '';
  const { data, error } = await supabase.from('comments')
    .select('*').eq('document_id', commentDoc.id).order('created_at');
  if (error) {
    list.textContent = 'Kunde inte hämta kommentarer: ' + error.message;
    return;
  }
  if (!data.length) {
    const p = document.createElement('p');
    p.className = 'empty-msg';
    p.textContent = 'Inga kommentarer ännu. Vet du vilka som är med på bilden, eller vad dokumentet gäller?';
    list.append(p);
    return;
  }
  const { data: { user } } = await supabase.auth.getUser();
  for (const c of data) {
    const wrap = document.createElement('article');
    wrap.className = 'comment';
    const body = document.createElement('p');
    body.textContent = c.body;
    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    meta.append(`${c.author_email} · ${new Date(c.created_at).toLocaleDateString('sv-SE')}`);
    if (c.author_email === user.email) {
      const del = document.createElement('button');
      del.className = 'comment-del';
      del.textContent = 'Ta bort';
      del.addEventListener('click', async () => {
        if (!confirm('Ta bort kommentaren?')) return;
        await supabase.from('comments').delete().eq('id', c.id);
        await renderComments();
        await loadCommentCounts();
        renderDocuments(filteredDocs());
      });
      meta.append(del);
    }
    wrap.append(body, meta);
    list.append(wrap);
  }
}

$('comment-close-btn').addEventListener('click', () => $('comment-dialog').close());

$('comment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('comments').insert({
    document_id: commentDoc.id,
    body: $('comment-input').value.trim(),
    author_email: user.email,
  });
  if (error) {
    alert('Kunde inte spara kommentaren: ' + error.message);
    return;
  }
  $('comment-input').value = '';
  await renderComments();
  await loadCommentCounts();
  renderDocuments(filteredDocs());
});

function filteredDocs() {
  // Söker i namn, beskrivning, årtal och texten som lästs ur skannade dokument
  const träffar = searchTerm
    ? currentDocs.filter((doc) =>
      [doc.title, doc.description, doc.year, doc.ocr_text].join(' ').toLowerCase().includes(searchTerm))
    : [...currentDocs];

  const sort = $('sort-select').value;
  // Dokument utan årtal hamnar sist vid årtalssortering
  const år = (d) => d.year ?? (sort === 'ar-gammalt' ? Infinity : -Infinity);
  if (sort === 'ar-gammalt') träffar.sort((a, b) => år(a) - år(b));
  else if (sort === 'ar-nytt') träffar.sort((a, b) => år(b) - år(a));
  else if (sort === 'namn') träffar.sort((a, b) => a.title.localeCompare(b.title, 'sv'));
  return träffar;
}

$('sort-select').addEventListener('change', () => renderDocuments(filteredDocs()));

$('search-input').addEventListener('input', () => {
  searchTerm = $('search-input').value.trim().toLowerCase();
  renderDocuments(filteredDocs());
});

function renderDocuments(docs) {
  const list = $('doc-list');
  list.innerHTML = '';
  if (!docs.length) {
    const p = document.createElement('p');
    p.className = 'empty-msg';
    p.textContent = 'Inga dokument här ännu. Tryck på knappen ovan för att ladda upp det första!';
    list.appendChild(p);
    return;
  }
  for (const doc of docs) {
    const card = document.createElement('article');
    card.className = 'doc-card';

    const h3 = document.createElement('h3');
    h3.textContent = doc.title;

    const meta = document.createElement('p');
    meta.className = 'doc-meta';
    if (doc.year) {
      const year = document.createElement('span');
      year.className = 'doc-year';
      year.textContent = doc.year;
      meta.append(year);
    }
    const date = new Date(doc.created_at).toLocaleDateString('sv-SE');
    meta.append(`${CATEGORY_NAMES[doc.category] ?? doc.category} · uppladdad ${date} av ${doc.uploaded_by_email}`);

    card.append(h3, meta);

    if (doc.description) {
      const desc = document.createElement('p');
      desc.className = 'doc-desc';
      desc.textContent = doc.description;
      card.append(desc);
    }

    const actions = document.createElement('div');
    actions.className = 'doc-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'btn btn-primary';
    openBtn.textContent = 'Öppna';
    openBtn.addEventListener('click', () => openDocument(doc, openBtn));

    const moveSel = document.createElement('select');
    moveSel.className = 'cat-move';
    moveSel.title = 'Flytta till annan kategori';
    for (const [value, name] of Object.entries(CATEGORY_NAMES)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = name;
      opt.selected = value === doc.category;
      moveSel.append(opt);
    }
    moveSel.addEventListener('change', async () => {
      const { error } = await supabase.from('documents')
        .update({ category: moveSel.value }).eq('id', doc.id);
      if (error) {
        alert('Kunde inte flytta: ' + error.message);
        moveSel.value = doc.category;
      } else {
        loadDocuments();
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = '✕ Radera';
    delBtn.addEventListener('click', () => deleteDocument(doc, delBtn));

    const commentBtn = document.createElement('button');
    commentBtn.className = 'btn';
    commentBtn.textContent = 'Kommentarer';
    const count = commentCounts[doc.id];
    if (count) {
      const badge = document.createElement('span');
      badge.className = 'comment-count';
      badge.textContent = `(${count})`;
      commentBtn.append(' ', badge);
    }
    commentBtn.addEventListener('click', () => openComments(doc));

    actions.append(openBtn, commentBtn, moveSel, delBtn);
    card.append(actions);

    list.append(card);
  }
}

async function openDocument(doc, btn) {
  btn.disabled = true;
  btn.textContent = 'Hämtar…';
  try {
    const { data, error } = await supabase.functions.invoke('r2', {
      body: { action: 'sign-download', key: doc.file_key },
    });
    if (error) throw error;
    window.open(data.url, '_blank');
  } catch (err) {
    alert('Kunde inte öppna dokumentet: ' + (err.message ?? err));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Öppna';
  }
}

async function deleteDocument(doc, btn) {
  if (!confirm(`Radera "${doc.title}"? Detta går inte att ångra.`)) return;
  btn.disabled = true;
  btn.textContent = 'Raderar…';
  try {
    // Ta bort filen ur lagringen (görs på servern), sedan raden i databasen
    const { error } = await supabase.functions.invoke('r2', {
      body: { action: 'delete', key: doc.file_key },
    });
    if (error) throw error;
    const { error: dbError } = await supabase.from('documents').delete().eq('id', doc.id);
    if (dbError) throw dbError;
    loadDocuments();
  } catch (err) {
    alert('Kunde inte radera: ' + (err.message ?? err));
    btn.disabled = false;
    btn.textContent = '✕ Radera';
  }
}

// ---------- Kategorifilter ----------

$('category-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  currentCategory = btn.dataset.cat;
  document.querySelectorAll('.cat-btn').forEach((b) => b.classList.toggle('active', b === btn));
  loadDocuments();
});

// ---------- Skanning med kameran ----------

let scanResult = null;    // { blob, filename, mime, kategori } – används av uppladdningen
let scanSourceImg = null; // originalbilden, så att man kan växla läge utan ny bild
let scanMode = 'doc';     // 'doc' = svartvit A4-PDF, 'photo' = färgfoto i JPEG

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Kunde inte ladda ' + src));
    document.head.append(s);
  });
}

let scanLibsPromise = null;
function loadScanLibs() {
  scanLibsPromise ??= (async () => {
    // OpenCV är stor (~10 MB) – laddas bara första gången man skannar
    await loadScript('https://docs.opencv.org/4.7.0/opencv.js');
    if (!window.cv?.Mat) {
      await new Promise((resolve) => { window.cv['onRuntimeInitialized'] = resolve; });
    }
    await loadScript('https://cdn.jsdelivr.net/npm/jscanify@1.4.0/src/jscanify.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  })();
  return scanLibsPromise;
}

$('scan-btn').addEventListener('click', () => {
  scanPages = [];
  $('scan-input').click();
});

let scanStage = 'adjust'; // 'adjust' = dra i hörnen, 'preview' = färdigt resultat
let cropCorners = null;   // fyra hörn i originalbildens koordinater
let scanPages = [];       // färdiga sidor som dataURL, för flersidiga dokument
const CORNER_KEYS = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'];

$('scan-input').addEventListener('change', async () => {
  const file = $('scan-input').files[0];
  if (!file) return;
  $('scan-dialog').showModal();
  $('scan-preview').hidden = true;
  for (const id of ['scan-retake-btn', 'scan-back-btn', 'scan-continue-btn', 'scan-accept-btn']) {
    $(id).hidden = true;
  }
  showStatus($('scan-status'), 'Bearbetar bilden – första gången kan det ta en liten stund…');
  try {
    await loadScanLibs();
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    scanSourceImg = img;
    cropCorners = detectPaper(img)?.corners ?? cannyCorners(img) ?? defaultCorners(img);
    enterAdjustStage();
  } catch (err) {
    showStatus($('scan-status'), 'Fel vid bearbetning: ' + (err.message ?? err), true);
  }
  $('scan-input').value = '';
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Hittar papperets/fotots hörn i bilden. Returnerar null om inget rimligt
// hittas – t.ex. när detekteringen låst sig på något litet (en bokstav) och
// beskärningen skulle bli en hårt inzoomad felbeskärning.
function detectPaper(img) {
  try {
    const scanner = new jscanify();
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    srcCanvas.getContext('2d').drawImage(img, 0, 0);
    const mat = cv.imread(srcCanvas);
    const contour = scanner.findPaperContour(mat);
    mat.delete();
    if (!contour) return null;
    const corners = scanner.getCornerPoints(contour);
    const quadArea = 0.5 * Math.abs(
      (corners.topRightCorner.x - corners.bottomLeftCorner.x) * (corners.bottomRightCorner.y - corners.topLeftCorner.y) -
      (corners.bottomRightCorner.x - corners.topLeftCorner.x) * (corners.topRightCorner.y - corners.bottomLeftCorner.y));
    if (quadArea < 0.06 * img.width * img.height) return null;
    return { corners };
  } catch {
    return null;
  }
}

// Kraftfullare kantletning (Canny) för när jscanify inte hittar något –
// klarar svagare kontrast, t.ex. vitt papper på ljust bord.
function cannyCorners(img) {
  try {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const src = cv.imread(c);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const edges = new cv.Mat();
    cv.Canny(gray, edges, 50, 150);
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null;
    let bestArea = 0.06 * img.width * img.height;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area > bestArea) {
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * cv.arcLength(cnt, true), true);
        if (approx.rows === 4) {
          best = [];
          for (let j = 0; j < 4; j++) best.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
          bestArea = area;
        }
        approx.delete();
      }
      cnt.delete();
    }
    src.delete(); gray.delete(); edges.delete(); kernel.delete(); contours.delete(); hier.delete();
    return best ? orderCorners(best) : null;
  } catch {
    return null;
  }
}

function orderCorners(pts) {
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  return {
    topLeftCorner: bySum[0], bottomRightCorner: bySum[3],
    topRightCorner: byDiff[3], bottomLeftCorner: byDiff[0],
  };
}

function defaultCorners(img) {
  const mx = img.width * 0.08, my = img.height * 0.08;
  return {
    topLeftCorner: { x: mx, y: my },
    topRightCorner: { x: img.width - mx, y: my },
    bottomRightCorner: { x: img.width - mx, y: img.height - my },
    bottomLeftCorner: { x: mx, y: img.height - my },
  };
}

// ----- Steg 1: justera hörnen -----

let adjustScale = 1;

function enterAdjustStage() {
  scanStage = 'adjust';
  $('scan-accept-btn').hidden = true;
  $('scan-back-btn').hidden = true;
  $('sharpen-row').hidden = true;
  $('scan-retake-btn').hidden = false;
  $('scan-continue-btn').hidden = false;
  $('scan-preview').hidden = false;
  drawAdjust();
  showStatus($('scan-status'), 'Dra i hörnen så att den blå ramen följer kanterna. Tryck sedan på Beskär.');
}

function drawAdjust() {
  const img = scanSourceImg;
  const canvas = $('scan-preview');
  const ctx = canvas.getContext('2d');
  adjustScale = Math.min(1, 1200 / Math.max(img.width, img.height));
  canvas.width = Math.round(img.width * adjustScale);
  canvas.height = Math.round(img.height * adjustScale);
  ctx.filter = 'none';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const pts = CORNER_KEYS.map((k) => ({ x: cropCorners[k].x * adjustScale, y: cropCorners[k].y * adjustScale }));
  ctx.strokeStyle = '#1d5b8f';
  ctx.lineWidth = Math.max(2, canvas.width / 250);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(29, 91, 143, 0.35)';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(12, canvas.width / 45), 0, 7);
    ctx.fill();
    ctx.stroke();
  }
}

let dragCorner = null;

function pointerToCanvas(e) {
  const canvas = $('scan-preview');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * canvas.width / rect.width,
    y: (e.clientY - rect.top) * canvas.height / rect.height,
  };
}

$('scan-preview').addEventListener('pointerdown', (e) => {
  if (scanStage !== 'adjust' || !cropCorners) return;
  const p = pointerToCanvas(e);
  const grabRadius = Math.max(40, $('scan-preview').width / 15);
  let best = null, bestD = grabRadius;
  for (const k of CORNER_KEYS) {
    const d = Math.hypot(cropCorners[k].x * adjustScale - p.x, cropCorners[k].y * adjustScale - p.y);
    if (d < bestD) { best = k; bestD = d; }
  }
  if (best) {
    dragCorner = best;
    $('scan-preview').setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

$('scan-preview').addEventListener('pointermove', (e) => {
  if (!dragCorner) return;
  const p = pointerToCanvas(e);
  const img = scanSourceImg;
  cropCorners[dragCorner] = {
    x: Math.min(img.width, Math.max(0, p.x / adjustScale)),
    y: Math.min(img.height, Math.max(0, p.y / adjustScale)),
  };
  drawAdjust();
});

$('scan-preview').addEventListener('pointerup', () => { dragCorner = null; });

// ----- Steg 2: färdigbehandlat resultat -----

function enterPreviewStage() {
  scanStage = 'preview';
  $('scan-continue-btn').hidden = true;
  $('scan-retake-btn').hidden = false;
  $('scan-back-btn').hidden = false;
  $('scan-accept-btn').hidden = false;
  $('scan-addpage-btn').hidden = scanMode !== 'doc';
  $('sharpen-row').hidden = false;
  renderScan(scanSourceImg);
  updatePageCount();
}

function updatePageCount() {
  const el = $('page-count');
  if (scanMode !== 'doc' || scanPages.length === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = scanPages.length === 1
    ? 'Sida 1 är sparad – detta blir sida 2.'
    : `${scanPages.length} sidor sparade – detta blir sida ${scanPages.length + 1}.`;
}

// Sparar sidan som visas och öppnar kameran för nästa
$('scan-addpage-btn').addEventListener('click', () => {
  scanPages.push($('scan-preview').toDataURL('image/jpeg', 0.85));
  $('scan-dialog').close();
  $('scan-input').click();
});

// Oskarp mask: skärper genom att dra bort en suddig kopia, plus lätt kontrastlyft.
// Räddar inte riktigt oskarpa bilder, men lyfter mjuka/matta original tydligt.
function enhanceCanvas(canvas) {
  const src = cv.imread(canvas);
  const blur = new cv.Mat();
  cv.GaussianBlur(src, blur, new cv.Size(0, 0), 3);
  const dst = new cv.Mat();
  cv.addWeighted(src, 1.6, blur, -0.6, 0, dst);
  dst.convertTo(dst, -1, 1.06, 3);
  cv.imshow(canvas, dst);
  src.delete(); blur.delete(); dst.delete();
}

function renderScan(img) {
  const canvas = $('scan-preview');
  const ctx = canvas.getContext('2d');
  const c = cropCorners;

  if (scanMode === 'doc') {
    // Räta upp till A4-proportioner (150 dpi), svartvitt med hög kontrast
    const W = 1240, H = 1754;
    const source = new jscanify().extractPaper(img, W, H, c);
    canvas.width = W;
    canvas.height = H;
    ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.08)';
    ctx.drawImage(source, 0, 0, W, H);
    ctx.filter = 'none';
    showStatus($('scan-status'), 'Kolla att texten är läsbar. Behöver ramen flyttas – tryck på Justera hörnen.');
  } else {
    // Fotoläge: samma beskärning men i färg och med fotots egna proportioner
    const w = Math.round((dist(c.topLeftCorner, c.topRightCorner) + dist(c.bottomLeftCorner, c.bottomRightCorner)) / 2);
    const h = Math.round((dist(c.topLeftCorner, c.bottomLeftCorner) + dist(c.topRightCorner, c.bottomRightCorner)) / 2);
    const scale = Math.min(1, 2000 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const source = new jscanify().extractPaper(img, canvas.width, canvas.height, c);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    showStatus($('scan-status'), 'Fotot sparas i färg, beskuret enligt ramen. Behöver den flyttas – tryck på Justera hörnen.');
  }
  if ($('sharpen-check').checked) enhanceCanvas(canvas);
  canvas.hidden = false;
}

$('sharpen-check').addEventListener('change', () => {
  if (scanSourceImg && scanStage === 'preview') renderScan(scanSourceImg);
});

$('scan-continue-btn').addEventListener('click', enterPreviewStage);
$('scan-back-btn').addEventListener('click', enterAdjustStage);

for (const [btnId, mode] of [['mode-doc-btn', 'doc'], ['mode-photo-btn', 'photo']]) {
  $(btnId).addEventListener('click', () => {
    scanMode = mode;
    $('mode-doc-btn').classList.toggle('active', mode === 'doc');
    $('mode-photo-btn').classList.toggle('active', mode === 'photo');
    if (scanSourceImg && scanStage === 'preview') renderScan(scanSourceImg);
  });
}

$('scan-cancel-btn').addEventListener('click', () => $('scan-dialog').close());
$('scan-retake-btn').addEventListener('click', () => {
  $('scan-dialog').close();
  $('scan-input').click();
});

$('scan-accept-btn').addEventListener('click', () => {
  const canvas = $('scan-preview');
  if (scanMode === 'doc') {
    const sidor = [...scanPages, canvas.toDataURL('image/jpeg', 0.85)];
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    sidor.forEach((sida, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(sida, 'JPEG', 0, 0, 210, 297);
    });
    scanResult = {
      blob: pdf.output('blob'), filename: 'skanning.pdf',
      mime: 'application/pdf', kategori: null, sidor,
    };
    scanPages = [];
    $('scan-dialog').close();
    openUploadDialog(true);
  } else {
    canvas.toBlob((blob) => {
      scanResult = { blob, filename: 'foto.jpg', mime: 'image/jpeg', kategori: 'foton', sidor: [] };
      $('scan-dialog').close();
      openUploadDialog(true);
    }, 'image/jpeg', 0.92);
  }
});

// ---------- Textläsning (OCR) ----------

// Läser texten i de skannade sidorna så att sökrutan hittar innehållet.
// Körs bara på dokument, aldrig på foton, och får misslyckas tyst.
async function lasTextUrSidor(sidor) {
  if (!sidor?.length) return null;
  try {
    if (!window.Tesseract) {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }
    const delar = [];
    for (const sida of sidor.slice(0, 10)) { // tak: 10 sidor, annars tar det för lång tid
      const { data } = await Tesseract.recognize(sida, 'swe');
      delar.push(data.text);
    }
    const text = delar.join('\n').replace(/\s+/g, ' ').trim();
    return text.length > 20 ? text.slice(0, 50000) : null;
  } catch {
    return null; // OCR är en bonus – uppladdningen ska aldrig falla på detta
  }
}

// ---------- Uppladdning ----------

function openUploadDialog(fromScan) {
  if (!fromScan) scanResult = null;
  $('upload-form').reset();
  if (currentCategory !== 'alla') $('cat-input').value = currentCategory;
  if (scanResult?.kategori) $('cat-input').value = scanResult.kategori;
  $('file-input').required = !scanResult;
  $('file-input').style.display = scanResult ? 'none' : '';
  document.querySelector('label[for="file-input"]').style.display = scanResult ? 'none' : '';
  if (scanResult) {
    const antal = scanResult.sidor?.length ?? 1;
    showStatus($('upload-status'), scanResult.mime === 'application/pdf'
      ? `Skannad PDF redo (${antal} ${antal === 1 ? 'sida' : 'sidor'}) – ge den ett namn och välj kategori.`
      : 'Inskannat foto redo – ge det ett namn.');
  } else {
    $('upload-status').hidden = true;
  }
  $('upload-dialog').showModal();
}

$('upload-open-btn').addEventListener('click', () => openUploadDialog(false));

$('upload-cancel-btn').addEventListener('click', () => $('upload-dialog').close());

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = scanResult
    ? new File([scanResult.blob], scanResult.filename, { type: scanResult.mime })
    : $('file-input').files[0];
  if (!file) return;
  const submitBtn = $('upload-submit-btn');
  submitBtn.disabled = true;
  showStatus($('upload-status'), 'Laddar upp…');

  try {
    // 1. Be edge-funktionen om en signerad uppladdnings-URL till R2
    const safeName = file.name.replace(/[^a-zA-Z0-9._åäöÅÄÖ-]/g, '_');
    const key = `${$('cat-input').value}/${Date.now()}_${safeName}`;
    let signData;
    try {
      const { data, error } = await supabase.functions.invoke('r2', {
        body: { action: 'sign-upload', key, contentType: file.type || 'application/octet-stream' },
      });
      if (error) throw error;
      signData = data;
    } catch (err) {
      throw new Error('steg 1, signering: ' + (err.message ?? err));
    }

    // 2. Ladda upp filen direkt till R2
    try {
      const putRes = await fetch(signData.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error('svarskod ' + putRes.status);
    } catch (err) {
      throw new Error('steg 2, uppladdning till lagringen: ' + (err.message ?? err));
    }

    // 3. Läs texten ur skannade dokument, så att sökrutan hittar innehållet
    let ocrText = null;
    if (scanResult?.mime === 'application/pdf') {
      showStatus($('upload-status'), 'Läser texten i dokumentet så att det blir sökbart…');
      ocrText = await lasTextUrSidor(scanResult.sidor);
    }

    // 4. Spara metadata i databasen
    const { data: { user } } = await supabase.auth.getUser();
    const { error: dbError } = await supabase.from('documents').insert({
      title: $('title-input').value.trim(),
      category: $('cat-input').value,
      description: $('desc-input').value.trim() || null,
      year: $('year-input').value ? Number($('year-input').value) : null,
      ocr_text: ocrText,
      file_key: key,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
      uploaded_by_email: user.email,
    });
    if (dbError) throw new Error('steg 3, databasen: ' + dbError.message);

    scanResult = null;
    $('upload-dialog').close();
    loadDocuments();
  } catch (err) {
    showStatus($('upload-status'), 'Fel: ' + (err.message ?? err), true);
  } finally {
    submitBtn.disabled = false;
  }
});

init();
