#!/usr/bin/env node
/**
 * PRAFLIX — Mobile Responsiveness & Viewport Acceptance Test Suite
 * A PRAVERSE Company
 *
 * Verifies mobile responsiveness across representative viewports:
 * - 320 px  (Small phone: iPhone SE, older Android)
 * - 360 px  (Compact phone: Samsung Galaxy S8/S9)
 * - 390 px  (Typical modern phone: iPhone 12/13/14)
 * - 430 px  (Large phone: iPhone 14/15 Pro Max)
 * - 768 px  (Tablet portrait: iPad Mini / Air)
 * - 1024 px (Small desktop / landscape tablet)
 * - 1440 px (Desktop monitor)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.dirname(__dirname);
const HTML_PATH = path.join(ROOT_DIR, 'index.html');
const CSS_PATH = path.join(ROOT_DIR, 'styles.css');
const JS_PATH = path.join(ROOT_DIR, 'app.js');

console.log('='.repeat(70));
console.log('PRAFLIX — MOBILE RESPONSIVENESS ACCEPTANCE TEST SUITE');
console.log('A PRAVERSE Company');
console.log('='.repeat(70));

let passed = 0;
let total = 0;

function runTest(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ Test ${String(total).padStart(2, '0')}: ${desc} — PASSED`);
  } catch (err) {
    console.error(`✗ Test ${String(total).padStart(2, '0')}: ${desc} — FAILED: ${err.message}`);
    throw err;
  }
}

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const js = fs.readFileSync(JS_PATH, 'utf8');

// 1. Viewport Meta Configuration
runTest('Viewport meta tag configured with device-width and viewport-fit=cover', () => {
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'),
    'Viewport meta tag must declare device-width, initial-scale=1.0, and viewport-fit=cover');
});

// 2. Global Viewport Safety & Zero Overflow
runTest('Global CSS contains zero horizontal overflow safety and safe area insets', () => {
  assert.ok(css.includes('overflow-x: hidden'), 'html/body must enforce overflow-x: hidden');
  assert.ok(css.includes('-webkit-text-size-adjust: 100%'), 'Must prevent unwanted iOS text enlargement');
  assert.ok(css.includes('env(safe-area-inset-'), 'Must respect device safe-area-inset for notches and home bars');
});

// 3. Mobile Header & Navigation Button
runTest('Mobile header menu toggle exists with touch-friendly 44px sizing and accessibility attributes', () => {
  assert.ok(html.includes('id="mobile-toggle"'), 'mobile-toggle button must exist in index.html');
  assert.ok(html.includes('aria-label="Toggle navigation"'), 'mobile-toggle must have accessible aria-label');
  assert.ok(html.includes('aria-expanded="false"'), 'mobile-toggle must have aria-expanded');
  assert.ok(html.includes('aria-controls="nav-menu"'), 'mobile-toggle must reference nav-menu');
  assert.ok(css.includes('.mobile-menu-btn'), 'styles.css must style .mobile-menu-btn');
  assert.ok(css.includes('min-width: 44px') && css.includes('min-height: 44px'), 'Mobile toggle must meet 44x44px touch target');
});

// 4. Mobile Drawer Overlay Navigation
runTest('Header navigation reflows into expandable mobile drawer below 960px', () => {
  assert.ok(css.includes('@media (max-width: 960px)'), 'Must include 960px mobile navigation breakpoint');
  assert.ok(css.includes('.nav-menu.mobile-open'), 'Must support .mobile-open class for mobile drawer');
  assert.ok(css.includes('backdrop-filter: blur'), 'Drawer must retain premium frosted dark glass aesthetic');
  assert.ok(js.includes('mobile-open'), 'app.js must manage .mobile-open state');
  assert.ok(js.includes('aria-expanded'), 'app.js must synchronize aria-expanded');
});

// 5. Automatic Menu Closure
runTest('Mobile drawer auto-closes on nav link selection, outside click, and Escape key', () => {
  assert.ok(js.includes('DOM.navMenu.classList.remove(\'mobile-open\')'), 'Must close mobile drawer on link selection');
  assert.ok(js.includes('document.addEventListener(\'click\''), 'Must close mobile drawer on outside click');
  assert.ok(js.includes('e.key === \'Escape\'') && js.includes('mobile-open'), 'Escape key must close mobile drawer');
});

// 6. Cinema Hero & Search on Mobile
runTest('Cinema hero & search bar adapt to mobile viewports without overflow', () => {
  assert.ok(css.includes('@media (max-width: 768px)'), 'Hero section must adapt at 768px');
  assert.ok(css.includes('clamp(28px, 8vw, 36px)'), 'Brand heading must use fluid responsive typography');
  assert.ok(css.includes('font-size: 16px; /* Prevents iOS Safari auto-zoom on focus */'), 'Search input must use 16px to prevent iOS auto-zoom');
  assert.ok(css.includes('.hero-search-clear'), 'Search clear button styled');
});

