import { lastUrl, runCapability } from './livepeer.js';

const PAD = 0.18;
const MIN_SIDE = 0.4;
const SKIP_ABOVE = 0.6;

// yolo-detect answers in a downscaled space reported as image_size, not in source pixels.
export async function handBox(frameUrl, { width, height }, sessionId) {
  const { text, data } = await runCapability('yolo-detect', { image_url: frameUrl }, sessionId, 40);
  const res = await fetch(data.url || lastUrl(text), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const { detections = [], image_size: [dw, dh] = [] } = await res.json();
  const people = detections.filter((d) => d.cls === 'person' && d.conf >= 0.4);
  if (!people.length || !dw || !dh) return null;
  return cropFor(people.map((d) => d.xyxy), dw, dh, width, height);
}

export function cropFor(boxes, dw, dh, width, height) {
  let [x1, y1, x2, y2] = boxes.reduce((a, b) => [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]),
  ]);
  x1 *= width / dw; x2 *= width / dw; y1 *= height / dh; y2 *= height / dh;
  if (((x2 - x1) * (y2 - y1)) / (width * height) > SKIP_ABOVE) return null;

  const padX = (x2 - x1) * PAD;
  const padY = (y2 - y1) * PAD;
  [x1, x2] = grow(x1 - padX, x2 + padX, width * MIN_SIDE, width);
  [y1, y2] = grow(y1 - padY, y2 + padY, height * MIN_SIDE, height);
  const even = (v) => Math.floor(v / 2) * 2;
  return { x: even(x1), y: even(y1), w: even(x2 - x1), h: even(y2 - y1) };
}

function grow(lo, hi, minSize, limit) {
  if (hi - lo < minSize) {
    const mid = (lo + hi) / 2;
    lo = mid - minSize / 2;
    hi = mid + minSize / 2;
  }
  if (lo < 0) { hi -= lo; lo = 0; }
  if (hi > limit) { lo -= hi - limit; hi = limit; }
  return [Math.max(0, lo), Math.min(limit, hi)];
}
