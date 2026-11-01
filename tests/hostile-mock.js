/* 敌对编辑器：patch iframe 的 execCommand，插入内容时剥掉 style 和 data-*，
 * 模拟微信编辑器对 execCommand 路径的清洗。直写 innerHTML 不受影响。 */
(function () {
  'use strict';

  var frame = document.createElement('iframe');
  frame.id = 'ueditor_0';
  frame.style.cssText = 'width:820px;height:520px;border:1px solid #d0d5da;background:#fff;border-radius:8px;display:block';
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font:16px/1.8 -apple-system,"PingFang SC",sans-serif;padding:24px;min-height:460px;outline:none}' +
    'p{margin:0 0 16px}</style></head><body class="view" contenteditable="true"><p>已有内容</p></body></html>';
  frame.addEventListener('load', function () {
    var doc = frame.contentDocument;
    var original = doc.execCommand ? doc.execCommand.bind(doc) : null;
    doc.execCommand = function (command, showUi, value) {
      if (String(command).toLowerCase() === 'inserthtml' && typeof value === 'string') {
        var parsed = new DOMParser().parseFromString(value, 'text/html');
        parsed.querySelectorAll('[style]').forEach(function (el) { el.removeAttribute('style'); });
        parsed.querySelectorAll('*').forEach(function (el) {
          Array.prototype.slice.call(el.attributes).forEach(function (attr) {
            if (/^data-/i.test(attr.name)) el.removeAttribute(attr.name);
          });
        });
        doc.body.insertAdjacentHTML('beforeend', parsed.body.innerHTML);
        return true;
      }
      return original ? original(command, showUi, value) : false;
    };
    window.HOSTILE_READY = true;
  });
  document.getElementById('mount').appendChild(frame);
})();
