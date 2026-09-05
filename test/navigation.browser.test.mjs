import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

const root = new URL('../', import.meta.url);
const chromium = process.env.CHROMIUM || '/snap/bin/chromium';

async function startChrome(width, height) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDataDir = `/tmp/clip-chromium-${process.pid}-${width}`;
  const child = spawn(chromium, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`, 'about:blank'
  ], { stdio: 'ignore' });

  let targets;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      if (targets[0]?.webSocketDebuggerUrl) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(targets?.[0]?.webSocketDebuggerUrl, 'Chromium DevTools endpoint did not start');
  return { child, wsUrl: targets[0].webSocketDebuggerUrl };
}

async function withPage(width, height, run) {
  const [html, css, app] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/style.css', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8')
  ]);
  const document = html
    .replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const chrome = await startChrome(width, height);
  const socket = new WebSocket(chrome.wsUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id;
    const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`CDP ${method} timed out`)); }, 5000);
    pending.set(messageId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
    const frameTree = await send('Page.getFrameTree');
    await send('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html: document });
    await evaluate(app);
    let loaded = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      loaded = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('nav'))`);
      if (loaded) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(loaded, '页面未完成加载');
    await run({ send, evaluate });
  } finally {
    socket.close();
    chrome.child.kill('SIGTERM');
  }
}

async function verifyNavigation(viewport) {
  await withPage(viewport.width, viewport.height, async ({ send, evaluate }) => {
    const layout = await evaluate(`(() => {
      const nav = document.querySelector('nav');
      const header = document.querySelector('header');
      const links = [...nav.querySelectorAll('a')];
      const rows = new Set(links.map(link => Math.round(link.getBoundingClientRect().top)));
      return {
        overflowX: getComputedStyle(nav).overflowX,
        headerOverflow: getComputedStyle(header).overflow,
        navRight: nav.getBoundingClientRect().right,
        lastRight: links.at(-1).getBoundingClientRect().right,
        rows: rows.size,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth
      };
    })()`);
    assert.notEqual(layout.overflowX, 'auto', '导航不能依赖隐藏的横向滚动');
    assert.equal(layout.documentWidth, layout.viewportWidth, '页面不应产生水平溢出');
    assert.ok(Math.abs(layout.navRight - layout.lastRight) <= 1, '导航最后一项应与导航右侧对齐');
    if (viewport.width === 375) assert.ok(layout.rows > 1, '窄屏导航应自然换行');

    const count = await evaluate('document.querySelectorAll("nav a").length');
    for (let index = 0; index < count; index += 1) {
      await evaluate(`document.querySelectorAll('nav a')[${index}].focus()`);
      await new Promise(resolve => setTimeout(resolve, 180));
      await evaluate(`document.querySelector('[role="tooltip"]')?.getAnimations().forEach(animation => animation.finish())`);
      const tip = await evaluate(`(() => {
        const element = document.querySelector('[role="tooltip"]');
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { opacity: style.opacity, position: style.position, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      })()`);
      assert.ok(tip, `第 ${index + 1} 个链接 focus 后应渲染真实 Tip`);
      assert.equal(tip.opacity, '1');
      assert.equal(tip.position, 'fixed');
      assert.ok(tip.width > 0 && tip.height > 0);
      assert.ok(tip.left >= 0 && tip.top >= 0 && tip.right <= viewport.width && tip.bottom <= viewport.height, `第 ${index + 1} 个 Tip 应完整位于视口内`);
    }

    await evaluate("document.activeElement.blur(); document.querySelector('nav a').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))");
    await new Promise(resolve => setTimeout(resolve, 180));
    const hoverOpacity = await evaluate("getComputedStyle(document.querySelector('[role=tooltip]')).opacity");
    assert.equal(hoverOpacity, '1', 'hover 后 Tip opacity 应为 1');

  });
}

test('桌面导航无横向滚动且每个 Tip focus/hover 后真实可见', () => verifyNavigation({ width: 1280, height: 800 }));
test('375px 导航自然多行右对齐、无页面溢出且每个 Tip 在视口内', () => verifyNavigation({ width: 375, height: 812 }));
