import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDrawings } from '../src/pipeline.js';

test('failed drawings are partial, and a successful retry clears the error', () => {
  const job = { steps: [{ status: 'ready' }, { status: 'failed' }] };
  summarizeDrawings(job);
  assert.equal(job.status, 'partial');
  assert.match(job.error, /1 of 2 plates failed/);
  job.steps[1].status = 'ready';
  summarizeDrawings(job);
  assert.equal(job.status, 'ready');
  assert.equal(job.stage, 'ready');
  assert.equal(job.error, null);
});
