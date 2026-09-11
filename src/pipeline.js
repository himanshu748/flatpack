import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import * as livepeer from './livepeer.js';
import { handBox } from './hands.js';
import { audioChunks, crop, duration, frameSize, grabFrame, greyShare } from './media.js';
import { LINE_ART, parseSteps, stepsPrompt } from './prompts.js';
import { jobDir, log, save } from './store.js';

export const GREY_LIMIT = 8;
const MAX_SECONDS = 300;

async function pool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function stage(job, name, message) {
  job.stage = name;
  log(job, message);
  await save(job);
}

export async function processJob(job) {
  job.status = 'working';
  job.session = `flatpack-${job.id}`;
  try {
    job.duration = await duration(job.video);
    if (job.duration > MAX_SECONDS) throw new Error('Keep videos under 5 minutes for now.');
    await stage(job, 'transcribing', 'Transcribing the narration in 10 second pieces');
    job.transcript = await transcribeChunks(job);
    const missing = job.transcript.filter((c) => c.text === null).length;
    if (missing) throw new Error(`${missing} audio pieces could not be transcribed. Please try again; a partial transcript could omit steps.`);
    if (!job.transcript.some((c) => c.text)) {
      throw new Error('No narration was found. Flatpack needs a video where someone says each step out loud.');
    }
    await stage(job, 'splitting', 'Finding the steps');
    const body = await livepeer.complete(stepsPrompt(job.transcript), job.session);
    job.steps = parseSteps(body, job.duration).map((s) => ({ ...s, id: `s${s.n}`, status: 'pending' }));
    if (!job.steps.length) throw new Error('No physical steps were found in the narration.');
    await stage(job, 'drawing', `Drawing ${job.steps.length} plates`);
    await pool(job.steps, 4, (s) => drawStep(job, s));
    summarizeDrawings(job);
    await stage(job, job.status, job.error || 'Manual ready');
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    await stage(job, 'failed', `Failed: ${err.message}`);
  }
  await refreshCost(job);
}

async function transcribeChunks(job) {
  const dir = join(jobDir(job.id), 'chunks');
  await mkdir(dir, { recursive: true });
  const chunks = await audioChunks(job.video, dir);
  job.progress = { done: 0, total: chunks.length };
  await pool(chunks, 6, async (chunk) => {
    for (let attempt = 1; attempt <= 2 && chunk.text === undefined; attempt++) {
      try {
        const url = await livepeer.upload(await readFile(chunk.file), 'audio/mpeg', basename(chunk.file));
        chunk.text = await livepeer.transcribe(url);
      } catch {
        if (attempt === 2) chunk.text = null;
      }
    }
    job.progress.done++;
    await save(job);
  });
  return chunks.map(({ start, end, text }) => ({ start, end, text }));
}

export async function drawStep(job, step, keyframe) {
  const dir = jobDir(job.id);
  if (keyframe !== undefined) step.keyframe = keyframe;
  job.costPending = true;
  step.status = 'drawing';
  step.error = null;
  await save(job);
  try {
    const version = Date.now().toString(36);
    const frame = join(dir, `${step.id}-${version}-frame.jpg`);
    step.grabbedAt = await grabFrame(job.video, step.keyframe, frame);
    step.frame = basename(frame);
    let hosted = await livepeer.upload(await readFile(frame), 'image/jpeg', basename(frame));
    const box = await handBox(hosted, await frameSize(frame), job.session).catch(() => null);
    step.cropped = Boolean(box);
    if (box) {
      const cropped = join(dir, `${step.id}-${version}-crop.jpg`);
      await crop(frame, box, cropped);
      hosted = await livepeer.upload(await readFile(cropped), 'image/jpeg', basename(cropped));
    }
    const plateUrl = await livepeer.redraw(hosted, LINE_ART, job.session);
    const res = await fetch(plateUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`plate download failed with HTTP ${res.status}`);
    const plate = join(dir, `${step.id}-${version}-plate${extname(new URL(plateUrl).pathname) || '.png'}`);
    await writeFile(plate, Buffer.from(await res.arrayBuffer()));
    step.plate = basename(plate);
    step.grey = await greyShare(plate);
    step.flagged = step.grey > GREY_LIMIT;
    step.status = 'ready';
  } catch (err) {
    step.status = 'failed';
    step.error = err.message;
  }
  if (job.status !== 'working') summarizeDrawings(job);
  await save(job);
}

export function summarizeDrawings(job) {
  const failed = job.steps.filter((s) => s.status === 'failed').length;
  job.status = failed ? 'partial' : 'ready';
  job.stage = job.status;
  job.error = failed ? `${failed} of ${job.steps.length} plates failed. Redraw the failed plates before printing.` : null;
}

export async function mergeIntoNext(job, step) {
  const i = job.steps.indexOf(step);
  const next = job.steps[i + 1];
  if (!next) throw new Error('The last step has nothing to merge into.');
  next.start = Math.min(next.start, step.start);
  job.steps.splice(i, 1);
  renumber(job);
  if (job.status !== 'working') summarizeDrawings(job);
  log(job, `Merged "${step.title}" into "${next.title}"`);
  await save(job);
}

export async function removeStep(job, step) {
  job.steps.splice(job.steps.indexOf(step), 1);
  renumber(job);
  if (job.status !== 'working') summarizeDrawings(job);
  log(job, `Removed "${step.title}"`);
  await save(job);
}

function renumber(job) {
  job.steps.forEach((s, i) => { s.n = i + 1; });
}

export async function refreshCost(job) {
  job.costPending = true;
  await save(job);
  try {
    job.cost = await livepeer.sessionCost(job.session);
  } catch {}
  job.costPending = false;
  await save(job);
}
