const BASE = (process.env.LIVEPEER_MCP_URL || 'https://agent.livepeer.org/api/mcp').replace(/\/$/, '');
const RAW = BASE;
const CREATIVE = `${BASE}/creative`;
const KEY = process.env.LIVEPEER_API_KEY;

export class LivepeerError extends Error {
  constructor(tool, message, detail) {
    super(`${tool}: ${message}`);
    this.tool = tool;
    this.detail = detail;
  }
}

let nextId = 1;

async function callTool(endpoint, tool, args, timeoutMs) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (KEY) headers.Authorization = `Bearer ${KEY}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: tool, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new LivepeerError(tool, `HTTP ${res.status}`);
  const payload = parseRpc(await res.text());
  if (payload.error) throw new LivepeerError(tool, payload.error.message || JSON.stringify(payload.error));
  const result = payload.result || {};
  const text = (result.content || []).map((c) => c.text || '').join(' ').trim();
  if (result.isError) throw new LivepeerError(tool, text.slice(0, 400), result.structuredContent);
  return { text, data: result.structuredContent || {} };
}

function parseRpc(body) {
  const events = [...body.matchAll(/^data: (.*)$/gm)];
  return JSON.parse(events.length ? events[events.length - 1][1] : body);
}

export function lastUrl(text) {
  const urls = text.match(/https:\/\/[^\s)"']+/g) || [];
  return urls.length ? urls[urls.length - 1].replace(/[.,]$/, '') : null;
}

export async function upload(buffer, mimeType, filename) {
  const kind = mimeType.split('/')[0];
  const { text, data } = await callTool(RAW, 'upload', { data: buffer.toString('base64'), mime_type: mimeType, kind, filename }, 60_000);
  const url = data.url || lastUrl(text);
  if (!url) throw new LivepeerError('upload', 'no hosted URL in the response');
  return url;
}

// Raw whisper-word and nemotron-asr fail with stream_truncated, and creative transcribe
// returns no cues, so callers transcribe short chunks and keep the offsets themselves.
export async function transcribe(audioUrl) {
  const { data } = await callTool(CREATIVE, 'transcribe', { source_url: audioUrl, granularity: 'segment', language: 'en' }, 120_000);
  return (data.text || '').trim();
}

export async function complete(prompt, sessionId) {
  const { text } = await callTool(RAW, 'run_capability', {
    capability: 'gemini-text', prompt, timeout: 60, async: false, persist: false, session_id: sessionId,
  }, 90_000);
  let body = text;
  try {
    body = JSON.parse(text).text ?? text;
  } catch {}
  return body.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

// kontext-edit reads inputs.image_url; the source_url its capability card documents is refused.
export async function redraw(imageUrl, prompt, sessionId) {
  const { text } = await callTool(RAW, 'run_capability', {
    capability: 'kontext-edit', timeout: 50, session_id: sessionId, inputs: { prompt, image_url: imageUrl },
  }, 90_000);
  const url = lastUrl(text);
  if (!url) throw new LivepeerError('kontext-edit', 'no image URL in the response');
  return url;
}

export async function runCapability(capability, inputs, sessionId, timeoutSeconds = 60) {
  return callTool(RAW, 'run_capability', {
    capability, inputs, timeout: timeoutSeconds, async: false, session_id: sessionId,
  }, (timeoutSeconds + 30) * 1000);
}

// The session report routinely takes 15 to 20 seconds, so it gets a long timeout and runs off the hot path.
export async function sessionCost(sessionId) {
  const { text, data } = await callTool(RAW, 'get_cost_report', { scope: 'session', session_id: sessionId }, 45_000);
  if (Number.isFinite(data.total_cost_usd)) return data.total_cost_usd;
  const match = text.match(/Total: \$([\d.]+)/);
  return match ? Number(match[1]) : null;
}
