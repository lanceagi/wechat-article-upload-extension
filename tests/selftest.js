/* 自测：在真实浏览器里跑 inliner.js。由 run-tests.js 注入样本，也可在页面控制台手动调用。 */
(function () {
  'use strict';

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function parse(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function textOf(html) {
    var doc = parse(html);
    doc.querySelectorAll('style,script').forEach(function (el) { el.remove(); });
    return (doc.body.textContent || '').replace(/\s+/g, '');
  }

  function styleProps(html) {
    var doc = parse(html);
    var out = [];
    doc.querySelectorAll('[style]').forEach(function (el) {
      for (var i = 0; i < el.style.length; i++) {
        var p = el.style[i];
        out.push([p, el.style.getPropertyValue(p)]);
      }
    });
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(results) {
    var pass = results.filter(function (r) { return r.ok; }).length;
    var fail = results.length - pass;
    document.getElementById('summary').textContent =
      (fail ? 'FAIL' : 'PASS') + ' · ' + pass + ' passed, ' + fail + ' failed';
    document.getElementById('results').innerHTML = results.map(function (r) {
      return '<div class="row ' + (r.ok ? 'ok' : 'fail') + '">' +
        '<span class="tag">' + (r.ok ? 'PASS' : 'FAIL') + '</span>' + esc(r.name) +
        (r.detail ? '<div class="detail">' + esc(r.detail) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  window.runTests = function (samples) {
    var results = [];

    function test(name, fn) {
      try {
        fn();
        results.push({ name: name, ok: true });
      } catch (e) {
        results.push({ name: name, ok: false, detail: e && e.message ? e.message : String(e) });
      }
    }

    test('基准稿：无 style/class/id/script/on*', function () {
      var out = WXInliner.process(samples.baseline);
      var doc = parse(out.html);
      var bad = [];
      doc.querySelectorAll('*').forEach(function (el) {
        for (var i = 0; i < el.attributes.length; i++) {
          var n = el.attributes[i].name.toLowerCase();
          if (n === 'class' || n === 'id' || n.indexOf('on') === 0) bad.push(n);
        }
      });
      assert(bad.length === 0, '残留属性: ' + Array.from(new Set(bad)).slice(0, 6).join(','));
      assert(out.html.indexOf('<style') === -1, '仍有 <style>');
      assert(out.html.indexOf('<script') === -1, '仍有 <script>');
    });

    test('基准稿：文本不丢', function () {
      var out = WXInliner.process(samples.baseline);
      assert(textOf(out.html) === textOf(samples.baseline), '文本内容不一致');
    });

    test('基准稿：样式属性全部在白名单', function () {
      var out = WXInliner.process(samples.baseline);
      var allowed = new Set(WXInliner.constants.ALLOWED_PROPS);
      var bad = styleProps(out.html)
        .filter(function (p) { return !allowed.has(p[0]); })
        .map(function (p) { return p[0]; });
      assert(bad.length === 0, '越界属性: ' + Array.from(new Set(bad)).slice(0, 8).join(','));
    });

    test('基准稿：图片全部登记', function () {
      var out = WXInliner.process(samples.baseline);
      var srcCount = parse(samples.baseline).querySelectorAll('img').length;
      assert(srcCount > 0, '基准稿没有图片，测试无效');
      assert(out.report.images.length === srcCount,
        '源 ' + srcCount + ' 张，报告 ' + out.report.images.length + ' 张');
    });

    test('压力稿：报告 flex/grid/transform/position 降级', function () {
      var out = WXInliner.process(samples.stress);
      var u = out.report.unsupported;
      assert(u.flex + u.grid + u.transform + u.position > 0, '没有报告任何不支持布局');
    });

    test('压力稿：输出无 flex/grid/position/transform', function () {
      var out = WXInliner.process(samples.stress);
      var bad = styleProps(out.html).filter(function (p) {
        var v = String(p[1]).toLowerCase();
        if (p[0] === 'display' && (v.indexOf('flex') !== -1 || v.indexOf('grid') !== -1)) return true;
        if (p[0] === 'position') return true;
        if (p[0].indexOf('transform') === 0) return true;
        return false;
      });
      assert(bad.length === 0,
        '仍存在: ' + bad.slice(0, 5).map(function (p) { return p[0] + ':' + p[1]; }).join(' | '));
    });

    test('图片管线：resolve + placeholder + finalize', function () {
      var input = '<section><img src="a.png" alt="A">' +
        '<img src="https://mmbiz.qpic.cn/x/y.png" alt="B">' +
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="C"></section>';
      var out = WXInliner.process(input);
      assert(out.report.images.length === 3, '图片数应为 3');
      assert(out.report.images[0].kind === 'local', 'a.png 应为 local');
      assert(out.report.images[1].kind === 'mmbiz', 'mmbiz 应为 mmbiz');
      assert(out.report.images[2].kind === 'data', 'data 应为 data');

      var resolved = WXInliner.resolveImages(out.html, { 'img-1': 'https://mmbiz.qpic.cn/z.png' });
      assert(resolved.indexOf('https://mmbiz.qpic.cn/z.png') !== -1, 'resolve 未替换');

      var placed = WXInliner.placeholderImages(out.html, ['img-3']);
      assert(placed.indexOf('图片待上传：C') !== -1, 'placeholder 未生成');

      var finalHtml = WXInliner.finalize(out.html);
      assert(finalHtml.indexOf('data-wx-img') === -1, 'finalize 未清理 data-wx-img');
      assert(finalHtml.indexOf('data-wx-import') === -1, 'finalize 未清理 data-wx-import');
    });

    test('样式内联：class 规则、body 样式、CSS 变量、rem', function () {
      var input = '<html><head><style>' +
        ':root{--c:#ff0000}body{background:#fafafa;color:#333}' +
        '.x{font-size:1.5rem;color:var(--c)}' +
        '</style></head><body><p class="x">Hi</p></body></html>';
      var out = WXInliner.process(input);
      var doc = parse(out.html);
      var p = doc.querySelector('p');
      assert(p, '找不到 p');
      assert(p.style.fontSize === '24px', 'rem 未转 px: ' + p.style.fontSize);
      assert(/rgb\(255,\s*0,\s*0\)|#ff0000/i.test(p.style.color), 'CSS 变量未解析: ' + p.style.color);
      var root = doc.body.firstElementChild;
      assert(root && root.tagName.toLowerCase() === 'section', '缺少 wrapper');
      assert(/250,\s*250,\s*250|#fafafa/i.test(root.style.backgroundColor),
        'body 背景未迁移到 wrapper: ' + root.style.backgroundColor);
    });

    test('文件排序：正文稿优先，预览稿靠后，同分取较新', function () {
      var ranked = WXCore.rankHtmlEntries([
        { path: 'a/layout-preview.html', lastModified: 300 },
        { path: 'a/layout.html', lastModified: 100 },
        { path: 'a/排版预览-V4.html', lastModified: 400 },
        { path: 'a/天梯图-V2.html', lastModified: 200 },
        { path: 'a/天梯图-V11.html', lastModified: 500 }
      ]).map(function (e) { return e.path; });
      assert(ranked[0] === 'a/layout.html', '首个应为 layout.html，实际 ' + ranked[0]);
      assert(ranked.indexOf('a/天梯图-V11.html') < ranked.indexOf('a/天梯图-V2.html'),
        '同分时应取较新文件');
      assert(ranked.indexOf('a/layout-preview.html') > ranked.indexOf('a/layout.html'),
        '预览稿不应排在正文稿前');
    });

    test('媒体查询/伪元素：不崩且给出提示', function () {
      var input = '<style>@media (max-width:600px){.a{color:red}} .b::before{content:"x"}</style>' +
        '<p class="a b">T</p>';
      var out = WXInliner.process(input);
      var codes = out.report.warnings.map(function (w) { return w.code; });
      assert(codes.indexOf('media') !== -1, '未提示 @media');
      assert(codes.indexOf('pseudo') !== -1, '未提示伪元素');
      assert(out.html.indexOf('::before') === -1, '伪元素残留');
    });

    render(results);
    return {
      pass: results.filter(function (r) { return r.ok; }).length,
      fail: results.filter(function (r) { return !r.ok; }).length,
      results: results
    };
  };
})();
