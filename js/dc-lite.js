/* Notch site runtime: renders the page template with the page's Component, keeps a shared bag in localStorage. */
(function () {
  'use strict';

  /* ---------- shared bag ---------- */
  var KEY = 'notch-bag', LAST = 'notch-last-order';
  function read(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var Store = {
    get: function () { return read(KEY, []); },
    set: function (a) { write(KEY, a); },
    add: function (item) {
      var a = Store.get(), f = null;
      for (var i = 0; i < a.length; i++) if (a[i].key === item.key) f = a[i];
      if (f) { if (!item.single) f.qty = Math.min(5, f.qty + 1); }
      else { item.qty = 1; a.push(item); }
      Store.set(a);
    },
    remove: function (key) { Store.set(Store.get().filter(function (x) { return x.key !== key; })); },
    setQty: function (key, q) { var a = Store.get(); a.forEach(function (x) { if (x.key === key) x.qty = Math.max(1, Math.min(5, q)); }); Store.set(a); },
    has: function (key) { return Store.get().some(function (x) { return x.key === key; }); },
    count: function () { return Store.get().reduce(function (n, x) { return n + x.qty; }, 0); },
    total: function () { return Store.get().reduce(function (n, x) { return n + x.qty * x.price; }, 0); },
    checkout: function () { var a = Store.get(); if (a.length) { write(LAST, a); Store.set([]); } return read(LAST, null); }
  };
  window.NotchStore = Store;
  window.notchAdd = Store.add;

  /* ---------- template rendering ---------- */
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function whole(str) { var m = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/.exec(str || ''); return m ? m[1] : null; }
  function interp(str, scope) { return str.replace(HOLE, function (m, p) { var v = lookup(scope, p); return v == null ? '' : String(v); }); }
  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit' };
  var BOOL = { checked: 1, disabled: 1, open: 1, required: 1, selected: 1, hidden: 1 };
  var SVG = 'http://www.w3.org/2000/svg';

  function kids(node) { return node.content ? node.content.childNodes : node.childNodes; }
  function render(node, scope, out, ctx) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'template' && node.hasAttribute('data-for')) {
      var list = lookup(scope, whole(node.getAttribute('data-for')) || '') || [];
      var as = node.getAttribute('data-as') || 'item';
      list.forEach(function (it, i) {
        var s = Object.create(scope); s[as] = it; s.$index = i;
        Array.prototype.forEach.call(kids(node), function (c) { render(c, s, out, ctx); });
      });
      return;
    }
    if (tag === 'template' && node.hasAttribute('data-if')) {
      if (lookup(scope, whole(node.getAttribute('data-if')) || '')) Array.prototype.forEach.call(kids(node), function (c) { render(c, scope, out, ctx); });
      return;
    }
    var el = node.namespaceURI === SVG ? document.createElementNS(SVG, node.localName) : document.createElement(tag);
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name, lname = name.toLowerCase(), val = a.value;
      if (EVENTS[lname]) {
        var fn = lookup(scope, whole(val) || '');
        if (typeof fn === 'function') { var id = 'h' + (ctx.n++); ctx.h[id] = fn; el.setAttribute('data-on-' + EVENTS[lname], id); }
        continue;
      }
      var w = whole(val);
      if (w !== null) {
        var v = lookup(scope, w);
        if (BOOL[lname]) { if (v) el.setAttribute(name, ''); continue; }
        if (v == null || v === false) { if (lname.indexOf('aria-') === 0) el.setAttribute(name, 'false'); continue; }
        el.setAttribute(name, String(v));
        continue;
      }
      el.setAttribute(name, val.indexOf('{{') >= 0 ? interp(val, scope) : val);
    }
    Array.prototype.forEach.call(kids(node), function (c) { render(c, scope, el, ctx); });
    out.appendChild(el);
  }

  /* ---------- component base ---------- */
  function DCLogic(props) { this.props = props || {}; this.state = this.state || {}; }
  DCLogic.prototype.setState = function (p) {
    var next = typeof p === 'function' ? p(this.state) : p;
    this.state = Object.assign({}, this.state, next);
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };
  window.DCLogic = DCLogic;

  window.DC = {
    mount: function (Component, defaults) {
      var tpl = document.getElementById('tpl'), app = document.getElementById('app');
      var comp = new Component(Object.assign({}, defaults));
      var ctx = { h: {}, n: 0 };
      comp.__render = function () {
        var vals = comp.renderVals() || {};
        if ('bagCount' in vals) vals.bagCount = String(Store.count());
        if ('bagTotal' in vals) vals.bagTotal = '£' + Store.total();
        var next = { h: {}, n: 0 };
        var root = document.createElement('div');
        Array.prototype.forEach.call(tpl.content.childNodes, function (c) { render(c, vals, root, next); });
        ctx.h = next.h;
        window.morphdom(app, root, {
          childrenOnly: true,
          onBeforeElUpdated: function (from, to) {
            if (from.localName === 'details') { if (from.open) to.setAttribute('open', ''); else to.removeAttribute('open'); }
            if (from === document.activeElement && from.localName === 'input' && from.type !== 'checkbox') to.value = to.getAttribute('value') || '';
            return true;
          }
        });
        var c = Store.count();
        Array.prototype.forEach.call(document.querySelectorAll('[data-bag-count]'), function (s) { s.textContent = String(c); });
        if (!comp.__mounted) { comp.__mounted = true; if (comp.componentDidMount) comp.componentDidMount(); }
      };
      function fire(type, e, filter) {
        var t = e.target.closest ? e.target.closest('[data-on-' + type + ']') : null;
        if (!t || !app.contains(t)) return;
        if (filter && !filter(t)) return;
        var fn = ctx.h[t.getAttribute('data-on-' + type)];
        if (fn) fn(e);
      }
      app.addEventListener('click', function (e) { fire('click', e); });
      app.addEventListener('submit', function (e) { fire('submit', e); });
      /* React-style onChange: text fields update while typing; numbers, checkboxes and selects update on change */
      app.addEventListener('input', function (e) { fire('change', e, function (t) { return t.localName === 'textarea' || (t.localName === 'input' && /^(text|email|search|tel|url)$/.test(t.type)); }); });
      app.addEventListener('change', function (e) { fire('change', e, function (t) { return !(t.localName === 'textarea' || (t.localName === 'input' && /^(text|email|search|tel|url)$/.test(t.type))); }); });
      comp.__render();
      return comp;
    }
  };
})();
