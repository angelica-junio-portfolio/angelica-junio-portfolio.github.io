'use strict';

const repo = 'angelica-junio-portfolio/angelica-junio-portfolio.github.io';
const endpoint = 'https://api.github.com/repos/' + repo + '/contents/index.html';
const el = (id) => document.getElementById(id);
const preview = el('preview');
const publish = el('publish');
const photo = el('photo');
const removePhoto = el('remove-photo');
const access = el('access');
const textEditor = el('text-editor');
const textValue = el('text-value');
const editable = [
  '.hero .eyebrow', '#hero-title', '.hero-copy', '.hero-card-caption strong',
  '.hero-card-caption p', '.skills li', '.role-title', '.org', '.period',
  '.role-body li', '.role-body h3', '.location', '.education h3', '.education p',
  '#contact-title', '.contact-inner p'
].join(',');

let page;
let revision;
let accessKey = '';
let editing;
let dirty = false;
let photoBusy = false;
let publishing = false;

const previewStyles = `
  .edit-wrap { display:inline-flex; vertical-align:middle; margin-inline:.35rem; }
  .edit-control { border:1px solid #b0c7f1; background:#f0f5ff; color:#183f91;
    padding:.22rem .55rem; border-radius:99px; font:700 .72rem/1.3 "Segoe UI",sans-serif; cursor:pointer; }
  .edit-control:hover { background:#2452bb; color:#fff; }
  .edit-control:focus-visible { outline:2px solid #2452bb; outline-offset:2px; }
`;
const profileStyles = `
  .hero-card:has(.portfolio-photo) { padding:0; }
  .portfolio-photo { display:block; width:100%; height:clamp(200px,27vw,340px); object-fit:cover; object-position:center 35%; }
  .hero-card:has(.portfolio-photo) .hero-card-caption { padding:1rem 1.5rem; }
  .hero-card:has(.portfolio-photo) .monogram { display:none; }
`;

function updateControls() {
  const ready = Boolean(page) && !publishing && !photoBusy;
  publish.disabled = !ready || !dirty;
  photo.disabled = !ready;
  el('choose-photo').disabled = !ready;
  removePhoto.disabled = !ready;
  removePhoto.hidden = !page?.querySelector('.portfolio-photo');
}

function markChanged() {
  dirty = true;
  el('status').textContent = 'Changes are in the preview. Choose Publish updates to put them live.';
  updateControls();
}

function renderPreview() {
  const draft = page.cloneNode(true);
  draft.querySelectorAll('script').forEach((script) => script.remove());
  draft.querySelectorAll('details').forEach((detail) => { detail.open = true; });
  const style = draft.createElement('style');
  style.textContent = previewStyles;
  draft.head.append(style);
  const targets = [...draft.querySelectorAll(editable)];
  for (const [index, target] of targets.entries()) {
    const marker = draft.createElement('span');
    marker.className = 'edit-wrap';
    const button = draft.createElement('button');
    button.type = 'button';
    button.className = 'edit-control';
    button.dataset.field = index;
    button.textContent = 'Edit';
    button.setAttribute('aria-label', 'Edit ' + target.textContent.trim().slice(0, 75));
    marker.append(button);
    target.after(marker);
  }
  preview.srcdoc = '<!doctype html>\n' + draft.documentElement.outerHTML;
}

preview.addEventListener('load', () => {
  preview.contentDocument?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-field]');
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      if (publishing) return;
      editing = page.querySelectorAll(editable)[Number(button.dataset.field)];
      textValue.value = editing.textContent.trim();
      textEditor.showModal();
      textValue.focus();
      return;
    }
    if (event.target.closest('a[href^="mailto:"]')) event.preventDefault();
  }, true);
});

el('cancel-text').addEventListener('click', () => textEditor.close());
el('edit-text').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = textValue.value.trim();
  if (!value || value === editing.textContent.trim()) {
    textEditor.close();
    return;
  }
  editing.textContent = value;
  const frame = preview.contentWindow;
  const top = frame.scrollY;
  preview.addEventListener('load', () => preview.contentWindow.scrollTo(0, top), {once: true});
  renderPreview();
  markChanged();
  textEditor.close();
});

