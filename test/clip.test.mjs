import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateCode, normalizeCreateInput, consumeRecord, securityHeaders } from '../src/core.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('生成6位不易混淆的提取码', () => {
  const code = generateCode(() => new Uint32Array([0,1,2,3,4,5]));
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  assert.equal(code.length, 6);
});

test('创建内容限制大小、有效期和读取次数', () => {
  const result = normalizeCreateInput({ ciphertext:'abc', iv:'123456789012', salt:'1234567890123456', ttl:9999999, maxViews:999, burn:true });
  assert.equal(result.ttl, 86400);
  assert.equal(result.maxViews, 10);
  assert.equal(result.burn, true);
  assert.throws(() => normalizeCreateInput({ ciphertext:'x'.repeat(300001), iv:'a', salt:'b' }), /过大/);
});

test('阅后即焚和次数限制在读取后删除', () => {
  const burned = consumeRecord({ burn:true, viewsLeft:5 });
  assert.equal(burned.delete, true);
  const last = consumeRecord({ burn:false, viewsLeft:1 });
  assert.equal(last.delete, true);
  const ongoing = consumeRecord({ burn:false, viewsLeft:3 });
  assert.deepEqual(ongoing, { delete:false, viewsLeft:2 });
});

test('安全响应头禁止缓存与嵌入', () => {
  const headers = securityHeaders();
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('页面包含i41导航、客户端加密、TTL和阅后即焚', async () => {
  const [html, app] = await Promise.all([read('public/index.html'), read('public/app.js')]);
  for (const url of ['https://www.i41.cn','https://tools.i41.cn','https://imgzip.i41.cn','https://pdf.i41.cn','https://idphoto.i41.cn','https://watermark.i41.cn']) assert.ok(html.includes(url));
  for (const text of ['i41 临时剪贴板','阅后即焚','有效期','最大读取次数','关注 i方案']) assert.ok(html.includes(text));
  assert.match(app, /AES-GCM/);
  assert.match(app, /PBKDF2/);
});
