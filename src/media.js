import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0
      ? resolve(Buffer.concat(out))
      : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

export async function assertFfmpeg() {
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
  } catch {
    throw new Error('Flatpack needs ffmpeg and ffprobe on PATH. On macOS run: brew install ffmpeg');
  }
}

export async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.toString().trim());
}

export async function frameSize(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [width, height] = out.toString().trim().split(',').map(Number);
  return { width, height };
}

export async function audioChunks(video, dir, seconds = 10) {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-b:a', '48k',
    '-f', 'segment', '-segment_time', String(seconds), '-c:a', 'libmp3lame', join(dir, 'chunk_%03d.mp3')]);
  const files = (await readdir(dir)).filter((f) => f.startsWith('chunk_')).sort();
  return files.map((f, i) => ({ file: join(dir, f), start: i * seconds, end: (i + 1) * seconds }));
}

// Phone and web encodes can carry corrupt packets; without these flags one bad frame aborts the grab.
export async function grabFrame(video, seconds, out) {
  for (const offset of [0, 1.5, -1.5, 3]) {
    const t = Math.max(0, seconds + offset);
    try {
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
        '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=1280:-2', out]);
      if ((await stat(out)).size > 5000) return t;
    } catch {}
  }
  throw new Error(`could not decode a frame near ${seconds}s`);
}

export async function crop(input, { x, y, w, h }, out) {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `crop=${w}:${h}:${x}:${y}`, out]);
}

export async function greyShare(file) {
  const raw = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', 'scale=512:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  let mid = 0;
  for (const b of raw) if (b > 60 && b < 200) mid++;
  return Math.round((1000 * mid) / raw.length) / 10;
}
