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

test('顶部生态导航按统一顺序提供当前工具之外的九个入口', async () => {
  const html = await read('public/index.html');
  const nav = html.match(/<nav aria-label="i41 工具生态">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav);

  const entries = [...nav.matchAll(/<(?:a|span)[^>]*>([^<]+)<\/(?:a|span)>/g)].map(match => match[1]);
  assert.deepEqual(entries, ['i方案', '开发者工具', '图片压缩', 'HEIC 转换', '智能抠图', '多图拼接', 'PDF 工具', '证件水印', '证件照']);
  assert.match(nav, /<a class="i-plan-nav"[^>]*>i方案<\/a>/);
  assert.match(nav, /<a href="https:\/\/imgzip\.i41\.cn\/heic-converter\/" data-tooltip="在线转换 HEIC 图片格式">HEIC 转换<\/a>/);

  const urls = [...nav.matchAll(/<a[^>]+href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(urls, [
    'https://www.i41.cn?utm_source=clip&amp;utm_medium=tool_referral&amp;utm_campaign=ifangan&amp;utm_content=ecosystem_nav',
    'https://tools.i41.cn',
    'https://imgzip.i41.cn',
    'https://imgzip.i41.cn/heic-converter/',
    'https://imgzip.i41.cn/remove-background/',
    'https://imgzip.i41.cn/collage/',
    'https://pdf.i41.cn',
    'https://watermark.i41.cn',
    'https://idphoto.i41.cn'
  ]);
  assert.doesNotMatch(nav, /临时剪贴板/);
  assert.match(html, /<a class="brand"[^>]*>[\s\S]*?<strong>i41 临时剪贴板<\/strong><\/a>/);
  for (const [, attributes] of html.matchAll(/<a\b([^>]*)>/g)) assert.doesNotMatch(attributes, /\s(?:target|rel)="[^"]*"/);
});

test('Hero 保留关注 i方案横幅及独立 promo_banner UTM', async () => {
  const html = await read('public/index.html');
  assert.match(html, /<aside>[\s\S]*?<strong>关注 i方案<\/strong>[\s\S]*?<span>获取内容创作、客户跟单、文生图与视频制作方案<\/span>[\s\S]*?href="https:\/\/www\.i41\.cn\?utm_source=clip&amp;utm_medium=tool_referral&amp;utm_campaign=ifangan&amp;utm_content=promo_banner"[\s\S]*?>访问 i方案 →<\/a>[\s\S]*?<\/aside>/);
});

test('统一导航为白底至少 64px，i方案加宽且每个入口提供真实 hover 与 focus 提示', async () => {
  const [html, css, app] = await Promise.all([read('public/index.html'), read('public/style.css'), read('public/app.js')]);
  const nav = html.match(/<nav aria-label="i41 工具生态">([\s\S]*?)<\/nav>/)?.[1];
  const links = [...nav.matchAll(/<a\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(links.length, 9);
  for (const attributes of links) assert.match(attributes, /\bdata-tooltip="[^"]+"/);
  assert.match(css, /header\{[^}]*min-height:64px[^}]*overflow:visible[^}]*background:#fff/);
  assert.match(css, /nav \.i-plan-nav\{[^}]*min-width:72px[^}]*padding:[^;}]+[^}]*border-radius:9px[^}]*background:#246bfd[^}]*color:#fff[^}]*font-weight:800[^}]*text-align:center/);
  assert.match(css, /nav\{[^}]*justify-content:flex-end[^}]*flex-wrap:wrap[^}]*overflow:visible/);
  assert.match(css, /nav a,nav span\{[^}]*font-size:14px/);
  assert.doesNotMatch(css, /overflow-x:auto|scrollbar-width|::-webkit-scrollbar/);
  assert.match(css, /\.nav-tooltip\{[^}]*position:fixed/);
  assert.match(app, /addEventListener\('mouseover',[\s\S]*?placeNavTooltip/);
  assert.match(app, /addEventListener\('focusin',[\s\S]*?placeNavTooltip/);
  assert.doesNotMatch(css, /(?:row-reverse|column-reverse|(?:^|[;{])order\s*:)/);
});

test('隐私徽章准确说明客户端加密与自动过期', async () => {
  const html = await read('public/index.html');
  const privacy = html.match(/<section class="privacy">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(privacy?.includes('客户端加密 · 自动过期'));
  assert.ok(!privacy?.includes('纯本地'));
});

test('页脚保持极短可见行并默认折叠隐私、开源与临时存储说明', async () => {
  const html = await read('public/index.html');
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer);
  assert.match(footer, /^i41 免费实用工具 · <details><summary>说明<\/summary>/);
  assert.doesNotMatch(footer, /<details\s+open/);
  for (const text of ['隐私', 'MIT License', '不提供永久存储', '不会包含剪贴板内容、密码或提取码', '永久标识']) assert.ok(footer.includes(text));
});
