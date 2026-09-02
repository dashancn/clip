import { consumeRecord, generateCode, json, normalizeCode, normalizeCreateInput, securityHeaders } from './core.js';

const CREATE_WINDOW = 600;
const CREATE_LIMIT = 12;
const READ_LIMIT = 40;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function hitLimit(env, key, limit, ttl = 60) {
  const current = Number(await env.CLIPS.get(key) || 0);
  if (current >= limit) return true;
  await env.CLIPS.put(key, String(current + 1), { expirationTtl: ttl });
  return false;
}

async function createClip(request, env) {
  if (await hitLimit(env, `rate:create:${clientIp(request)}`, CREATE_LIMIT, CREATE_WINDOW)) return json({ error: '创建过于频繁，请稍后重试' }, 429);
  let input;
  try { input = normalizeCreateInput(await request.json()); }
  catch (error) { return json({ error: error.message }, 400); }
  let code;
  for (let i = 0; i < 8; i++) {
    const candidate = generateCode();
    if (!await env.CLIPS.get(`clip:${candidate}`)) { code = candidate; break; }
  }
  if (!code) return json({ error: '暂时无法生成提取码' }, 503);
  const deleteToken = crypto.randomUUID().replaceAll('-', '');
  const record = {
    ciphertext: input.ciphertext,
    iv: input.iv,
    salt: input.salt,
    burn: input.burn,
    viewsLeft: input.maxViews,
    deleteToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + input.ttl * 1000,
  };
  await env.CLIPS.put(`clip:${code}`, JSON.stringify(record), { expirationTtl: input.ttl });
  return json({ code, deleteToken, expiresIn: input.ttl }, 201);
}

async function readClip(request, env, code) {
  if (await hitLimit(env, `rate:read:${clientIp(request)}`, READ_LIMIT, 60)) return json({ error: '查询过于频繁，请稍后重试' }, 429);
  const key = `clip:${code}`;
  const record = await env.CLIPS.get(key, 'json');
  if (!record) return json({ error: '提取码不存在或内容已过期' }, 404);
  const consumed = consumeRecord(record);
  if (consumed.delete) await env.CLIPS.delete(key);
  else await env.CLIPS.put(key, JSON.stringify({ ...record, viewsLeft: consumed.viewsLeft }), { expirationTtl: Math.max(60, Math.ceil((Number(record.expiresAt) - Date.now()) / 1000)) });
  return json({ ciphertext: record.ciphertext, iv: record.iv, salt: record.salt, viewsLeft: consumed.delete ? 0 : consumed.viewsLeft });
}

async function deleteClip(request, env, code) {
  const key = `clip:${code}`;
  const record = await env.CLIPS.get(key, 'json');
  if (!record) return json({ ok: true });
  const token = request.headers.get('X-Delete-Token') || '';
  if (token !== record.deleteToken) return json({ error: '删除凭证无效' }, 403);
  await env.CLIPS.delete(key);
  return json({ ok: true });
}

function staticResponse(asset) {
  const headers = new Headers(asset.headers);
  for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
  if (asset.headers.get('Content-Type')?.startsWith('text/html')) headers.set('Cache-Control', 'no-cache');
  return new Response(asset.body, { status: asset.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/clips' && request.method === 'POST') return createClip(request, env);
    const match = url.pathname.match(/^\/api\/clips\/([2-9A-HJ-NP-Z]{6})$/);
    if (match && request.method === 'GET') return readClip(request, env, normalizeCode(match[1]));
    if (match && request.method === 'DELETE') return deleteClip(request, env, normalizeCode(match[1]));
    if (url.pathname.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
    return staticResponse(await env.ASSETS.fetch(request));
  },
};
