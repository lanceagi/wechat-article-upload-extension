#!/usr/bin/env node
'use strict';

/**
 * 本地验收：用本机 Chrome 跑五组测试（夹具在 测试样例/fixtures/，仓库自包含）
 *   0. manifest 引用完整性
 *   1. inliner 自测（基准稿 / 压力稿 / 图片管线 / CSS 变量 / 文件排序）
 *   2. core 模拟编辑器（定位 / 追加 / 替换）
 *   3. 面板端到端（粘贴 -> 解析 -> 插入）
 *   4. 复制页（解析与预览）
 *   5. 敌对编辑器（execCommand 被剥样式时自动直写）
 *
 * 运行：npm test
 *   可用环境变量：CHROME_PATH（Chrome 可执行文件，默认 macOS 稳定版路径）
 *               WXH_BASELINE / WXH_STRESS（换用自己的样例稿）
 */

const fs = require('fs');
const path = require('path');

let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (err) {
  console.error('缺少依赖：请先在仓库根目录运行  npm install');
  process.exit(1);
}

const HERE = __dirname;
const TOOL = path.resolve(HERE, '..');
const EXT = path.join(TOOL, 'extension');
const FIXTURES = path.join(HERE, 'fixtures');
const BASELINE = process.env.WXH_BASELINE || path.join(FIXTURES, 'baseline.html');
const STRESS = process.env.WXH_STRESS || path.join(FIXTURES, 'stress.html');
const CHROME = process.env.CHROME_PATH ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function fileUrl(p) {
  return 'file://' + encodeURI(p);
}

function mustExist(p, label) {
  if (!fs.existsSync(p)) throw new Error(label + ' 不存在：' + p);
}

function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const files = [];
  (manifest.content_scripts || []).forEach((cs) => (cs.js || []).forEach((f) => files.push(f)));
  Object.values(manifest.icons || {}).forEach((f) => files.push(f));
  const missing = files.filter((f) => !fs.existsSync(path.join(EXT, f)));
  if (missing.length) throw new Error('manifest 引用缺失：' + missing.join(', '));
  console.log('[0/5] manifest：OK（' + files.length + ' 个引用文件齐全）');
}

async function runInlinerTests(browser, samples) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[selftest pageerror]', e.message));
  await page.goto(fileUrl(path.join(HERE, 'selftest.html')), { waitUntil: 'load' });
  await page.waitForFunction('typeof window.runTests === "function"');
  const res = await page.evaluate((s) => window.runTests(s), samples);
  await page.close();

  res.results.forEach((r) => {
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : ''));
  });
  console.log(`\n[1/5] inliner：${res.pass} passed, ${res.fail} failed`);
  return res.fail;
}

async function runCoreTests(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[mock pageerror]', e.message));
  await page.goto(fileUrl(path.join(HERE, 'mock-editor.html')), { waitUntil: 'load' });
  await page.waitForFunction('window.MOCK_READY === true', { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const editors = WXCore.findEditors(document);
    const result = { count: editors.length };
    if (!editors.length) return result;
    const el = editors[0].el;
    const r1 = await WXCore.insertHtml(
      el,
      '<section data-wx-import="wx-test"><p style="color:#ff0000">插入测试</p></section>',
      { mode: 'append' }
    );
    result.appendOk = r1.ok && el.textContent.includes('插入测试');
    result.appendMethod = r1.method;
    result.markerCleared = !el.querySelector('[data-wx-import]');
    const r2 = await WXCore.insertHtml(
      el,
      '<section data-wx-import="wx-test2"><p>替换后的内容</p></section>',
      { mode: 'replace' }
    );
    result.replaceOk = r2.ok &&
      el.textContent.includes('替换后的内容') &&
      !el.textContent.includes('已有内容');
    result.desc = WXCore.describeEditor(editors[0]);
    return result;
  });

  await page.close();
  const ok = out.count === 1 && out.appendOk && out.markerCleared && out.replaceOk;
  console.log('[2/5] core：' + JSON.stringify(out));
  console.log((ok ? 'PASS ' : 'FAIL ') + '编辑器定位 / 追加 / 替换');
  return ok ? 0 : 1;
}

