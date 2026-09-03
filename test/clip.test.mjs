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

test('安全响应头禁止缓存与嵌入，并允许 Cloudflare 与 i41 匿名统计', () => {
  const headers = securityHeaders();
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'], /script-src 'self' https:\/\/static\.cloudflareinsights\.com https:\/\/stats\.i41\.cn/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self' https:\/\/cloudflareinsights\.com https:\/\/stats\.i41\.cn/);
});

test('页面接入指定 Cloudflare Web Analytics 并披露匿名统计边界', async () => {
  const html = await read('public/index.html');
  assert.match(html, /src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js"/);
  assert.match(html, /data-cf-beacon='\{"token":"039bd47947bd4fc39a02944edd178b7e"\}'/);
  assert.ok(html.includes('匿名访问与性能数据'));
  assert.ok(html.includes('不会包含剪贴板内容、密码或提取码'));
});

test('隐私说明披露匿名 UTM 与跨站点击且排除敏感内容和永久标识', async () => {
  const html = await read('public/index.html');
  for (const text of ['匿名 UTM', '跨站点击', '剪贴板内容', '密码', '提取码', '永久标识']) assert.ok(html.includes(text));
  assert.match(html, /不会包含剪贴板内容、密码或提取码，也不会使用永久标识/);
});

test('页面加载 i41 匿名统计脚本并声明 clip 站点', async () => {
  const html = await read('public/index.html');
  assert.match(html, /<html[^>]*data-i41-site="clip"/);
  assert.match(html, /<script[^>]*src="https:\/\/stats\.i41\.cn\/analytics\.js"[^>]*><\/script>/);
});

test('页面包含i41导航、客户端加密、TTL和阅后即焚', async () => {
  const [html, app] = await Promise.all([read('public/index.html'), read('public/app.js')]);
  for (const url of ['https://www.i41.cn','https://tools.i41.cn','https://imgzip.i41.cn','https://pdf.i41.cn','https://idphoto.i41.cn','https://watermark.i41.cn']) assert.ok(html.includes(url));
  for (const text of ['i41 临时剪贴板','阅后即焚','有效期','最大读取次数','关注 i方案']) assert.ok(html.includes(text));
  assert.match(app, /AES-GCM/);
  assert.match(app, /PBKDF2/);
});

test('顶部生态导航和 Hero 横幅使用各自的 i方案 UTM', async () => {
  const html = await read('public/index.html');
  assert.match(html, /class="featured" href="https:\/\/www\.i41\.cn\?utm_source=clip&amp;utm_medium=tool_referral&amp;utm_campaign=ifangan&amp;utm_content=ecosystem_nav"/);
  assert.match(html, /<aside>[\s\S]*?href="https:\/\/www\.i41\.cn\?utm_source=clip&amp;utm_medium=tool_referral&amp;utm_campaign=ifangan&amp;utm_content=promo_banner"[\s\S]*?<\/aside>/);
});

test('页面展示工具归属并保留开源与临时存储说明', async () => {
  const html = await read('public/index.html');
  for (const text of ['i41 免费实用工具', 'MIT License', '不提供永久存储']) assert.ok(html.includes(text));
});
