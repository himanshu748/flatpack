export const LINE_ART = 'Convert this video frame into an instruction-manual line drawing. Output only thin black outlines on pure white. '
  + 'Every surface stays white inside its outline: no grey, no fills, no shading, no hatching, no gradients. '
  + 'Erase all logos, labels, lettering and numbers. Keep the same objects, hand positions and composition. '
  + 'Remove the background and the table surface.';

export const MAX_STEPS = 8;

export function stepsPrompt(chunks) {
  const lines = chunks.filter((c) => c.text).map((c) => `[${c.start}-${c.end}s] ${c.text}`).join('\n');
  return 'You split a narrated how-to video into the steps of a wordless instruction manual. Below is the transcript in timed '
    + '10-second chunks. Return ONLY a JSON array, no prose. Include only physical actions the viewer must perform, in order; '
    + `skip greetings, tips and chit-chat. At most ${MAX_STEPS} steps. Each item: {"n": int, "title": imperative 3 to 7 words, `
    + '"start": seconds, "end": seconds, "keyframe": seconds when the action is most visible (usually past the middle of the step)}.\n\n'
    + lines;
}

export function parseSteps(body, videoSeconds) {
  const match = body.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('the step list was not JSON');
  return JSON.parse(match[0])
    .filter((s) => s && typeof s.title === 'string' && Number.isFinite(Number(s.keyframe)))
    .slice(0, MAX_STEPS)
    .map((s, i) => ({
      n: i + 1,
      title: s.title.trim(),
      start: clamp(Number(s.start), 0, videoSeconds),
      end: clamp(Number(s.end), 0, videoSeconds),
      keyframe: clamp(Number(s.keyframe), 0, Math.max(0, videoSeconds - 0.5)),
    }));
}

function clamp(v, lo, hi) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