async function runPanelTests(browser) {
  const page = await browser.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  page.on('pageerror', (e) => console.log('[panel pageerror]', e.message));
  await page.goto(fileUrl(path.join(HERE, 'panel-mock.html')), { waitUntil: 'load' });

  await page.waitForFunction(() => {
    const host = document.getElementById('wxh-host');
    const fab = host && host.shadowRoot && host.shadowRoot.querySelector('.wxh-fab');
    return !!(fab && !fab.hidden);
  }, { timeout: 20000 });

  const defaults = await page.evaluate(() => {
    const sr = document.getElementById('wxh-host').shadowRoot;
    return {
      tab: sr.querySelector('.wxh-tab.on').getAttribute('data-tab'),
      fileVisible: !sr.querySelector('.wxh-tabpane[data-pane="file"]').hidden
    };
  });

  await page.evaluate(() => {
    const sr = document.getElementById('wxh-host').shadowRoot;
    sr.querySelector('.wxh-tab[data-tab="paste"]').click();
    const ta = sr.querySelector('.wxh-paste');
    ta.value = '<h2 style="color:#111111">端到端测试</h2>' +
      '<p style="color:#07c160;font-size:16px">正文段落</p>';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    sr.querySelector('.wxh-parse').click();
  });

  await page.waitForFunction(() => {
    const sr = document.getElementById('wxh-host').shadowRoot;
    return !sr.querySelector('.wxh-insert').disabled;
  }, { timeout: 10000 });

  await page.evaluate(() => {
    const sr = document.getElementById('wxh-host').shadowRoot;
    sr.querySelector('.wxh-insert').click();
  });

  await page.waitForFunction(() => {
    const sr = document.getElementById('wxh-host').shadowRoot;
    return /已插入/.test(sr.querySelector('.wxh-status').textContent);
  }, { timeout: 10000 });

  const result = await page.evaluate(() => {
    const frame = document.getElementById('ueditor_0');
    const body = frame.contentDocument.body;
    const p = body.querySelector('p');
    return {
      text: body.textContent.trim(),
      hasH2: !!body.querySelector('h2'),
      pColor: p ? p.style.color : '',
      status: document.getElementById('wxh-host').shadowRoot.querySelector('.wxh-status').textContent
    };
  });

  await page.close();
  const ok = defaults.tab === 'file' &&
    defaults.fileVisible &&
    result.text.includes('端到端测试') &&
    !result.text.includes('已有内容') &&
    result.hasH2 &&
    /rgb\(7,\s*193,\s*96\)|#07c160/i.test(result.pColor);
  console.log('[3/5] panel：' + JSON.stringify({ defaults, result }));
  console.log((ok ? 'PASS ' : 'FAIL ') + '默认单文件 + 粘贴 → 解析 → 插入');
  return ok ? 0 : 1;
}

async function runCopyPageTest(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[copy pageerror]', e.message));
  await page.goto(fileUrl(path.join(EXT, 'copy-page.html')), { waitUntil: 'load' });
  await page.evaluate(() => {
    document.getElementById('paste').value =
      '<h2>复制页测试</h2><p style="color:#07c160">正文</p>';
    document.getElementById('parse').click();
  });
  await page.waitForFunction(() => !document.getElementById('copy').disabled, { timeout: 10000 });
  const result = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    hasPreview: /复制页测试/.test(document.getElementById('preview').srcdoc || '')
  }));
  await page.close();
  const ok = /解析完成/.test(result.status) && result.hasPreview;
  console.log('[4/5] copy page：' + JSON.stringify(result));
  console.log((ok ? 'PASS ' : 'FAIL ') + '复制页解析与预览');
  return ok ? 0 : 1;
}

async function runHostileTests(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[hostile pageerror]', e.message));
  await page.goto(fileUrl(path.join(HERE, 'hostile-mock.html')), { waitUntil: 'load' });
  await page.waitForFunction('window.HOSTILE_READY === true', { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const editors = WXCore.findEditors(document);
    const result = { count: editors.length };
    if (!editors.length) return result;
    const el = editors[0].el;
    const r = await WXCore.insertHtml(
      el,
      '<section data-wx-import="wx-h"><h2 style="font-size:18px;color:#ff0000">敌对编辑器测试</h2>' +
      '<p style="color:#07c160">正文段落</p></section>',
      { mode: 'replace' }
    );
    result.ok = r.ok;
    result.method = r.method;
    result.styleCount = el.querySelectorAll('[style]').length;
    result.hasText = el.textContent.includes('敌对编辑器测试');
    return result;
  });

  await page.close();
  const pass = out.ok && out.method === 'direct' && out.hasText && out.styleCount >= 2;
  console.log('[5/5] hostile：' + JSON.stringify(out));
  console.log((pass ? 'PASS ' : 'FAIL ') + 'execCommand 被剥样式时自动改用直写并保住样式');
  return pass ? 0 : 1;
}

(async () => {
  mustExist(BASELINE, '基准稿');
  mustExist(STRESS, '压力稿');
  mustExist(CHROME, 'Chrome');

  const samples = {
    baseline: fs.readFileSync(BASELINE, 'utf8'),
    stress: fs.readFileSync(STRESS, 'utf8')
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']
  });

  let failed = 0;
  try {
    checkManifest();
    failed += await runInlinerTests(browser, samples);
    failed += await runCoreTests(browser);
    failed += await runPanelTests(browser);
    failed += await runCopyPageTest(browser);
    failed += await runHostileTests(browser);
  } finally {
    await browser.close();
  }

  console.log('\n' + (failed ? 'FAILED' : 'ALL PASS') + ' · ' + failed + ' 个失败项');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
