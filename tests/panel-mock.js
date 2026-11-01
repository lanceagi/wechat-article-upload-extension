/* 为面板端到端测试创建一个同源 iframe 编辑器 */
(function () {
  'use strict';

  var frame = document.createElement('iframe');
  frame.id = 'ueditor_0';
  frame.style.cssText = 'width:820px;height:520px;border:1px solid #d0d5da;background:#fff;border-radius:8px;display:block';
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font:16px/1.8 -apple-system,"PingFang SC",sans-serif;padding:24px;min-height:460px;outline:none}' +
    'p{margin:0 0 16px}</style></head><body class="view" contenteditable="true"><p>已有内容</p></body></html>';
  frame.addEventListener('load', function () {
    window.PANEL_MOCK_READY = true;
  });
  document.getElementById('mount').appendChild(frame);
})();
