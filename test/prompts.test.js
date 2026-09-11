import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STEPS, parseSteps, stepsPrompt } from '../src/prompts.js';

test('parses a step list and clamps times to the video length', () => {
  const steps = parseSteps('[{"n":1,"title":"Fold paper","start":30,"end":40,"keyframe":35},'
    + '{"n":2,"title":"Cut along fold","start":40,"end":999,"keyframe":999}]', 180);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].keyframe, 179.5);
  assert.equal(steps[1].end, 180);
});

test('drops items without a title or keyframe and caps the count', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ title: `Step ${i}`, start: i, end: i + 1, keyframe: i }));
  items.splice(2, 0, { start: 1, end: 2, keyframe: 1 }, { title: 'No time' });
  const steps = parseSteps(JSON.stringify(items), 60);
  assert.equal(steps.length, MAX_STEPS);
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('rejects a reply with no JSON array', () => {
  assert.throws(() => parseSteps('I could not find any steps.', 60));
});

test('the prompt leaves out chunks that failed to transcribe', () => {
  const prompt = stepsPrompt([{ start: 0, end: 10, text: 'fold the paper' }, { start: 10, end: 20, text: null }]);
  assert.ok(prompt.includes('[0-10s] fold the paper'));
  assert.ok(!prompt.includes('[10-20s]'));
});
