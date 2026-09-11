const $ = (id) => document.getElementById(id);
const STAGES = {
  uploaded: 'Uploaded',
  transcribing: 'Listening to the narration',
  splitting: 'Finding the steps',
  drawing: 'Drawing the plates',
  ready: 'Manual ready',
  partial: 'Some plates need another try',
  failed: 'Stopped',
  interrupted: 'Interrupted when the server restarted',
};

let job = null;
let timer = null;
let scrubStep = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function clock(t) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function showScreen(name) {
  $('start').hidden = name !== 'start';
  $('work').hidden = name !== 'work';
}

function fileUrl(name) {
  return `/api/jobs/${job.id}/files/${encodeURIComponent(name)}`;
}

async function loadRecent() {
  try {
    const list = await api('/api/jobs');
    $('recent-list').replaceChildren(...list.map((j) => el('li', {},
      el('a', { href: `#${j.id}`, textContent: j.name }),
      el('span', { className: 'cost', textContent: ` · ${j.steps} steps · ${STAGES[j.status] || j.status}` }))));
    $('recent').hidden = !list.length;
  } catch {
    $('recent').hidden = true;
  }
}

function openFromHash() {
  clearTimeout(timer);
  if (location.hash.length > 1) {
    job = { id: location.hash.slice(1) };
    $('job-name').textContent = '';
    $('steps').replaceChildren();
    showScreen('work');
    poll();
  } else {
    job = null;
    showScreen('start');
    loadRecent();
  }
}

async function begin(request) {
  $('start-error').hidden = true;
  try {
    showScreen('work');
    $('job-name').textContent = 'Uploading';
    $('stage').textContent = '';
    const created = await request();
    location.hash = created.id;
  } catch (err) {
    showScreen('start');
    $('start-error').textContent = err.message;
    $('start-error').hidden = false;
  }
}

function uploadFile(file) {
  begin(() => api(`/api/jobs?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file }));
}

async function poll() {
  clearTimeout(timer);
  const id = job.id;
  try {
    const fresh = await api(`/api/jobs/${id}`);
    if (!job || job.id !== id) return;
    job = fresh;
    render();
  } catch (err) {
    $('job-error').textContent = err.message;
    $('job-error').hidden = false;
    return;
  }
  const busy = job.costPending || job.status === 'working' || job.steps.some((s) => s.status === 'drawing');
  if (busy) timer = setTimeout(poll, 1500);
}

async function act(step, action, options) {
  try {
    job = await api(`/api/jobs/${job.id}/steps/${step.id}${action}`, options);
    render();
    poll();
  } catch (err) {
    $('job-error').textContent = err.message;
    $('job-error').hidden = false;
  }
}

function render() {
  $('job-error').hidden = !job.error;
  $('job-error').textContent = job.error || '';
  $('job-name').textContent = job.name;
  $('stage').textContent = STAGES[job.status] || STAGES[job.stage] || '';
  const p = job.progress;
  $('progress').textContent = job.stage === 'transcribing' && p ? `${p.done} of ${p.total} pieces` : '';
  $('cost').textContent = Number.isFinite(job.cost) ? `Livepeer spend $${job.cost.toFixed(2)}` : (job.costPending ? 'Checking Livepeer spend…' : 'Spend unavailable');
  $('print').disabled = job.status !== 'ready' || !job.steps.length || job.steps.some((s) => s.status !== 'ready');
  $('events').replaceChildren(...job.events.slice(-12).map((e) => el('li', { textContent: e.message })));
  $('steps').replaceChildren(...job.steps.map((step, i) => stepCard(step, i === job.steps.length - 1)));
}

function stepCard(step, isLast) {
  let body;
  if (step.status === 'drawing') body = el('div', { className: 'plate-state', textContent: 'Drawing' });
  else if (step.status === 'failed') body = el('div', { className: 'plate-state failed', textContent: step.error || 'Drawing failed' });
  else if (step.plate) body = el('img', { src: fileUrl(step.plate), alt: `Step ${step.n}: ${step.title}` });
  else body = el('div', { className: 'plate-state', textContent: 'Waiting' });

  const busy = step.status === 'drawing';
  const button = (label, handler, disabled = false) => el('button', { type: 'button', className: 'small', textContent: label, disabled, onclick: handler });
  return el('article', { className: `step${step.flagged ? ' flagged' : ''}` },
    el('div', { className: 'plate' }, el('b', { className: 'num', textContent: String(step.n) }), body),
    el('div', { className: 'meta' },
      el('span', { className: 'title', textContent: step.title }),
      el('span', { className: 'time', textContent: clock(step.grabbedAt ?? step.keyframe) })),
    step.flagged ? el('p', { className: 'flag', textContent: `Grey fill ${step.grey}%: redraw it for a cleaner line` }) : null,
    el('div', { className: 'actions' },
      button('Redraw', () => act(step, '/redraw', { method: 'POST' }), busy),
      button('Pick frame', () => openScrub(step), busy),
      button('Merge into next', () => act(step, '/merge', { method: 'POST' }), busy || isLast),
      button('Remove', () => act(step, '', { method: 'DELETE' }), busy)));
}

function openScrub(step) {
  scrubStep = step;
  const player = $('player');
  const src = `/api/jobs/${job.id}/video`;
  if (!player.src.endsWith(src)) player.src = src;
  $('scrub-n').textContent = step.n;
  const seek = () => { player.currentTime = step.grabbedAt ?? step.keyframe; };
  if (player.readyState >= 1) seek();
  else player.addEventListener('loadedmetadata', seek, { once: true });
  $('scrub').showModal();
}

function renderPrintSheet() {
  const plates = job.steps.filter((s) => s.plate);
  const credit = job.sample
    ? 'Drawn from "How to make a simple sketch book" by Boone Community Arts, Wikimedia Commons, CC BY-SA 4.0. These drawings are shared under the same license.'
    : 'Made with Flatpack and Livepeer Agent.';
  $('print-sheet').replaceChildren(
    el('header', {}, el('h1', { textContent: job.name.replace(/\.[^.]+$/, '') }), el('span', { textContent: `${plates.length} steps` })),
    el('div', { className: 'print-grid' }, ...plates.map((s) => el('figure', {},
      el('b', { textContent: String(s.n) }), el('img', { src: fileUrl(s.plate), alt: `Step ${s.n}` })))),
    el('footer', { textContent: credit }));
}

$('file').addEventListener('change', (e) => e.target.files[0] && uploadFile(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('drop').classList.remove('over');
  if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
});
$('sample').addEventListener('click', () => begin(() => api('/api/sample', { method: 'POST' })));
$('restart').addEventListener('click', () => { location.hash = ''; });
$('print').addEventListener('click', () => {
  renderPrintSheet();
  const imgs = [...$('print-sheet').querySelectorAll('img')];
  Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))).then(() => window.print());
});
$('player').addEventListener('timeupdate', () => { $('scrub-time').textContent = clock($('player').currentTime); });
$('scrub-cancel').addEventListener('click', () => $('scrub').close());
$('scrub-use').addEventListener('click', () => {
  const keyframe = $('player').currentTime;
  $('scrub').close();
  $('player').pause();
  act(scrubStep, '/redraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyframe }) });
});

window.addEventListener('hashchange', openFromHash);
openFromHash();
