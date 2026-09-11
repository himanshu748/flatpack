import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const DATA_DIR = join(import.meta.dirname, '..', 'data');
const jobs = new Map();

export async function createJob(fields) {
  const id = randomUUID().slice(0, 8);
  const job = { id, status: 'uploaded', createdAt: new Date().toISOString(), steps: [], events: [], cost: null, ...fields };
  await mkdir(jobDir(id), { recursive: true });
  jobs.set(id, job);
  await save(job);
  return job;
}

export function jobDir(id) {
  return join(DATA_DIR, id);
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const writes = new Map();

// Parallel workers save the same job; chaining keeps two writes from interleaving in job.json.
export function save(job) {
  const snapshot = JSON.stringify(job, null, 2);
  const next = (writes.get(job.id) || Promise.resolve())
    .then(() => writeFile(join(jobDir(job.id), 'job.json'), snapshot))
    .catch((err) => console.error(`could not save job ${job.id}: ${err.message}`));
  writes.set(job.id, next);
  return next;
}

export function log(job, message) {
  job.events.push({ at: new Date().toISOString(), message });
}

export async function loadJobs() {
  await mkdir(DATA_DIR, { recursive: true });
  for (const id of await readdir(DATA_DIR)) {
    try {
      const job = JSON.parse(await readFile(join(jobDir(id), 'job.json'), 'utf8'));
      if (job.status === 'working') job.status = 'interrupted';
      jobs.set(id, job);
    } catch {}
  }
}
