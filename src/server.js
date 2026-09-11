import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { assertFfmpeg } from './media.js';
import { drawStep, mergeIntoNext, processJob, refreshCost, removeStep } from './pipeline.js';
import { createJob, getJob, jobDir, listJobs, loadJobs } from './store.js';

const PORT = Number(process.env.PORT || 8787);
const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const SAMPLE = join(ROOT, 'samples', 'sketchbook.mp4');
const VIDEO_TYPES = ['.mp4', '.mov', '.webm', '.m4v', '.mkv'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function view(job) {
  const { video, ...rest } = job;
  return rest;
}

async function serveFile(req, res, file) {
  let info;
  try {
    info = await stat(file);
  } catch {
    return json(res, 404, { error: 'not found' });
  }
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function uploadVideo(req, res, url) {
  const name = basename(url.searchParams.get('name') || 'video.mp4');
  const ext = extname(name).toLowerCase();
  if (!VIDEO_TYPES.includes(ext)) return json(res, 415, { error: 'Upload an mp4, mov, webm, m4v or mkv video.' });
  const job = await createJob({ name });
  job.video = join(jobDir(job.id), `source${ext}`);
  await pipeline(req, createWriteStream(job.video));
  processJob(job);
  return json(res, 201, view(job));
}

async function startSample(res) {
  try {
    await stat(SAMPLE);
  } catch {
    return json(res, 404, { error: 'The sample video is missing from samples/.' });
  }
  const job = await createJob({ name: 'How to make a simple sketch book (sample)', sample: true });
  job.video = join(jobDir(job.id), 'source.mp4');
  await copyFile(SAMPLE, job.video);
  processJob(job);
  return json(res, 201, view(job));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
    if (!parts.length) return serveFile(req, res, join(PUBLIC_DIR, 'index.html'));
    if (parts.length === 1 && /^[\w.-]+$/.test(parts[0])) return serveFile(req, res, join(PUBLIC_DIR, parts[0]));
    return json(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' && parts[1] === 'jobs' && parts.length === 2) {
    return json(res, 200, listJobs().slice(0, 12).map((j) => ({
      id: j.id, name: j.name, status: j.status, steps: j.steps.length, createdAt: j.createdAt,
    })));
  }
  if (req.method === 'POST' && parts[1] === 'jobs' && parts.length === 2) return uploadVideo(req, res, url);
  if (req.method === 'POST' && parts[1] === 'sample') return startSample(res);

  const job = parts[1] === 'jobs' ? getJob(parts[2]) : null;
  if (!job) return json(res, 404, { error: 'No such job.' });
  if (req.method === 'GET' && parts.length === 3) return json(res, 200, view(job));
  if (req.method === 'GET' && parts[3] === 'video') return serveFile(req, res, job.video);
  if (req.method === 'GET' && parts[3] === 'files' && parts[4]) return serveFile(req, res, join(jobDir(job.id), basename(parts[4])));

  const step = parts[3] === 'steps' ? job.steps.find((s) => s.id === parts[4]) : null;
  if (!step) return json(res, 404, { error: 'No such step.' });
  if (req.method === 'POST' && parts[5] === 'redraw') {
    if (step.status === 'drawing') return json(res, 409, { error: 'This plate is already being drawn.' });
    const { keyframe } = await readJson(req);
    if (keyframe !== undefined && !Number.isFinite(Number(keyframe))) return json(res, 400, { error: 'keyframe must be a number of seconds.' });
    const t = keyframe === undefined ? undefined : Math.max(0, Math.min(Number(keyframe), (job.duration || 0) - 0.5));
    drawStep(job, step, t).then(() => refreshCost(job));
    return json(res, 202, view(job));
  }
  if (req.method === 'POST' && parts[5] === 'merge') {
    await mergeIntoNext(job, step);
    return json(res, 200, view(job));
  }
  if (req.method === 'DELETE' && parts.length === 5) {
    await removeStep(job, step);
    return json(res, 200, view(job));
  }
  return json(res, 404, { error: 'not found' });
}

try {
  await assertFfmpeg();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
await loadJobs();
createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) json(res, 500, { error: err.message });
  });
}).listen(PORT, () => {
  console.log(`Flatpack is running at http://localhost:${PORT}`);
  console.log(process.env.LIVEPEER_API_KEY
    ? 'Using LIVEPEER_API_KEY for Livepeer Agent.'
    : 'LIVEPEER_API_KEY is not set, so Flatpack is using Livepeer Agent keyless demo credit.');
});
