/*! 公众号 HTML 复制页 — 复用 inliner.js + core.js，零安装验证版式保真度 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var folderInput = $('folder');
  var htmlList = $('htmlList');
  var folderHint = $('folderHint');
  var singleInput = $('single');
  var pasteInput = $('paste');
  var parseBtn = $('parse');
  var copyBtn = $('copy');
  var downloadBtn = $('download');
  var statusEl = $('status');
  var reportEl = $('report');
  var preview = $('preview');

  var state = {
    mode: '',
    fileMap: new Map(),
    selectedPath: '',
    baseDir: '',
    sourceName: '',
    processed: '',
    report: null,
    previewUrls: []
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setStatus(message, type) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }

  folderInput.addEventListener('change', function (event) {
    state.mode = 'folder';
    var files = event.target.files;
    state.fileMap = new Map();
    for (var i = 0; i < files.length; i++) {
      state.fileMap.set(
        WXCore.normalizePath(files[i].webkitRelativePath || files[i].name),
        files[i]
      );
    }

    var entries = [];
    state.fileMap.forEach(function (file, path) {
      if (/\.html?$/i.test(path)) {
        entries.push({ path: path, lastModified: file.lastModified || 0 });
      }
    });
    entries = WXCore.rankHtmlEntries(entries);

    htmlList.innerHTML = '';
    entries.forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.path;
      option.textContent = entry.path;
      htmlList.appendChild(option);
    });

    htmlList.hidden = entries.length === 0;
    if (entries.length) {
      htmlList.value = entries[0].path;
      state.selectedPath = entries[0].path;
      var previews = entries.filter(function (e) { return /preview|预览/i.test(e.path); }).length;
      folderHint.textContent = '共 ' + state.fileMap.size + ' 个文件，' + entries.length + ' 个 HTML' +
        (previews ? '；预览稿（' + previews + ' 个）已排在最后' : '') + '。';
    } else {
      state.selectedPath = '';
      folderHint.textContent = '这个文件夹里没有 .html 文件。';
    }
    resetParsed();
  });

  htmlList.addEventListener('change', function () {
    state.mode = 'folder';
    state.selectedPath = htmlList.value || '';
    resetParsed();
  });
  singleInput.addEventListener('change', function () {
    state.mode = 'single';
    resetParsed();
  });
  pasteInput.addEventListener('input', function () {
    state.mode = 'paste';
    resetParsed();
  });

  function resetParsed() {
    state.processed = '';
    state.report = null;
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    reportEl.innerHTML = '';
    setStatus('');
  }

  function readSource() {
    var mode = state.mode;
    if (!mode) {
      if (state.selectedPath) mode = 'folder';
      else if (singleInput.files && singleInput.files[0]) mode = 'single';
      else mode = 'paste';
    }

    if (mode === 'folder') {
      if (!state.selectedPath || !state.fileMap.has(state.selectedPath)) {
        return Promise.reject(new Error('请先选择文件夹里的 HTML 文件'));
      }
      var file = state.fileMap.get(state.selectedPath);
      return file.text().then(function (text) {
        return {
          html: text,
          name: file.webkitRelativePath || file.name,
          baseDir: WXCore.dirname(state.selectedPath)
        };
      });
    }

    if (mode === 'single') {
      var single = singleInput.files && singleInput.files[0];
      if (!single) return Promise.reject(new Error('请先选择 HTML 文件'));
      return single.text().then(function (text) {
        return { html: text, name: single.name, baseDir: '' };
      });
    }

    var text = pasteInput.value;
    if (text && text.trim()) {
      return Promise.resolve({ html: text, name: '粘贴内容', baseDir: '' });
    }
    return Promise.reject(new Error('请先粘贴 HTML'));
  }

  parseBtn.addEventListener('click', function () {
    parseBtn.disabled = true;
    setStatus('解析中…');
    readSource().then(function (source) {
      if (!source.html || !source.html.trim()) throw new Error('HTML 为空');
      var out = WXInliner.process(source.html);
      if (/preview|预览/i.test(source.name)) {
        out.report.warnings.unshift({
          code: 'previewFile',
          message: '当前是预览壳文件（带手机边框/灰底），正文建议改选 layout.html',
          count: 1
        });
      }
      state.processed = out.html;
      state.report = out.report;
      state.sourceName = source.name;
      state.baseDir = source.baseDir || '';
      renderReport(out.report);
      renderPreview(out.html, out.report);
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
      setStatus('解析完成：' + WXCore.basename(source.name) + ' · ' +
        out.report.stats.elements + ' 个元素，' +
        out.report.stats.rules + ' 条样式规则，' + out.report.images.length + ' 张图片', 'ok');
    }).catch(function (err) {
      setStatus('解析失败：' + (err && err.message ? err.message : err), 'err');
    }).then(function () {
      parseBtn.disabled = false;
    });
  });

  function renderReport(report) {
    var parts = ['<div class="chips">'];
    if (state.sourceName) parts.push('<span class="chip">' + esc(WXCore.basename(state.sourceName)) + '</span>');
    parts.push('<span class="chip">' + report.stats.elements + ' 元素</span>');
    parts.push('<span class="chip">' + report.stats.rules + ' 条规则</span>');
    parts.push('<span class="chip">' + report.images.length + ' 张图</span>');
    if (report.stats.textLength) parts.push('<span class="chip">' + report.stats.textLength + ' 字</span>');
    parts.push('</div>');
    if (report.warnings.length) {
      report.warnings.forEach(function (w) {
        var bad = ['flex', 'grid', 'position', 'transform', 'animation', 'svg'].indexOf(w.code) !== -1;
        parts.push('<div class="warn-item' + (bad ? ' bad' : '') + '">' + esc(w.message) + '</div>');
      });
    } else {
      parts.push('<div class="okline">没有发现兼容性问题。</div>');
    }
    reportEl.innerHTML = parts.join('');
  }

  function renderPreview(html, report) {
    state.previewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    state.previewUrls = [];

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var imgs = doc.querySelectorAll('img[data-wx-img]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var id = img.getAttribute('data-wx-img');
      var info = null;
      for (var j = 0; j < report.images.length; j++) {
        if (report.images[j].id === id) { info = report.images[j]; break; }
      }
      if (info && info.kind === 'local') {
        var file = WXCore.resolveImagePath(info.src, state.baseDir, state.fileMap);
        if (file) {
          var url = URL.createObjectURL(file);
          state.previewUrls.push(url);
          img.setAttribute('src', url);
        } else {
          img.removeAttribute('src');
          img.setAttribute('alt', (img.getAttribute('alt') || '图片') + '（未找到文件）');
        }
      }
    }

    preview.srcdoc = '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;background:#fff}body{padding:16px 14px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.pv{max-width:375px;margin:0 auto}</style></head><body><div class="pv">' +
      doc.body.innerHTML + '</div></body></html>';
  }

  function copyFallback(html) {
    var div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap;';
    div.innerHTML = html;
    document.body.appendChild(div);
    var range = document.createRange();
    range.selectNodeContents(div);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges();
    div.remove();
    return ok;
  }

  function copyRich(html) {
    var plain = new DOMParser().parseFromString(html, 'text/html').body.innerText || '';
    if (navigator.clipboard && window.ClipboardItem) {
      return navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })]).then(function () { return true; }).catch(function () {
        return copyFallback(html);
      });
    }
    return Promise.resolve(copyFallback(html));
  }

  copyBtn.addEventListener('click', function () {
    if (!state.processed || !state.report) return;
    var localIds = state.report.images.filter(function (i) {
      return i.kind === 'local' || i.kind === 'data';
    }).map(function (i) { return i.id; });
    var html = localIds.length
      ? WXInliner.placeholderImages(state.processed, localIds)
      : state.processed;
    html = WXInliner.finalize(html);

    setStatus('复制中…');
    copyRich(html).then(function (ok) {
      if (ok) {
        setStatus('已复制。到公众号编辑器里 Cmd+V；本地图片会显示为占位框，需要手动上传。', 'ok');
      } else {
        setStatus('复制失败：浏览器拒绝了剪贴板写入。请改用扩展版，或手动全选预览内容复制。', 'err');
      }
    });
  });

  downloadBtn.addEventListener('click', function () {
    if (!state.processed) return;
    var html = WXInliner.finalize(state.processed);
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wechat-import-V1.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('已下载清洗后的 HTML。', 'ok');
  });
})();
