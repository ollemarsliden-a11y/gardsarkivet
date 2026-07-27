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
  renderDocuments(data);
}

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
    actions.append(openBtn);
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

// ---------- Kategorifilter ----------

$('category-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  currentCategory = btn.dataset.cat;
  document.querySelectorAll('.cat-btn').forEach((b) => b.classList.toggle('active', b === btn));
  loadDocuments();
});

// ---------- Uppladdning ----------

$('upload-open-btn').addEventListener('click', () => {
  $('upload-form').reset();
  if (currentCategory !== 'alla') $('cat-input').value = currentCategory;
  $('upload-status').hidden = true;
  $('upload-dialog').showModal();
});

$('upload-cancel-btn').addEventListener('click', () => $('upload-dialog').close());

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('file-input').files[0];
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

    $('upload-dialog').close();
    loadDocuments();
  } catch (err) {
    showStatus($('upload-status'), 'Fel: ' + (err.message ?? err), true);
  } finally {
    submitBtn.disabled = false;
  }
});

init();
