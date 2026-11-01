/*!
 * 公众号 HTML 导入器 — content.js
 * 在 mp.weixin.qq.com 注入悬浮面板：选文件夹/文件/粘贴 -> 内联清洗 -> 预览 -> 插入编辑器。
 * 不保存草稿、不群发、不请求公众号 API。
 */
(function () {
  'use strict';

  if (window.__WX_HTML_IMPORTER__) return;
  window.__WX_HTML_IMPORTER__ = true;

  var VERSION = '1.0.0';

  var state = {
    tab: 'file',
    fileMap: new Map(),
    selectedPath: '',
    baseDir: '',
    sourceName: '',
    processedHtml: '',
    report: null,
    previewUrls: [],
    showFabFallback: false,
    lastDiag: null
  };

  var host, shadow, sheet, fab, panel;
  var folderInput, htmlList, folderHint, singleInput, pasteInput;
  var replaceOpt, uploadOpt, parseBtn, insertBtn, statusEl, reportEl;
  var previewWrap, previewFrame, diagBtn, diagEl, closeBtn, copyDiagBtn;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function chip(text) {
    return '<span class="wxh-chip">' + esc(text) + '</span>';
  }

  function setStatus(message, type) {
    statusEl.textContent = message || '';
    statusEl.className = 'wxh-status' + (type ? ' ' + type : '');
  }

  // ---------- 构建界面 ----------

  function buildUi() {
    host = document.createElement('div');
    host.id = 'wxh-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;';
    document.documentElement.appendChild(host);

    shadow = host.attachShadow({ mode: 'open' });

    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(self.WX_PANEL_CSS || '');
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      // 老版本 Chrome 退化为 <style>
      var st = document.createElement('style');
      st.textContent = self.WX_PANEL_CSS || '';
      shadow.appendChild(st);
    }

    shadow.innerHTML = [
      '<button class="wxh-fab" hidden title="导入 HTML">HTML</button>',
      '<div class="wxh-panel" hidden>',
      '  <div class="wxh-head">',
      '    <div class="wxh-title">公众号 HTML 导入器<span class="wxh-ver">V' + VERSION + '</span></div>',
      '    <button class="wxh-close" title="关闭">×</button>',
      '  </div>',
      '  <div class="wxh-body">',
      '    <div class="wxh-tabs">',
      '      <button class="wxh-tab on" data-tab="file">单文件</button>',
      '      <button class="wxh-tab" data-tab="folder">文件夹</button>',
      '      <button class="wxh-tab" data-tab="paste">粘贴</button>',
      '    </div>',
      '    <div class="wxh-tabpane" data-pane="folder" hidden>',
      '      <input type="file" class="wxh-file wxh-folder" webkitdirectory multiple>',
      '      <select class="wxh-select wxh-html-list" hidden></select>',
      '      <div class="wxh-hint wxh-folder-hint">选文章文件夹后，会列出里面的 .html；预览稿排在最后，图片按相对路径自动匹配。</div>',
      '    </div>',
      '    <div class="wxh-tabpane" data-pane="file">',
      '      <input type="file" class="wxh-file wxh-single" accept=".html,.htm,text/html">',
      '      <div class="wxh-hint">默认模式。只读 HTML；相对路径的图片无法读取，会显示为待上传占位。</div>',
      '    </div>',
      '    <div class="wxh-tabpane" data-pane="paste" hidden>',
      '      <textarea class="wxh-textarea wxh-paste" placeholder="粘贴 HTML 源码…"></textarea>',
      '    </div>',
      '    <div class="wxh-opts">',
      '      <label class="wxh-opt"><input type="checkbox" class="wxh-replace" checked> 替换编辑器现有内容</label>',
      '      <label class="wxh-opt"><input type="checkbox" class="wxh-upload" checked> 上传本地图片到素材库</label>',
      '    </div>',
      '    <div class="wxh-actions">',
      '      <button class="wxh-btn ghost wxh-parse">解析并预览</button>',
      '      <button class="wxh-btn primary wxh-insert" disabled>插入编辑器</button>',
      '    </div>',
      '    <div class="wxh-status"></div>',
      '    <div class="wxh-report"></div>',
      '    <div class="wxh-preview-wrap" hidden>',
      '      <div class="wxh-preview-label">预览（微信正文宽度）</div>',
      '      <iframe class="wxh-preview" sandbox="allow-same-origin" title="预览"></iframe>',
      '    </div>',
      '    <div class="wxh-foot">',
      '      <button class="wxh-link wxh-copydiag">复制诊断</button>',
      '      <button class="wxh-link wxh-diag-btn">检测编辑器</button>',
      '      <span class="wxh-muted">只插入，不保存、不群发</span>',
      '    </div>',
      '    <div class="wxh-diag" hidden></div>',
      '  </div>',
      '</div>'
    ].join('');

    fab = shadow.querySelector('.wxh-fab');
    panel = shadow.querySelector('.wxh-panel');
    closeBtn = shadow.querySelector('.wxh-close');
    folderInput = shadow.querySelector('.wxh-folder');
    htmlList = shadow.querySelector('.wxh-html-list');
    folderHint = shadow.querySelector('.wxh-folder-hint');
    singleInput = shadow.querySelector('.wxh-single');
    pasteInput = shadow.querySelector('.wxh-paste');
    replaceOpt = shadow.querySelector('.wxh-replace');
    uploadOpt = shadow.querySelector('.wxh-upload');
    parseBtn = shadow.querySelector('.wxh-parse');
    insertBtn = shadow.querySelector('.wxh-insert');
    statusEl = shadow.querySelector('.wxh-status');
    reportEl = shadow.querySelector('.wxh-report');
    previewWrap = shadow.querySelector('.wxh-preview-wrap');
    previewFrame = shadow.querySelector('.wxh-preview');
    diagBtn = shadow.querySelector('.wxh-diag-btn');
    diagEl = shadow.querySelector('.wxh-diag');
    copyDiagBtn = shadow.querySelector('.wxh-copydiag');

    // webkitdirectory 属性在部分版本里需要显式设置
    folderInput.webkitdirectory = true;
    folderInput.multiple = true;

    bindEvents();
  }

  function bindEvents() {
    fab.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) refreshFab();
    });
    closeBtn.addEventListener('click', function () { panel.hidden = true; });

    shadow.querySelectorAll('.wxh-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });

    folderInput.addEventListener('change', handleFolder);
    htmlList.addEventListener('change', function () {
      state.selectedPath = htmlList.value || '';
      resetParsed();
    });
    singleInput.addEventListener('change', resetParsed);
    pasteInput.addEventListener('input', resetParsed);

    parseBtn.addEventListener('click', doParse);
    insertBtn.addEventListener('click', doInsert);
    diagBtn.addEventListener('click', showDiag);
    copyDiagBtn.addEventListener('click', function () {
      copyText(state.lastDiag ? JSON.stringify(state.lastDiag, null, 2) : '尚无插入记录')
        .then(function (ok) {
          setStatus(ok ? '诊断已复制，发给开发者即可。' : '复制失败，请对状态区截图。', ok ? 'ok' : 'err');
        });
    });
  }

  function copyFallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return copyFallback(text);
      });
    }
    return Promise.resolve(copyFallback(text));
  }

  function switchTab(tab) {
    state.tab = tab;
    shadow.querySelectorAll('.wxh-tab').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tab') === tab);
    });
    shadow.querySelectorAll('.wxh-tabpane').forEach(function (pane) {
      pane.hidden = pane.getAttribute('data-pane') !== tab;
    });
    resetParsed();
  }

  function resetParsed() {
    state.processedHtml = '';
    state.report = null;
    insertBtn.disabled = true;
    reportEl.innerHTML = '';
    previewWrap.hidden = true;
    diagEl.hidden = true;
    setStatus('');
  }

  // ---------- 文件 ----------

  function handleFolder(event) {
    var files = event.target.files;
    state.fileMap = new Map();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var p = WXCore.normalizePath(f.webkitRelativePath || f.name);
      state.fileMap.set(p, f);
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
  }

  function readSource() {
    if (state.tab === 'folder') {
      var file = state.fileMap.get(state.selectedPath);
      if (!file) return Promise.reject(new Error('请先选择文件夹里的 HTML 文件'));
      return file.text().then(function (text) {
        return {
          html: text,
          name: file.webkitRelativePath || file.name,
          baseDir: WXCore.dirname(state.selectedPath)
        };
      });
    }
    if (state.tab === 'file') {
      var single = singleInput.files && singleInput.files[0];
      if (!single) return Promise.reject(new Error('请先选择 HTML 文件'));
      return single.text().then(function (text) {
        return { html: text, name: single.name, baseDir: '' };
      });
    }
    var text = pasteInput.value;
    if (!text || !text.trim()) return Promise.reject(new Error('请先粘贴 HTML'));
    return Promise.resolve({ html: text, name: '粘贴内容', baseDir: '' });
  }

  // ---------- 解析 ----------

  function doParse() {
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
      state.processedHtml = out.html;
      state.report = out.report;
      state.sourceName = source.name;
      state.baseDir = source.baseDir || '';
      renderReport(out.report);
      renderPreview(out.html, out.report);
      insertBtn.disabled = false;
      setStatus(
        '解析完成：' + WXCore.basename(source.name) + ' · ' +
        out.report.stats.elements + ' 个元素，' +
        out.report.stats.rules + ' 条样式规则，' +
        out.report.images.length + ' 张图片',
        'ok'
      );
    }).catch(function (err) {
      setStatus('解析失败：' + (err && err.message ? err.message : err), 'err');
    }).then(function () {
      parseBtn.disabled = false;
    });
  }

  function renderReport(report) {
    var parts = ['<div class="wxh-chips">'];
    if (state.sourceName) parts.push(chip(WXCore.basename(state.sourceName)));
    parts.push(chip(report.stats.elements + ' 元素'));
    parts.push(chip(report.stats.rules + ' 条规则'));
    parts.push(chip(report.images.length + ' 张图'));
    if (report.stats.textLength) parts.push(chip(report.stats.textLength + ' 字'));
    parts.push('</div>');

    if (report.warnings.length) {
      report.warnings.forEach(function (w) {
        var bad = ['flex', 'grid', 'position', 'transform', 'animation', 'svg'].indexOf(w.code) !== -1;
        parts.push('<div class="wxh-warn-item' + (bad ? ' bad' : '') + '">' + esc(w.message) + '</div>');
      });
    } else {
      parts.push('<div class="wxh-okline">没有发现兼容性问题，可以直接插入。</div>');
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

    previewFrame.srcdoc = [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>html,body{margin:0;background:#fff}body{padding:14px 12px;',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
      '.wxh-pv{max-width:375px;margin:0 auto}</style></head><body><div class="wxh-pv">',
      doc.body.innerHTML,
      '</div></body></html>'
    ].join('');
    previewWrap.hidden = false;
  }

  // ---------- 插入 ----------

  function doInsert() {
    if (!state.processedHtml || !state.report) return;

    var editors = WXCore.findEditors(document);
    if (!editors.length) {
      setStatus('未找到公众号编辑器。请确认已打开「图文消息」编辑页。', 'err');
      showDiag();
      return;
    }

    var editor = editors[0];
    var replace = !!replaceOpt.checked;
    if (replace && (editor.el.textContent || '').trim() && !confirm('编辑器里已有内容，确定整体替换？')) {
      return;
    }

    insertBtn.disabled = true;
    var html = state.processedHtml;
    var report = state.report;
    var uploads = report.images.filter(function (img) {
      return img.kind === 'local' || img.kind === 'data';
    });
    var uploaded = {};
    var failed = [];
    var lastError = '';

    var chain = Promise.resolve();

    if (uploadOpt.checked && uploads.length) {
      var token = WXCore.getToken();
      if (!token) {
        setStatus('未从地址栏取到 token，跳过图片上传；本地图片会变成占位框。', 'warn');
      } else if (uploads.length >= 10 && !confirm('将上传 ' + uploads.length + ' 张图片到公众号素材库，继续？')) {
        insertBtn.disabled = false;
        return;
      } else {
        uploads.forEach(function (info, index) {
          chain = chain.then(function () {
            setStatus('上传图片 ' + (index + 1) + '/' + uploads.length + '…');
            var file = null;
            try {
              if (info.kind === 'local') {
                file = WXCore.resolveImagePath(info.src, state.baseDir, state.fileMap);
              } else {
                file = WXCore.dataUriToFile(info.src, info.id + '.png');
              }
            } catch (e) {
              file = null;
            }
            if (!file) {
              failed.push(info.id);
              return null;
            }
            return WXCore.uploadImage(file, token).then(function (url) {
              uploaded[info.id] = url;
            }).catch(function (err) {
              return WXCore.sleep(700).then(function () {
                return WXCore.uploadImage(file, token);
              }).then(function (url) {
                uploaded[info.id] = url;
              }).catch(function (err2) {
                lastError = err2 && err2.message ? err2.message : String(err2);
                failed.push(info.id);
              });
            });
          }).then(function () {
            return WXCore.sleep(250);
          });
        });
      }
    }

    chain.then(function () {
      var finalHtml = WXInliner.resolveImages(html, uploaded);
      var pending = report.images.filter(function (img) {
        return (img.kind === 'local' || img.kind === 'data') && !uploaded[img.id];
      }).map(function (img) { return img.id; });
      if (pending.length) finalHtml = WXInliner.placeholderImages(finalHtml, pending);

      return WXCore.insertHtml(editor.el, finalHtml, { mode: replace ? 'replace' : 'append' })
        .then(function (result) {
          state.lastDiag = {
            time: new Date().toISOString().slice(11, 19),
            url: location.href.slice(0, 140),
            editor: WXCore.describeEditor(editor),
            mode: replace ? 'replace' : 'append',
            insert: result,
            editorStyles: editor.el.querySelectorAll('[style]').length,
            editorHead: String(editor.el.innerHTML || '').slice(0, 300)
          };
          if (result.ok) {
            var extra = failed.length ? ('；' + failed.length + ' 张图片未上传，已放占位框') : '';
            var errNote = lastError ? ('（' + lastError + '）') : '';
            setStatus('已插入（方式 ' + result.method + '，样式校验通过' + extra + errNote +
              '）。请预览后手动保存草稿。', failed.length ? 'warn' : 'ok');
          } else {
            setStatus('插入未通过校验：' + (result.reason || '未知原因') +
              '。点右下角「复制诊断」把信息发我。', 'err');
            showDiag();
          }
        });
    }).catch(function (err) {
      setStatus('插入出错：' + (err && err.message ? err.message : err), 'err');
    }).then(function () {
      insertBtn.disabled = false;
    });
  }

  // ---------- 诊断 ----------

  function showDiag() {
    var editors = WXCore.findEditors(document);
    var lines = [];
    lines.push('URL: ' + location.href.slice(0, 180));
    lines.push('token: ' + (WXCore.getToken() ? '有' : '无'));
    lines.push('编辑器候选: ' + editors.length);
    editors.forEach(function (editor, i) {
      lines.push('  ' + (i + 1) + '. ' + WXCore.describeEditor(editor) + '  score=' + Math.round(editor.score));
    });
    if (!editors.length) {
      lines.push('');
      lines.push('请打开「图文消息」编辑页（新建或编辑草稿）后再试；列表页没有编辑器。');
      lines.push('若已在编辑页仍找不到，把这段信息发给开发者。');
    }
    diagEl.textContent = lines.join('\n');
    diagEl.hidden = false;
  }

  // ---------- 启动 ----------

  function refreshFab() {
    var found = false;
    try {
      found = WXCore.findEditors(document).length > 0;
    } catch (e) {
      found = false;
    }
    if (found) state.showFabFallback = true;
    fab.hidden = !found && !state.showFabFallback;
    return found;
  }

  function boot() {
    if (!document.documentElement) return;
    buildUi();
    refreshFab();

    // 非编辑页也在 8 秒后露出入口，便于用「检测编辑器」排查
    setTimeout(function () {
      state.showFabFallback = true;
      refreshFab();
    }, 8000);

    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (refreshFab() || tries >= 40) clearInterval(timer);
    }, 1200);

    window.addEventListener('hashchange', refreshFab);
    window.addEventListener('popstate', refreshFab);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
