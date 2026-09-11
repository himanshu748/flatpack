import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropFor } from '../src/hands.js';

test('crops a wide shot around the person box and keeps it inside the frame', () => {
  const box = cropFor([[120.9, 0.8, 350.6, 156.6]], 480, 270, 1280, 720);
  assert.ok(box.w < 1280 && box.h < 720);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 1280 && box.y + box.h <= 720);
  assert.ok(box.x <= (120.9 * 1280) / 480 && box.x + box.w >= (350.6 * 1280) / 480);
});

test('skips close-ups where the person already fills most of the frame', () => {
  assert.equal(cropFor([[2, 0.2, 368.4, 258.4]], 480, 270, 1280, 720), null);
});

test('never crops tighter than 40% of either side', () => {
  const box = cropFor([[200, 100, 210, 110]], 480, 270, 1280, 720);
  assert.ok(box.w >= 1280 * 0.4 - 2 && box.h >= 720 * 0.4 - 2);
});

test('joins several people into one crop', () => {
  const box = cropFor([[10, 10, 60, 60], [300, 150, 360, 200]], 480, 270, 480, 270);
  assert.ok(box.x <= 10 && box.x + box.w >= 360);
});
