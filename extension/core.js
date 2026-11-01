/*!
 * 公众号 HTML 导入器 — core.js
 * 编辑器定位、HTML 注入、图片上传、路径解析。
 * 只在 mp.weixin.qq.com 页面内运行；不申请额外权限。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WXCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var MIN_EDITOR_AREA = 20000;

  // ---------- 路径 ----------

  function normalizePath(p) {
    var parts = [];
    String(p || '').replace(/\\/g, '/').split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return parts.join('/');
  }

  function dirname(p) {
    var s = String(p || '');
    var i = s.lastIndexOf('/');
    return i < 0 ? '' : s.slice(0, i);
  }

  function basename(p) {
    var s = String(p || '');
    var i = s.lastIndexOf('/');
    return i < 0 ? s : s.slice(i + 1);
  }

  // 文件夹模式下给 HTML 排序：正文稿优先，预览稿排最后，同分取最新修改
  function scoreHtmlPath(path) {
    var p = String(path || '');
    var s = p.split('/').length;
    if (/preview|预览/i.test(p)) {
      s += 100;
    } else {
      if (/layout/i.test(p)) s -= 50;
      if (/排版/.test(p)) s -= 40;
      if (/index\.html?$/i.test(p)) s -= 30;
      if (/article/i.test(p)) s -= 20;
    }
    return s;
  }

  /**
   * @param {Array<{path:string,lastModified?:number}>} entries
   */
  function rankHtmlEntries(entries) {
    return entries.slice().sort(function (a, b) {
      var diff = scoreHtmlPath(a.path) - scoreHtmlPath(b.path);
      if (diff) return diff;
      var time = (b.lastModified || 0) - (a.lastModified || 0);
      if (time) return time;
      return String(a.path).localeCompare(String(b.path));
    });
  }

  /**
   * 把 HTML 里的相对图片路径映射到文件夹里真实的 File。
   * @param {string} src
   * @param {string} baseDir  选中 HTML 所在目录（相对文件夹根）
   * @param {Map<string, File>} fileMap  规范化路径 -> File
   */
  function resolveImagePath(src, baseDir, fileMap) {
    if (!src || !fileMap || !fileMap.size) return null;
    var s = String(src).trim();
    if (/^(data:|https?:|\/\/)/i.test(s)) return null;

    s = s.split('#')[0].split('?')[0];
    try { s = decodeURIComponent(s); } catch (e) { /* keep */ }
    s = s.replace(/\\/g, '/');
    if (s.indexOf('file://') === 0) s = s.slice(7);

    var full;
    if (s.charAt(0) === '/') {
      full = normalizePath(s);
    } else {
      full = normalizePath((baseDir ? baseDir + '/' : '') + s);
    }
    if (fileMap.has(full)) return fileMap.get(full);

    // 绝对路径（家目录形式）或层级不一致时，按文件名兜底
    var name = basename(s);
    var hits = [];
    fileMap.forEach(function (file, key) {
      if (basename(key) === name) hits.push(file);
    });
    return hits.length === 1 ? hits[0] : null;
  }

  function dataUriToFile(src, name) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(String(src || ''));
    if (!m) throw new Error('不是合法的 data URI');
    var mime = m[1] || 'image/png';
    var isBase64 = !!m[2];
    var payload = m[3] || '';
    var bytes;
    if (isBase64) {
      var bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      var text = decodeURIComponent(payload);
      bytes = new TextEncoder().encode(text);
    }
    var ext = mime.split('/')[1] || 'png';
    ext = ext.replace(/[^a-z0-9]/gi, '') || 'png';
    return new File([bytes], name || ('image.' + ext), { type: mime });
  }

  // ---------- 编辑器定位 ----------

  function classNameOf(el) {
    return typeof el.className === 'string' ? el.className : '';
  }

  function candidateSelector() {
    return [
      '[contenteditable="true"]',
      '[contenteditable=""]',
      '.edui-body-container',
      '.ProseMirror',
      '[role="textbox"][contenteditable="true"]'
    ].join(',');
  }

  function collectIn(doc, frame, out) {
    var nodes;
    try {
      nodes = doc.querySelectorAll(candidateSelector());
    } catch (e) {
      nodes = [];
    }
    for (var i = 0; i < nodes.length; i++) {
      addCandidate(nodes[i], frame, out);
    }
    if (doc.body && doc.body.isContentEditable) addCandidate(doc.body, frame, out);
  }

  function addCandidate(el, frame, out) {
    if (!el || !el.getBoundingClientRect) return;
    var rect = el.getBoundingClientRect();
    var area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area < MIN_EDITOR_AREA) return;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    if (win) {
      var cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
    }
    var label = (el.id || '') + ' ' + classNameOf(el);
    var score = area;
    if (/ueditor|editor|rich_media|appmsg/i.test(label)) score *= 1.5;
    if (frame) score *= 1.15;
    out.push({ el: el, frame: frame, area: area, score: score });
  }

  /**
   * 返回按可信度排序的编辑器候选。
   * @param {Document} rootDoc
   */
  function findEditors(rootDoc) {
    var doc = rootDoc || document;
    var out = [];
    collectIn(doc, null, out);

    var iframes = doc.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      var frame = iframes[i];
      var inner = null;
      try { inner = frame.contentDocument; } catch (e) { inner = null; }
      if (!inner || !inner.body) continue;
      collectIn(inner, frame, out);
    }

    var seen = new Set();
    out = out.filter(function (item) {
      if (seen.has(item.el)) return false;
      seen.add(item.el);
      return true;
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function describeEditor(item) {
    if (!item || !item.el) return '未找到';
    var el = item.el;
    var rect = el.getBoundingClientRect();
    return [
      '标签=' + el.tagName.toLowerCase(),
      'id=' + (el.id || '-'),
      'class=' + (classNameOf(el) || '-'),
      '尺寸=' + Math.round(rect.width) + '×' + Math.round(rect.height),
      item.frame ? ('iframe#' + (item.frame.id || '-')) : '主文档'
    ].join(' · ');
  }

  // ---------- 注入 ----------

  function dispatchInput(editable) {
    var win = editable.ownerDocument && editable.ownerDocument.defaultView;
    if (!win) return;
    try {
      editable.dispatchEvent(new win.Event('input', { bubbles: true }));
      editable.dispatchEvent(new win.Event('change', { bubbles: true }));
    } catch (e) { /* ignore */ }
  }

  function parseForCheck(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function normText(s) {
    return String(s || '').replace(/\s+/g, '');
  }

  function stripInternalMarks(editable) {
    var nodes = editable.querySelectorAll('[data-wx-import],[data-wx-img]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute('data-wx-import');
      nodes[i].removeAttribute('data-wx-img');
    }
  }

  /**
   * 把 HTML 插入编辑器。1.2.0 起改为「直写优先 + 延时样式校验 + 自动换路重试」：
   * 微信编辑器可能对 execCommand 插入的内容剥内联样式，直写 body 不经过它的输入管线；
   * 每次尝试后等 350ms 再校验文字与样式计数，全部失败时保留文字并返回原因与诊断数据。
   * @param {HTMLElement} editable
   * @param {string} html
   * @param {{mode?: 'replace'|'append'}} opts
   * @returns {Promise<{ok:boolean,method:string,verified?:boolean,reason?:string,diag?:object}>}
   */
  function insertHtml(editable, html, opts) {
    opts = opts || {};
    var mode = opts.mode === 'append' ? 'append' : 'replace';
    var doc = editable.ownerDocument;
    var win = doc && doc.defaultView;
    if (!doc || !win) {
      return Promise.resolve({ ok: false, method: 'none', reason: '编辑器文档不可用' });
    }

    var parsed = parseForCheck(html);
    var intendedStyles = parsed.querySelectorAll('[style]').length;
    var signature = normText(parsed.body.textContent).slice(0, 30);
    var beforeHtml = editable.innerHTML;
    var beforeStyles = editable.querySelectorAll('[style]').length;
    var styleFloor = Math.max(1, Math.floor(intendedStyles * 0.6));

    function attemptDirect() {
      if (mode === 'replace') editable.innerHTML = html;
      else editable.insertAdjacentHTML('beforeend', html);
      return 'direct';
    }

    function attemptExecCommand() {
      try { editable.focus({ preventScroll: true }); } catch (e) { try { editable.focus(); } catch (e2) {} }
      var range = doc.createRange();
      range.selectNodeContents(editable);
      if (mode === 'append') range.collapse(false);
      try {
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) { /* ignore */ }
      try { doc.execCommand('insertHTML', false, html); } catch (e) { /* ignore */ }
      return 'execCommand';
    }

    function stylesNow() { return editable.querySelectorAll('[style]').length; }
    function textOk() {
      return signature === '' || normText(editable.textContent).indexOf(signature) !== -1;
    }
    function styleOk() {
      if (intendedStyles === 0) return true;
      if (mode === 'replace') return stylesNow() >= styleFloor;
      return (stylesNow() - beforeStyles) >= styleFloor;
    }

    var outcome = null;
    var chain = Promise.resolve();
    [attemptDirect, attemptExecCommand].forEach(function (run) {
      chain = chain.then(function () {
        if (outcome) return null;
        // 重试前恢复原始内容，避免叠加出重复段落
        if (mode === 'append') {
          try { editable.innerHTML = beforeHtml; } catch (e) { /* ignore */ }
        }
        var name = run();
        return sleep(350).then(function () {
          if (textOk() && styleOk()) {
            stripInternalMarks(editable);
            if (name === 'execCommand') dispatchInput(editable);
            outcome = { ok: true, method: name, verified: true };
          }
          return null;
        });
      });
    });

    return chain.then(function () {
      if (outcome) return outcome;
      var textFound = textOk();
      return {
        ok: false,
        method: 'none',
        verified: false,
        reason: textFound
          ? '内容已进入编辑器，但内联样式被剥掉（样式校验未通过）'
          : '未能在编辑器里检测到插入的内容',
        diag: {
          intendedStyles: intendedStyles,
          editorStyles: stylesNow(),
          textFound: textFound,
          signature: signature
        }
      };
    });
  }

  // ---------- 图片上传 ----------

  function getToken() {
    try {
      return new URL(location.href).searchParams.get('token') || '';
    } catch (e) {
      return '';
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * 复用公众号后台自己的上传接口，把图片写进素材库并拿到 mmbiz 地址。
   * 该接口未公开，微信改版时可能失效；失败由调用方降级为占位框。
   */
  function uploadImage(file, token) {
    if (!token) return Promise.reject(new Error('缺少 token，请确认当前在公众号编辑页'));

    var ts = Date.now();
    var params = new URLSearchParams({
      action: 'upload_material',
      f: 'json',
      scene: '8',
      writetype: 'doublewrite',
      groupid: '1',
      localid: String(ts),
      token: token,
      lang: 'zh_CN',
      seq: String(ts)
    });
    var url = 'https://mp.weixin.qq.com/cgi-bin/filetransfer?' + params.toString();

    var fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('id', String(Date.now()));
    fd.append('name', file.name);
    fd.append('type', 'image');
    fd.append('lastModifiedDate', new Date(file.lastModified || Date.now()).toString());
    fd.append('size', String(file.size));

    return fetch(url, {
      method: 'POST',
      body: fd,
      credentials: 'include'
    }).then(function (res) {
      return res.text().then(function (text) {
        var json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error('上传接口返回非 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120));
        }
        var ret = json.base_resp && json.base_resp.ret;
        if (ret !== undefined && ret !== 0) {
          throw new Error((json.base_resp && json.base_resp.err_msg) || ('上传失败 ret=' + ret));
        }
        var src = json.cdn_url || json.content_url || json.url;
        if (!src) {
          throw new Error('上传接口未返回图片地址：' + JSON.stringify(json).slice(0, 200));
        }
        return String(src).replace(/^http:\/\//i, 'https://');
      });
    });
  }

  return {
    version: VERSION,
    findEditors: findEditors,
    describeEditor: describeEditor,
    insertHtml: insertHtml,
    getToken: getToken,
    uploadImage: uploadImage,
    resolveImagePath: resolveImagePath,
    dataUriToFile: dataUriToFile,
    normalizePath: normalizePath,
    dirname: dirname,
    basename: basename,
    scoreHtmlPath: scoreHtmlPath,
    rankHtmlEntries: rankHtmlEntries,
    sleep: sleep
  };
});
