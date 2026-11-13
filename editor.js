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
  el('add-work').disabled = !ready;
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
  for (const [index, card] of [...draft.querySelectorAll('.project-card')].entries()) {
    const button = draft.createElement('button');
    button.type = 'button';
    button.className = 'edit-control';
    button.dataset.project = index;
    button.textContent = 'Edit project';
    card.querySelector('.project-body').append(button);
  }
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
    const project = event.target.closest('[data-project]');
    if (project) {
      if (!publishing) openProject(Number(project.dataset.project));
      return;
    }
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
    if (event.target.closest('a:not([href^="#"])')) event.preventDefault();
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
    headers: {'Accept': 'application/vnd.github.object+json', ...options.headers}
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
    const html = current.content
      ? new TextDecoder().decode(Uint8Array.from(atob(current.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)))
      : await loadLargePage();
    page = new DOMParser().parseFromString(html, 'text/html');
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

const workDialog = el('work-dialog');
const workForm = el('work-form');
const projectImage = el('project-image');
let projectIndex = null;

const galleryStyles = `
  .project-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr)); gap:1.25rem; margin-top:1.6rem; }
  .project-card { display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--line); border-radius:16px; background:#fff; box-shadow:0 4px 14px #1639750b; }
  .project-photos { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,145px),1fr)); gap:.55rem; padding:.75rem; }
  .project-image { width:100%; aspect-ratio:4/3; object-fit:contain; background:#eef4ff; display:block; border-radius:8px; }
  .project-body { display:grid; align-content:start; gap:.6rem; flex:1; padding:1rem 1.15rem 1.2rem; }
  .project-body p { color:var(--muted); white-space:pre-line; overflow-wrap:anywhere; }
  .project-body a { justify-self:start; font-weight:700; }
  .project-body button { justify-self:start; }
  @media(prefers-reduced-motion:no-preference) {
    .project-card { transition:transform .18s ease,box-shadow .18s ease; }
    .project-card:hover { transform:translateY(-3px); box-shadow:0 9px 24px #1639751c; }
  }
`;

function openProject(index = null) {
  projectIndex = index;
  const card = index === null ? null : page.querySelectorAll('.project-card')[index];
  workForm.reset();
  el('work-title').textContent = card ? 'Edit project' : 'Add a project';
  el('project-name').value = card?.querySelector('h3')?.textContent || '';
  el('project-description').value = card?.querySelector('p')?.textContent || '';
  el('project-url').value = card?.querySelector('a')?.getAttribute('href') || '';
  el('project-alt').value = (card?.querySelector('img')?.getAttribute('alt') || '').replace(/ — image \d+$/, '');
  el('image-hint').textContent = card?.querySelector('img')
    ? 'Leave blank to keep the existing photos, or select a new set to replace them.'
    : 'Select one or more JPG, PNG, or WebP files, up to 12 MB each.';
  el('work-status').textContent = '';
  el('delete-work').hidden = !card;
  workDialog.showModal();
}

function ensureGallery() {
  let gallery = page.querySelector('#selected-work');
  if (gallery) return gallery.querySelector('.project-grid');
  gallery = page.createElement('section');
  gallery.className = 'section wrap';
  gallery.id = 'selected-work';
  gallery.setAttribute('aria-labelledby', 'selected-work-title');
  gallery.innerHTML = '<h2 id="selected-work-title">Selected work</h2><div class="project-grid"></div>';
  page.querySelector('#education').before(gallery);
  const link = page.createElement('a');
  link.href = '#selected-work';
  link.textContent = 'Selected work';
  page.querySelector('.nav-contact').before(link);
  if (!page.querySelector('#project-styles')) {
    const style = page.createElement('style');
    style.id = 'project-styles';
    style.textContent = galleryStyles;
    page.head.append(style);
  }
  return gallery.querySelector('.project-grid');
}

async function projectPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 12_000_000) {
    throw new Error('Choose a JPG, PNG, or WebP image under 12 MB.');
  }
  const image = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .79);
  } finally {
    image.close();
  }
}

function showGalleryPreview() {
  preview.addEventListener('load', () => {
    preview.contentDocument.querySelector('#selected-work')?.scrollIntoView();
  }, {once: true});
  renderPreview();
  markChanged();
  workDialog.close();
}

el('add-work').addEventListener('click', () => openProject());
el('cancel-work').addEventListener('click', () => { if (!photoBusy) workDialog.close(); });
workDialog.addEventListener('cancel', (event) => { if (photoBusy) event.preventDefault(); });
el('delete-work').addEventListener('click', () => {
  if (photoBusy) return;
  page.querySelectorAll('.project-card')[projectIndex].remove();
  if (!page.querySelector('.project-card')) {
    page.querySelector('#selected-work').remove();
    page.querySelector('.nav a[href="#selected-work"]').remove();
  }
  showGalleryPreview();
});
workForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (photoBusy) return;
  const title = el('project-name').value.trim();
  const description = el('project-description').value.trim();
  const url = el('project-url').value.trim();
  if (!title || (url && !/^https?:\/\//i.test(url))) {
    el('work-status').textContent = 'Enter a project title and, if adding a link, use https:// or http://.';
    return;
  }
  const old = projectIndex === null ? null : page.querySelectorAll('.project-card')[projectIndex];
  photoBusy = true;
  updateControls();
  el('save-work').disabled = true;
  el('work-status').textContent = '';
  try {
    const files = [...projectImage.files];
    const images = [];
    if (files.length) {
      for (const file of files) images.push(await projectPhoto(file));
    } else {
      for (const image of old?.querySelectorAll('img') || []) images.push(image.getAttribute('src'));
    }
    const card = page.createElement('article');
    card.className = 'project-card';
    const body = page.createElement('div');
    body.className = 'project-body';
    if (images.length) {
      const tiles = page.createElement('div');
      tiles.className = 'project-photos';
      for (const [index, src] of images.entries()) {
        const element = page.createElement('img');
        element.className = 'project-image';
        const description = el('project-alt').value.trim() || title;
        element.alt = images.length > 1 ? description + ' — image ' + (index + 1) : description;
        element.loading = 'lazy';
        element.src = src;
        tiles.append(element);
      }
      card.append(tiles);
    }
    const heading = page.createElement('h3');
    heading.textContent = title;
    body.append(heading);
    if (description) {
      const text = page.createElement('p');
      text.textContent = description;
      body.append(text);
    }
    if (url) {
      const link = page.createElement('a');
      link.href = url;
      link.textContent = 'View project ↗';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      body.append(link);
    }
    card.append(body);
    if (old) old.replaceWith(card);
    else ensureGallery().append(card);
    showGalleryPreview();
  } catch (error) {
    el('work-status').textContent = error instanceof DOMException
      ? 'That image could not be opened. Try a different file.'
      : error.message;
  } finally {
    photoBusy = false;
    el('save-work').disabled = false;
    updateControls();
  }
});
async function loadLargePage() {
  const response = await fetch(endpoint + '?ref=main', {
    cache: 'no-store',
    headers: {'Accept': 'application/vnd.github.raw+json'}
  });
  if (!response.ok) throw new Error('Portfolio could not be loaded.');
  return response.text();
}
load();


