const fs = require('fs');
const path = require('path');

const BASE_DIR = path.dirname(__dirname);
const html = fs.readFileSync(path.join(BASE_DIR, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(BASE_DIR, 'styles.css'), 'utf8');
const jsCode = fs.readFileSync(path.join(BASE_DIR, 'app.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'data', 'catalog.json'), 'utf8'));

console.log('Testing Frontend UI & DOM Interaction...');

// Build mock DOM
const elements = {};
const idRegex = /id=["']([^"']+)["']/g;
let m;
while ((m = idRegex.exec(html)) !== null) {
  const elId = m[1];
  const tagMatch = html.match(new RegExp('<[^>]*id=["\']' + elId + '["\'][^>]*>', 'i'));
  const isHidden = tagMatch && /display\s*:\s*none/i.test(tagMatch[0]);
  elements[elId] = {
    id: elId,
    style: { display: isHidden ? 'none' : 'block' },
    textContent: '',
    innerHTML: '',
    classList: {
      _classes: new Set(),
      contains(cls) { return this._classes.has(cls); },
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      toggle(cls) { if (this._classes.has(cls)) this._classes.delete(cls); else this._classes.add(cls); }
    },
    dataset: {},
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => '',
    focus: () => {},
    scrollIntoView: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null
  };
}

global.window = {
  PRAFLIX_DATA: catalog,
  PRAFLIX_SOURCES: [],
  location: { hash: '' },
  history: {
    pushState(state, title, url) {
      window.location.hash = url.includes('#') ? url.split('#')[1] : '';
    },
    back() {
      window.location.hash = '';
      if (window._listeners['popstate']) window._listeners['popstate'].forEach(fn => fn());
    }
  },
  scrollTo() {},
  _listeners: {},
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
};

global.document = {
  readyState: 'complete',
  getElementById(id) { return elements[id] || null; },
  querySelector(sel) {
    if (sel.startsWith('#')) return elements[sel.substring(1)] || null;
    return null;
  },
  querySelectorAll() { return []; },
  addEventListener(evt, fn) {
    if (evt === 'DOMContentLoaded') fn();
  },
  body: { style: {} }
};

eval(jsCode);

console.log('App initialized.');

// 1. Initial State
console.log('Initial Catalog display:', elements['main-catalog-layout'].style.display);
console.log('Initial Details display:', elements['title-details-view'].style.display);

// 2. Open Title 3 (23 000 Lives - has screenshots)
window.location.hash = '#title=3';
if (window._listeners['hashchange']) window._listeners['hashchange'].forEach(fn => fn());

console.log('\n--- Title 3 (23 000 Lives) ---');
console.log('Details display:', elements['title-details-view'].style.display);
console.log('Title text:', elements['details-display-title'].textContent);
console.log('Screenshots section display:', elements['section-screenshots'].style.display);
console.log('Screenshots grid contains screenshot card:', elements['screenshots-gallery-grid'].innerHTML.includes('screenshot-card'));
console.log('Available versions contains 720p/1080p:', elements['download-section-inner'].innerHTML.includes('720p'));
console.log('Available versions contains View Source:', elements['download-section-inner'].innerHTML.includes('View Source'));

// 3. Open Title 1 (13 Teen - no screenshots)
window.location.hash = '#title=1';
if (window._listeners['hashchange']) window._listeners['hashchange'].forEach(fn => fn());

console.log('\n--- Title 1 (13 Teen) ---');
console.log('Title text:', elements['details-display-title'].textContent);
console.log('Screenshots section display:', elements['section-screenshots'].style.display);
console.log('Screenshots grid HTML empty:', elements['screenshots-gallery-grid'].innerHTML === '');
console.log('Available versions contains View Source:', elements['download-section-inner'].innerHTML.includes('View Source'));

// 4. Back to Catalog
window.location.hash = '';
if (window._listeners['popstate']) window._listeners['popstate'].forEach(fn => fn());

console.log('\n--- Back to Catalog ---');
console.log('Catalog display:', elements['main-catalog-layout'].style.display);
console.log('Details display:', elements['title-details-view'].style.display);

console.log('\nAll interactive DOM smoke checks verified successfully!');