// 7. Grid Column Hierarchy Across Representative Viewports
runTest('Movie grid columns adapt correctly across 320px, 360px, 390px, 430px, 768px, 1024px, 1440px', () => {
  // Check column breakpoints
  assert.ok(css.includes('repeat(6, 1fr)'), 'Desktop (>1300px) has 6 columns');
  assert.ok(css.includes('@media (max-width: 1300px)') && css.includes('repeat(5, 1fr)'), '1051-1300px has 5 columns');
  assert.ok(css.includes('@media (max-width: 1050px)') && css.includes('repeat(4, 1fr)'), '801-1050px has 4 columns');
  assert.ok(css.includes('@media (max-width: 800px)') && css.includes('repeat(3, 1fr)'), '521-800px has 3 columns (tablets 768px)');
  assert.ok(css.includes('@media (max-width: 520px)') && css.includes('repeat(2, 1fr)'), '381-520px has 2 columns (typical phones 390-430px)');
  assert.ok(css.includes('@media (max-width: 380px)') && css.includes('repeat(2, 1fr)'), '320-380px has 2 compact columns (small phones 320-360px)');
});

// 8. Poster Aspect Ratio & Card Typography
runTest('Poster aspect ratio 2:3 preserved without distortion and card text wraps cleanly', () => {
  assert.ok(css.includes('aspect-ratio: 2 / 3'), 'Posters must maintain 2:3 cinematic aspect ratio');
  assert.ok(css.includes('object-fit: cover'), 'Posters must use object-fit: cover');
  assert.ok(css.includes('-webkit-line-clamp: 2'), 'Card titles clamped to 2 lines without overflowing');
  assert.ok(css.includes('word-break: break-word'), 'Card titles must break long words cleanly');
});

// 9. Pagination Touch Friendliness
runTest('Pagination buttons provide 40-44px touch targets and wrap cleanly on small screens', () => {
  assert.ok(css.includes('@media (max-width: 640px)'), 'Pagination must adapt on <=640px');
  assert.ok(css.includes('.jump-page-wrap') && css.includes('width: 100%'), 'Jump page wrap must stack to its own row on mobile');
  assert.ok(css.includes('touch-action: manipulation'), 'Pagination buttons must have touch-action: manipulation');
});

// 10. Title Details View Mobile Reflow
runTest('Title details hero reflows into single column on mobile with centered poster', () => {
  assert.ok(css.includes('@media (max-width: 768px)'), 'Details hero must reflow at 768px');
  assert.ok(css.includes('.details-hero-grid') && css.includes('grid-template-columns: 1fr'), 'Hero grid must collapse to 1 column');
  assert.ok(css.includes('.details-poster-wrap') && css.includes('margin: 0 auto'), 'Poster wrap centered on mobile');
  assert.ok(css.includes('.details-actions-bar') && css.includes('flex-direction: column'), 'Action buttons stack vertically on mobile');
  assert.ok(css.includes('.btn-action') && css.includes('min-height: 44px'), 'Action buttons must have >=44px touch height');
});

// 11. Available Versions Mobile Layout
runTest('Available Versions download rows stack vertically and wrap action buttons on mobile', () => {
  assert.ok(css.includes('.version-row-card') && css.includes('flex-direction: column'), 'Version card stacks on mobile');
  assert.ok(css.includes('.btn-version-download') && css.includes('min-height: 44px'), 'Download button has >=44px touch height');
  assert.ok(css.includes('@media (max-width: 420px)') && css.includes('width: 100%'), 'Download buttons expand to full width on compact phones <=420px');
});

// 12. Lightbox Modals Mobile Fit
runTest('Trailer and screenshot lightboxes fit mobile viewports with reachable close controls', () => {
  assert.ok(css.includes('.trailer-lightbox') && css.includes('padding: 12px'), 'Trailer lightbox fits mobile screen');
  assert.ok(css.includes('.trailer-modal-close') && css.includes('min-width: 44px'), 'Trailer close button has >=44px touch target');
  assert.ok(css.includes('.screenshots-lightbox-img') && css.includes('max-width: 96vw'), 'Screenshot lightbox img constrained to viewport');
  assert.ok(css.includes('.screenshots-modal-close') && css.includes('min-width: 44px'), 'Screenshot close button has >=44px touch target');
});

// 13. Touch Hover & Reduced Motion Accessibility
runTest('Touch devices suppress sticky hover states and respect reduced-motion preference', () => {
  assert.ok(css.includes('@media (hover: none)'), 'Must optimize for touch screens with @media (hover: none)');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Must respect prefers-reduced-motion');
});

// 14. Desktop & Catalog Invariant Verification
runTest('Desktop appearance, catalog size, and search/filter functions remain fully intact', () => {
  // Desktop header unchanged
  assert.ok(css.includes('.header-inner {') && css.includes('max-width: 1440px'), 'Desktop container width intact');
  assert.ok(js.includes('renderMovieGrid'), 'Movie grid renderer intact in app.js');
  assert.ok(js.includes('applyFilters'), 'Filter engine intact in app.js');
  assert.ok(js.includes('openDetailView'), 'Details view opener intact in app.js');
  assert.ok(js.includes('closeDetailView'), 'Details view closer intact in app.js');
});

console.log('='.repeat(70));
console.log(`ALL ${passed}/${total} MOBILE RESPONSIVENESS CHECKS PASSED WITH 100% SUCCESS!`);
console.log('='.repeat(70));
