/* 模拟一个 UEditor 风格的同源 iframe 编辑器，供 core.js 定位与注入测试 */
(function () {
  'use strict';

  var mount = document.getElementById('mount');
  var logEl = document.getElementById('log');

  function log(msg) {
    logEl.textContent += msg + '\n';
  }

  var frame = document.createElement('iframe');
  frame.id = 'ueditor_0';
  frame.style.cssText = 'width:820px;height:520px;border:1px solid #d0d5da;background:#fff;border-radius:8px;display:block';
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font:16px/1.8 -apple-system,"PingFang SC",sans-serif;padding:24px;min-height:460px;outline:none}' +
    'p{margin:0 0 16px}</style></head><body class="view" contenteditable="true"><p>已有内容</p></body></html>';
  frame.addEventListener('load', function () {
    window.MOCK_READY = true;
    log('iframe 已就绪');
  });
  mount.appendChild(frame);

  function editors() {
    return WXCore.findEditors(document);
  }

  document.getElementById('find').addEventListener('click', function () {
    var eds = editors();
    log('候选 ' + eds.length + ' 个');
    eds.forEach(function (ed, i) {
      log('  ' + (i + 1) + '. ' + WXCore.describeEditor(ed));
    });
  });

  document.getElementById('append').addEventListener('click', function () {
    var eds = editors();
    if (!eds.length) return log('未找到编辑器');
    WXCore.insertHtml(
      eds[0].el,
      '<section data-wx-import="wx-demo"><p style="color:#07c160;font-weight:700">追加测试</p></section>',
      { mode: 'append' }
    ).then(function (r) { log('追加: ' + JSON.stringify(r)); });
  });

  document.getElementById('replace').addEventListener('click', function () {
    var eds = editors();
    if (!eds.length) return log('未找到编辑器');
    WXCore.insertHtml(
      eds[0].el,
      '<section data-wx-import="wx-demo"><p style="color:#b91c1c;font-weight:700">替换后的内容</p></section>',
      { mode: 'replace' }
    ).then(function (r) { log('替换: ' + JSON.stringify(r)); });
  });
})();
