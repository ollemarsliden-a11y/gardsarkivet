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
  renderDocuments(filteredDocs());
}

function filteredDocs() {
  if (!searchTerm) return currentDocs;
  return currentDocs.filter((doc) =>
    (doc.title + ' ' + (doc.description ?? '')).toLowerCase().includes(searchTerm));
}

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
    const date = new Date(doc.created_at).toLocaleDateString('sv-SE');
    meta.textContent = `${CATEGORY_NAMES[doc.category] ?? doc.category} · ${date} · uppladdad av ${doc.uploaded_by_email}`;

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

    actions.append(openBtn, moveSel, delBtn);
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

$('scan-btn').addEventListener('click', () => $('scan-input').click());

$('scan-input').addEventListener('change', async () => {
  const file = $('scan-input').files[0];
  if (!file) return;
  $('scan-dialog').showModal();
  $('scan-preview').hidden = true;
  $('scan-retake-btn').hidden = true;
  $('scan-accept-btn').hidden = true;
  showStatus($('scan-status'), 'Bearbetar bilden – första gången kan det ta en liten stund…');
  try {
    await loadScanLibs();
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    scanSourceImg = img;
    renderScan(img);
  } catch (err) {
    showStatus($('scan-status'), 'Fel vid bearbetning: ' + (err.message ?? err), true);
  }
  $('scan-input').value = '';
});

function renderScan(img) {
  const canvas = $('scan-preview');
  const ctx = canvas.getContext('2d');

  if (scanMode === 'doc') {
    // Hitta pappret och räta upp det till A4-proportioner (150 dpi)
    const W = 1240, H = 1754;
    let source;
    try {
      const scanner = new jscanify();
      source = scanner.extractPaper(img, W, H);
    } catch {
      source = img; // hittade inga papperskanter – använd hela bilden
    }
    canvas.width = W;
    canvas.height = H;
    // Svartvitt med uppskruvad kontrast – som en riktig skanner
    ctx.filter = 'grayscale(1) contrast(1.5) brightness(1.08)';
    ctx.drawImage(source, 0, 0, W, H);
    ctx.filter = 'none';
    showStatus($('scan-status'), 'Kolla att texten är läsbar. Blev det fel – ta om bilden med mer ljus och rakare vinkel.');
  } else {
    // Fotoläge: behåll färg och proportioner, skala bara ner om enorm
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    showStatus($('scan-status'), 'Fotot sparas i färg precis som det ser ut här. Fota rakt ovanifrån och fyll så mycket av rutan som möjligt.');
  }

  canvas.hidden = false;
  $('scan-retake-btn').hidden = false;
  $('scan-accept-btn').hidden = false;
}

for (const [btnId, mode] of [['mode-doc-btn', 'doc'], ['mode-photo-btn', 'photo']]) {
  $(btnId).addEventListener('click', () => {
    scanMode = mode;
    $('mode-doc-btn').classList.toggle('active', mode === 'doc');
    $('mode-photo-btn').classList.toggle('active', mode === 'photo');
    if (scanSourceImg) renderScan(scanSourceImg);
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
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
    scanResult = { blob: pdf.output('blob'), filename: 'skanning.pdf', mime: 'application/pdf', kategori: null };
    $('scan-dialog').close();
    openUploadDialog(true);
  } else {
    canvas.toBlob((blob) => {
      scanResult = { blob, filename: 'foto.jpg', mime: 'image/jpeg', kategori: 'foton' };
      $('scan-dialog').close();
      openUploadDialog(true);
    }, 'image/jpeg', 0.92);
  }
});

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
    showStatus($('upload-status'), scanResult.mime === 'application/pdf'
      ? 'Skannad PDF redo – ge den ett namn och välj kategori.'
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

    // 3. Spara metadata i databasen
    const { data: { user } } = await supabase.auth.getUser();
    const { error: dbError } = await supabase.from('documents').insert({
      title: $('title-input').value.trim(),
      category: $('cat-input').value,
      description: $('desc-input').value.trim() || null,
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
