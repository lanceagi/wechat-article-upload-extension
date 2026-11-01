/*!
 * 公众号 HTML 导入器 — inliner.js
 * 把任意 HTML 转成微信公众号编辑器可接受的形式：
 *   - <style> / class / id 全部内联到元素 style
 *   - 只保留微信支持的标签与 CSS 属性
 *   - 记录被降级、被丢弃、需要上传的图片
 *
 * 用法：
 *   const { html, report } = WXInliner.process(rawHtml);
 *   html = WXInliner.resolveImages(html, { 'img-1': 'https://mmbiz.qpic.cn/...' });
 *   html = WXInliner.placeholderImages(html, ['img-2']);
 *   html = WXInliner.finalize(html);
 *
 * 不联网、不上传、不发布。所有处理都在本地完成。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WXInliner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // 微信编辑器支持的标签。其余标签会被改名、拆壳或删除。
  var ALLOWED_TAGS = new Set([
    'section', 'p', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
    'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'img', 'a', 'code', 'pre', 'sub', 'sup'
  ]);

  // 语义标签 -> 微信安全标签
  var RENAME = {
    div: 'section', article: 'section', main: 'section', header: 'section',
    footer: 'section', aside: 'section', nav: 'section', figure: 'section',
    figcaption: 'p', font: 'span', small: 'span', big: 'span', center: 'p',
    address: 'p', dl: 'section', dt: 'p', dd: 'p',
    form: 'section', fieldset: 'section', label: 'span', legend: 'p',
    picture: 'span'
  };

  // 直接删除（含内容）
  var DROP = new Set([
    'script', 'style', 'link', 'meta', 'title', 'base', 'head', 'iframe',
    'object', 'embed', 'input', 'button', 'select', 'option',
    'textarea', 'svg', 'canvas', 'video',
    'audio', 'source', 'track', 'map', 'area', 'noscript',
    'template', 'dialog', 'slot', 'math'
  ]);

  var ALLOWED_ATTRS = new Set([
    'style', 'src', 'alt', 'href', 'colspan', 'rowspan', 'width', 'height'
  ]);

  // 内部标记：图片 id / 插入校验标记，输出前由 finalize 清掉
  var INTERNAL_ATTRS = new Set(['data-wx-img', 'data-wx-import']);

  // 微信正文可保留的 CSS 属性
  var ALLOWED_PROPS = new Set([
    'color', 'background', 'background-color', 'background-image',
    'background-repeat', 'background-position', 'background-size',
    'font', 'font-family', 'font-size', 'font-style', 'font-weight',
    'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-decoration', 'text-decoration-color',
    'text-decoration-line', 'text-decoration-style', 'text-indent',
    'text-transform', 'text-shadow', 'white-space', 'word-break',
    'word-wrap', 'overflow-wrap', 'vertical-align',
    'display', 'width', 'min-width', 'max-width', 'height', 'min-height',
    'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom',
    'margin-left', 'padding', 'padding-top', 'padding-right',
    'padding-bottom', 'padding-left', 'border', 'border-top', 'border-right',
    'border-bottom', 'border-left', 'border-color', 'border-style',
    'border-width', 'border-radius', 'border-top-left-radius',
    'border-top-right-radius', 'border-bottom-left-radius',
    'border-bottom-right-radius', 'box-sizing', 'box-shadow', 'opacity',
    'overflow', 'overflow-x', 'overflow-y', 'list-style', 'list-style-type',
    'list-style-position', 'list-style-image', 'table-layout',
    'border-collapse', 'border-spacing', 'caption-side', 'float', 'clear',
    'visibility'
  ]);

  // 明确不支持、需要报告并删除的属性
  var LAYOUT_PROPS = new Set([
    'position', 'top', 'right', 'bottom', 'left', 'inset', 'z-index',
    'transform', 'transform-origin', 'rotate', 'scale', 'translate',
    'transition', 'transition-property', 'transition-duration',
    'transition-timing-function', 'transition-delay',
    'animation', 'animation-name', 'animation-duration',
    'animation-timing-function', 'animation-delay', 'animation-iteration-count',
    'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow',
    'flex-shrink', 'flex-basis', 'justify-content', 'align-items',
    'align-content', 'align-self', 'gap', 'row-gap', 'column-gap', 'order',
    'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
    'grid-template-areas', 'grid-column', 'grid-row', 'grid-area',
    'place-items', 'place-content', 'place-self',
    'clip-path', 'filter', 'backdrop-filter', 'mix-blend-mode',
    'will-change', 'perspective', 'perspective-origin', 'cursor',
    'user-select', 'pointer-events', 'content', 'quotes',
    'counter-reset', 'counter-increment'
  ]);

  function makeReport() {
    return {
      version: VERSION,
      stats: { elements: 0, rules: 0, declarations: 0, textLength: 0 },
      removed: { tags: {}, attributes: {}, properties: {} },
      unsupported: {
        flex: 0, grid: 0, position: 0, transform: 0, animation: 0,
        backgroundImage: 0, other: 0
      },
      warnings: [],
      images: [],
      externalLinks: 0,
      mediaRules: 0,
      pseudoSelectors: 0
    };
  }

  function bump(map, key) {
    map[key] = (map[key] || 0) + 1;
  }

  function warn(report, code, message, count) {
    var hit = null;
    for (var i = 0; i < report.warnings.length; i++) {
      if (report.warnings[i].code === code) { hit = report.warnings[i]; break; }
    }
    if (hit) {
      hit.count += (count || 1);
      hit.message = message;
    } else {
      report.warnings.push({ code: code, message: message, count: count || 1 });
    }
  }

  // ---------- CSS 读取 ----------

  // 去掉某个 at-rule 的整块（用于 @font-face，避免临时样式触发字体请求）
  function stripAtBlock(css, at) {
    var lower = css.toLowerCase();
    var out = '';
    var i = 0;
    while (i < css.length) {
      var idx = lower.indexOf(at, i);
      if (idx === -1) { out += css.slice(i); break; }
      out += css.slice(i, idx);
      var brace = css.indexOf('{', idx);
      if (brace === -1) break;
      var depth = 0;
      var k = brace;
      for (; k < css.length; k++) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') {
          depth--;
          if (depth === 0) { k++; break; }
        }
      }
      i = k;
    }
    return out;
  }

  function collectRules(cssText, hostDoc, rules, report) {
    var css = String(cssText || '');
    if (!css.trim()) return;
    css = css.replace(/@import[^;]+;/gi, '');
    css = stripAtBlock(css, '@font-face');

    var list = null;
    var tempStyle = null;

    // 优先用构造样式表：不碰页面 DOM，也不受页面 CSP 的 style-src 影响
    if (typeof CSSStyleSheet !== 'undefined') {
      try {
        var constructed = new CSSStyleSheet();
        constructed.replaceSync(css);
        list = constructed.cssRules;
      } catch (e) {
        list = null;
      }
    }
    if (!list) {
      tempStyle = hostDoc.createElement('style');
      tempStyle.textContent = css;
      hostDoc.head.appendChild(tempStyle);
      list = tempStyle.sheet ? tempStyle.sheet.cssRules : null;
    }

    try {
      if (!list) {
        warn(report, 'cssParse', '有一段 CSS 无法解析，已跳过', 1);
        return;
      }
      for (var i = 0; i < list.length; i++) {
        var rule = list[i];
        if (rule.type === 1) { // CSSStyleRule
          var decls = [];
          for (var j = 0; j < rule.style.length; j++) {
            var prop = rule.style[j];
            decls.push([
              prop,
              rule.style.getPropertyValue(prop),
              rule.style.getPropertyPriority(prop)
            ]);
          }
          if (decls.length) {
            rules.push({
              selector: rule.selectorText,
              decls: decls,
              order: rules.length,
              spec: specificity(rule.selectorText)
            });
          }
        } else if (rule.type === 4) { // @media
          report.mediaRules++;
        }
        // @supports / @keyframes / @font-face 直接跳过
      }
    } finally {
      if (tempStyle) tempStyle.remove();
    }
  }

  // 粗略但够用的优先级：id / class / 标签
  function specificity(selector) {
    var s = String(selector).replace(/::[a-z-]+(\([^)]*\))?/gi, ' ');
    var a = (s.match(/#[\w-]+/g) || []).length;
    var b = (s.match(/\.[\w-]+/g) || []).length +
      (s.match(/\[[^\]]*\]/g) || []).length +
      (s.match(/:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
    var stripped = s
      .replace(/#[\w-]+/g, ' ')
      .replace(/\.[\w-]+/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/:(?!:)[\w-]+(\([^)]*\))?/g, ' ');
    var c = (stripped.match(/(^|[\s>+~,])([a-zA-Z][\w-]*)/g) || []).length;
    return [a, b, c];
  }

  function cmpSpec(x, y) {
    for (var i = 0; i < 3; i++) {
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return 0;
  }

  function splitSelectors(selector) {
    var out = [];
    var buf = '';
    var depth = 0;
    var quote = null;
    for (var i = 0; i < selector.length; i++) {
      var ch = selector[i];
      if (quote) {
        buf += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  // ---------- 声明处理 ----------

  function resolveVars(value, vars, depth) {
    if (!value || value.indexOf('var(') === -1) return value;
    depth = depth || 0;
    if (depth > 4) return value;
    var out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, function (m, name, fallback) {
      if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
        return resolveVars(vars[name], vars, depth + 1);
      }
      return fallback != null ? fallback.trim() : m;
    });
    return out;
  }

  // 只统计「主属性」，避免 flex:1 被 CSSOM 拆成 flex-grow/shrink/basis 后重复计数
  var PRIMARY_PROPS = {
    flex: new Set([
      'flex', 'flex-grow', 'flex-direction', 'flex-wrap', 'justify-content',
      'align-items', 'align-content', 'align-self', 'order', 'gap', 'row-gap'
    ]),
    grid: new Set([
      'grid', 'grid-template-columns', 'grid-template-rows',
      'grid-template-areas', 'grid-column', 'grid-row', 'grid-area'
    ]),
    position: new Set(['position']),
    transform: new Set(['transform']),
    animation: new Set(['animation', 'animation-name', 'transition', 'transition-property'])
  };

  function bumpUnsupported(report, prop) {
    if (PRIMARY_PROPS.flex.has(prop)) report.unsupported.flex++;
    else if (PRIMARY_PROPS.grid.has(prop)) report.unsupported.grid++;
    else if (PRIMARY_PROPS.position.has(prop)) report.unsupported.position++;
    else if (PRIMARY_PROPS.transform.has(prop)) report.unsupported.transform++;
    else if (PRIMARY_PROPS.animation.has(prop)) report.unsupported.animation++;
    else report.unsupported.other++;
  }

  // 返回 { prop, value } 或 null
  function normalizeDecl(prop, rawValue, report) {
    prop = String(prop || '').trim().toLowerCase();
    var value = String(rawValue == null ? '' : rawValue).trim();
    if (!prop || !value) return null;

    if (LAYOUT_PROPS.has(prop)) {
      bumpUnsupported(report, prop);
      return null;
    }
    if (!ALLOWED_PROPS.has(prop)) {
      bump(report.removed.properties, prop);
      return null;
    }

    // rem 统一按 16px 换算，避免微信根字号不确定
    value = value.replace(/(-?\d*\.?\d+)rem\b/gi, function (m, n) {
      return (parseFloat(n) * 16) + 'px';
    });

    if (prop === 'display') {
      var v = value.toLowerCase();
      if (v.indexOf('flex') !== -1) {
        report.unsupported.flex++;
        value = 'block';
      } else if (v.indexOf('grid') !== -1) {
        report.unsupported.grid++;
        value = 'block';
      } else if (!/^(block|inline|inline-block|table|table-row|table-cell|table-caption|table-header-group|table-row-group|list-item|none)$/.test(v)) {
        report.unsupported.other++;
        return null;
      }
    }

    // 背景图 URL 在微信里不会上传，保留纯色/渐变
    if ((prop === 'background' || prop === 'background-image' || prop === 'list-style-image') && /url\(/i.test(value)) {
      value = value.replace(/url\((?:[^()]|\([^()]*\))*\)/gi, '').replace(/\s+/g, ' ').trim();
      report.unsupported.backgroundImage++;
      if (!value) return null;
    }

    if (!value) return null;
    return { prop: prop, value: value };
  }

  function applyDecl(el, prop, rawValue, priority, report, vars) {
    var p = String(prop || '').trim().toLowerCase();
    if (!p) return false;
    if (p.indexOf('--') === 0) {
      if (vars) vars[p] = String(rawValue == null ? '' : rawValue).trim();
      return false;
    }
    var value = resolveVars(String(rawValue == null ? '' : rawValue), vars);
    if (/var\(/i.test(value)) {
      warn(report, 'vars', '有 CSS 变量无法解析，相关样式已跳过', 1);
      return false;
    }
    var norm = normalizeDecl(p, value, report);
    if (!norm) return false;
    try {
      el.style.setProperty(norm.prop, norm.value, priority || '');
    } catch (e) {
      return false;
    }
    return true;
  }

  // ---------- DOM 处理 ----------

  function rename(el, tag) {
    var doc = el.ownerDocument;
    var next = doc.createElement(tag);
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      next.setAttribute(a.name, a.value);
    }
    while (el.firstChild) next.appendChild(el.firstChild);
    el.replaceWith(next);
    return next;
  }

  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
  }

  function sanitizeAttributes(el, report) {
    var tag = el.tagName.toLowerCase();
    var attrs = Array.prototype.slice.call(el.attributes);
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var name = attr.name.toLowerCase();
      if (name === 'style') continue;
      if (INTERNAL_ATTRS.has(name)) continue;

      var keep = ALLOWED_ATTRS.has(name);
      if (keep) {
        if (name === 'src' || name === 'alt') keep = (tag === 'img');
        else if (name === 'href') {
          keep = (tag === 'a') && !/^\s*javascript:/i.test(attr.value);
        } else if (name === 'colspan' || name === 'rowspan') {
          keep = (tag === 'td' || tag === 'th');
        } else if (name === 'width' || name === 'height') {
          keep = (tag === 'img' || tag === 'table' || tag === 'td' || tag === 'th');
        }
      }
      if (!keep) {
        el.removeAttribute(attr.name);
        bump(report.removed.attributes, name);
      }
    }
  }

  function sanitizeStyle(el, report) {
    var decls = [];
    for (var i = 0; i < el.style.length; i++) decls.push(el.style[i]);
    for (var j = 0; j < decls.length; j++) {
      var p = decls[j];
      var v = el.style.getPropertyValue(p);
      var prio = el.style.getPropertyPriority(p);
      var norm = normalizeDecl(p, v, report);
      if (!norm) {
        el.style.removeProperty(p);
      } else if (norm.value !== v) {
        el.style.setProperty(norm.prop, norm.value, prio);
      }
    }
    var styleAttr = el.getAttribute('style');
    if (!styleAttr || !styleAttr.trim()) el.removeAttribute('style');
  }

  function parseFragment(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  // ---------- 主流程 ----------

  function process(html, options) {
    var opts = Object.assign({ marker: true }, options || {});
    if (typeof DOMParser === 'undefined') {
      throw new Error('需要浏览器环境（DOMParser 不可用）');
    }
    var report = makeReport();
    var doc = parseFragment(html);
    if (!doc.body) throw new Error('HTML 解析失败');

    // 1. 收集并移除 <style>
    var styleEls = Array.prototype.slice.call(doc.querySelectorAll('style'));
    var cssTexts = styleEls.map(function (el) { return el.textContent || ''; });
    var links = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"]'));
    if (links.length) {
      warn(report, 'externalCss', '发现 ' + links.length + ' 个外链样式表，无法读取；请改为 <style> 或内联样式', links.length);
    }
    var rules = [];
    cssTexts.forEach(function (css) {
      collectRules(css, document, rules, report);
    });
    styleEls.forEach(function (el) { el.remove(); });
    links.forEach(function (el) { el.remove(); });

    // 2. 记录 CSS 变量与原始内联样式
    var all = [doc.documentElement, doc.body].concat(
      Array.prototype.slice.call(doc.body.querySelectorAll('*'))
    );
    var vars = {};
    var inline = new Map();
    all.forEach(function (el) {
      var decls = [];
      for (var i = 0; i < el.style.length; i++) {
        var p = el.style[i];
        var v = el.style.getPropertyValue(p);
        var prio = el.style.getPropertyPriority(p);
        if (p.indexOf('--') === 0) vars[p] = v;
        decls.push([p, v, prio]);
      }
      inline.set(el, decls);
      if (el.hasAttribute('style')) el.removeAttribute('style');
    });

    // 先收集所有样式表里的 CSS 变量，避免定义顺序影响 var() 解析
    rules.forEach(function (rule) {
      rule.decls.forEach(function (d) {
        if (d[0].indexOf('--') === 0) vars[d[0]] = d[1];
      });
    });

    // 3. 按优先级应用样式表
    rules.sort(function (a, b) {
      return cmpSpec(a.spec, b.spec) || (a.order - b.order);
    });
    var applied = 0;
    rules.forEach(function (rule) {
      splitSelectors(rule.selector).forEach(function (part) {
        if (part.indexOf('::') !== -1) {
          report.pseudoSelectors++;
          return;
        }
        var nodes;
        try {
          nodes = doc.querySelectorAll(part);
        } catch (e) {
          return;
        }
        for (var i = 0; i < nodes.length; i++) {
          for (var j = 0; j < rule.decls.length; j++) {
            var d = rule.decls[j];
            if (applyDecl(nodes[i], d[0], d[1], d[2], report, vars)) applied++;
          }
        }
      });
    });

    // 4. 原始内联样式最后应用，优先级最高
    inline.forEach(function (decls, el) {
      for (var i = 0; i < decls.length; i++) {
        var d = decls[i];
        if (d[0].indexOf('--') === 0) continue;
        applyDecl(el, d[0], d[1], d[2], report, vars);
      }
    });

    // 5. 标签改名 / 删除 / 拆壳
    var initial = Array.prototype.slice.call(doc.body.querySelectorAll('*'));
    initial.forEach(function (el) {
      if (!el.parentNode) return;
      var tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) {
        bump(report.removed.tags, tag);
        el.remove();
        return;
      }
      if (RENAME[tag]) {
        rename(el, RENAME[tag]);
        return;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        bump(report.removed.tags, tag);
        unwrap(el);
      }
    });

    // 6. 属性与样式清洗
    var finalEls = [doc.documentElement, doc.body].concat(
      Array.prototype.slice.call(doc.body.querySelectorAll('*'))
    );
    finalEls.forEach(function (el) { sanitizeAttributes(el, report); });
    finalEls.forEach(function (el) { sanitizeStyle(el, report); });

    // 7. 图片分类
    var imgs = Array.prototype.slice.call(doc.body.querySelectorAll('img'));
    imgs.forEach(function (img, idx) {
      var id = 'img-' + (idx + 1);
      img.setAttribute('data-wx-img', id);
      var src = (img.getAttribute('src') || '').trim();
      var kind = 'local';
      if (!src) kind = 'missing';
      else if (/^https?:\/\/mmbiz\.qpic\.cn\//i.test(src)) kind = 'mmbiz';
      else if (/^data:/i.test(src)) kind = 'data';
      else if (/^(https?:)?\/\//i.test(src)) kind = 'external';
      report.images.push({
        id: id,
        src: src,
        kind: kind,
        alt: img.getAttribute('alt') || ''
      });
    });

    // 8. 外链统计
    var linksOut = doc.body.querySelectorAll('a[href]');
    for (var li = 0; li < linksOut.length; li++) {
      var href = linksOut[li].getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) && !/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) {
        report.externalLinks++;
      }
    }

    // 9. 包一层 section，承接 html/body 的样式
    var wrapper = doc.createElement('section');
    var htmlStyle = (doc.documentElement.getAttribute('style') || '').trim().replace(/;+$/, '');
    var bodyStyle = (doc.body.getAttribute('style') || '').trim().replace(/;+$/, '');
    var merged = [htmlStyle, bodyStyle].filter(Boolean).join(';');
    if (merged) wrapper.setAttribute('style', merged);
    while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild);
    doc.body.appendChild(wrapper);
    doc.documentElement.removeAttribute('style');
    doc.body.removeAttribute('style');
    if (opts.marker) {
      wrapper.setAttribute('data-wx-import', 'wx-' + Math.random().toString(36).slice(2, 10));
    }

    // 10. 统计与提示
    report.stats.elements = finalEls.length;
    report.stats.rules = rules.length;
    report.stats.declarations = applied;
    report.stats.textLength = (doc.body.textContent || '').replace(/\s+/g, '').length;

    if (report.mediaRules) {
      warn(report, 'media', '忽略了 ' + report.mediaRules + ' 条 @media 规则（微信不支持响应式断点）', report.mediaRules);
    }
    if (report.pseudoSelectors) {
      warn(report, 'pseudo', '忽略了 ' + report.pseudoSelectors + ' 个伪元素选择器（微信不支持 ::before/::after）', report.pseudoSelectors);
    }
    if (report.unsupported.flex) {
      warn(report, 'flex', report.unsupported.flex + ' 处 flex 布局已降级为块级，横向排版会变成纵向', report.unsupported.flex);
    }
    if (report.unsupported.grid) {
      warn(report, 'grid', report.unsupported.grid + ' 处 grid 布局已降级为块级，网格会变成纵向', report.unsupported.grid);
    }
    if (report.unsupported.position) {
      warn(report, 'position', report.unsupported.position + ' 处绝对/相对定位已移除，元素会回到正常文档流', report.unsupported.position);
    }
    if (report.unsupported.transform) {
      warn(report, 'transform', report.unsupported.transform + ' 处 transform 已移除', report.unsupported.transform);
    }
    if (report.unsupported.animation) {
      warn(report, 'animation', report.unsupported.animation + ' 处动画/过渡已移除', report.unsupported.animation);
    }
    if (report.unsupported.backgroundImage) {
      warn(report, 'bgImage', report.unsupported.backgroundImage + ' 处背景图已移除（微信正文不加载 CSS 背景图）', report.unsupported.backgroundImage);
    }
    var localImgs = report.images.filter(function (i) { return i.kind === 'local' || i.kind === 'data'; }).length;
    if (localImgs) {
      warn(report, 'imagesLocal', localImgs + ' 张本地/base64 图片需要先上传到公众号素材库', localImgs);
    }
    var extImgs = report.images.filter(function (i) { return i.kind === 'external'; }).length;
    if (extImgs) {
      warn(report, 'imagesExternal', extImgs + ' 张外链图片在微信正文中可能无法显示', extImgs);
    }
    if (report.externalLinks) {
      warn(report, 'links', report.externalLinks + ' 个外链在未认证公众号中可能不可点击', report.externalLinks);
    }
    if (report.removed.tags.svg) {
      warn(report, 'svg', '移除了 ' + report.removed.tags.svg + ' 个 <svg>；图表建议先转成图片再导入', report.removed.tags.svg);
    }
    if (report.removed.tags.script) {
      warn(report, 'script', '移除了 ' + report.removed.tags.script + ' 个 <script>', report.removed.tags.script);
    }

    return { html: doc.body.innerHTML, report: report };
  }

  // ---------- 输出处理 ----------

  function resolveImages(html, map) {
    var doc = parseFragment(html);
    var imgs = doc.querySelectorAll('img[data-wx-img]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var id = img.getAttribute('data-wx-img');
      if (map && map[id]) {
        img.setAttribute('src', map[id]);
        img.removeAttribute('data-wx-img');
      }
    }
    return doc.body.innerHTML;
  }

  function placeholderImages(html, ids) {
    var set = new Set(ids || []);
    var doc = parseFragment(html);
    var imgs = Array.prototype.slice.call(doc.querySelectorAll('img[data-wx-img]'));
    imgs.forEach(function (img) {
      var id = img.getAttribute('data-wx-img');
      if (set.size && !set.has(id)) return;
      var alt = img.getAttribute('alt') || '图片';
      var sec = doc.createElement('section');
      sec.setAttribute(
        'style',
        'margin:16px 0;padding:20px 12px;border:1px dashed #c8ced6;background:#f7f9fc;' +
        'text-align:center;font-size:13px;line-height:1.6;color:#7a838d;border-radius:6px;'
      );
      sec.textContent = '图片待上传：' + alt;
      img.replaceWith(sec);
    });
    return doc.body.innerHTML;
  }

  function finalize(html) {
    var doc = parseFragment(html);
    var nodes = doc.querySelectorAll('[data-wx-img],[data-wx-import]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute('data-wx-img');
      nodes[i].removeAttribute('data-wx-import');
    }
    return doc.body.innerHTML;
  }

  return {
    version: VERSION,
    process: process,
    resolveImages: resolveImages,
    placeholderImages: placeholderImages,
    finalize: finalize,
    constants: {
      ALLOWED_TAGS: Array.from(ALLOWED_TAGS),
      ALLOWED_PROPS: Array.from(ALLOWED_PROPS),
      LAYOUT_PROPS: Array.from(LAYOUT_PROPS)
    }
  };
});