el('choose-photo').addEventListener('click', () => photo.click());
photo.addEventListener('change', async () => {
  const file = photo.files[0];
  photo.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12_000_000) {
    el('status').textContent = 'Choose a JPG, PNG, or WebP photo under 12 MB.';
    return;
  }
  photoBusy = true;
  updateControls();
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d', {alpha: false}).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .82);
    if (!page.querySelector('#portfolio-photo-style')) {
      const style = page.createElement('style');
      style.id = 'portfolio-photo-style';
      style.textContent = profileStyles;
      page.head.append(style);
    }
    let image = page.querySelector('.portfolio-photo');
    if (!image) {
      image = page.createElement('img');
      image.className = 'portfolio-photo';
      image.alt = 'Profile photo of ' + page.querySelector('.hero-card-caption strong').textContent.trim();
      page.querySelector('.hero-card').prepend(image);
    }
    image.src = data;
    renderPreview();
    markChanged();
  } catch {
    el('status').textContent = 'That photo could not be opened. Try another JPG or PNG.';
  } finally {
    bitmap?.close();
    photoBusy = false;
    updateControls();
  }
});

removePhoto.addEventListener('click', () => {
  page.querySelector('.portfolio-photo')?.remove();
  renderPreview();
  markChanged();
});

async function request(options = {}) {
  const response = await fetch(endpoint + (options.method ? '' : '?ref=main'), {
    cache: 'no-store',
    ...options,
    headers: {'Accept': 'application/vnd.github+json', ...options.headers}
  });
  if (!response.ok) {
    const error = new Error('GitHub returned ' + response.status);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  }
  return btoa(binary);
}

async function load() {
  try {
    const current = await request();
    const bytes = Uint8Array.from(atob(current.content.replace(/\s/g, '')), (character) => character.charCodeAt(0));
    page = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html');
    if (!page.querySelector('#hero-title') || !page.querySelector('#work-roles')) throw new Error('Portfolio markup not found.');
    revision = current.sha;
    renderPreview();
    el('status').textContent = 'Choose Edit on the preview to make a change.';
  } catch {
    page = undefined;
    el('status').textContent = 'Could not load the portfolio from GitHub. Refresh to try again.';
  }
  updateControls();
}

async function save() {
  publishing = true;
  updateControls();
  el('confirm').disabled = true;
  el('auth-status').textContent = '';
  el('status').textContent = 'Sending your update to GitHub…';
  try {
    const data = await request({
      method: 'PUT',
      headers: {'Authorization': 'Bearer ' + accessKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: 'Update Angelica’s portfolio',
        branch: 'main',
        sha: revision,
        content: encode('<!doctype html>\n' + page.documentElement.outerHTML + '\n')
      })
    });
    revision = data.content.sha;
    dirty = false;
    access.close();
    el('status').textContent = 'Saved to GitHub. The public site will update after GitHub Pages finishes deploying.';
  } catch (error) {
    if ([401, 403, 404].includes(error.status)) {
      accessKey = '';
      el('auth-status').textContent = 'GitHub did not accept the key. Check that it has write access to this portfolio.';
      if (!access.open) access.showModal();
      el('status').textContent = 'The changes are still in your preview.';
    } else if (error.status === 409 || error.status === 422) {
      access.close();
      el('status').textContent = 'GitHub could not save this version. The file may have changed. Copy your changes before refreshing.';
    } else {
      access.close();
      el('status').textContent = 'The update could not be sent. Your changes are still here. Try publishing again.';
    }
  } finally {
    publishing = false;
    el('confirm').disabled = false;
    updateControls();
  }
}

publish.addEventListener('click', () => {
  if (accessKey) save();
  else access.showModal();
});
el('cancel').addEventListener('click', () => { if (!publishing) access.close(); });
access.addEventListener('cancel', (event) => { if (publishing) event.preventDefault(); });
el('authorize').addEventListener('submit', (event) => {
  event.preventDefault();
  if (publishing) return;
  accessKey = el('token').value.trim();
  el('token').value = '';
  if (accessKey) save();
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

load();
