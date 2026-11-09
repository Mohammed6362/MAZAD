/**
 * اختبار استعادة المظهر قبل الرسم ومتابعة الجهاز ومزامنة التبويبات والعمل دون تخزين محلي.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const frontend = path.resolve(__dirname, '../../frontend');
const boot = fs.readFileSync(path.join(frontend, 'public/theme-init.js'), 'utf8');

function browser(saved, dark = false, blocked = false) {
  const storage = new Map(saved == null ? [] : [['mazad-theme', saved]]);
  const media = Object.assign(new EventTarget(), { matches: dark });
  const localStorage = {
    getItem(key) {
      if (blocked) throw new Error('Storage disabled');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error('Storage disabled');
      storage.set(key, value);
    },
  };
  const window = Object.assign(new EventTarget(), { matchMedia: () => media, localStorage });
  const meta = {
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  const document = {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => meta,
  };
  vm.runInNewContext(boot, { window, document, localStorage });
  return { window, document, media, meta, storage };
}

test('appearance boot restores legacy preferences before rendering, including blocked storage', () => {
  for (const [saved, systemDark, expected] of [
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    ['system', true, 'dark'],
    [null, false, 'light'],
    ['invalid', true, 'dark'],
  ]) {
    const { document, meta } = browser(saved, systemDark);
    assert.equal(document.documentElement.dataset.colorScheme, expected);
    assert.equal(document.documentElement.style.colorScheme, expected);
    assert.equal(meta.content, expected === 'dark' ? '#101b17' : '#f5f6f2');
  }
  assert.equal(browser('light', true, true).document.documentElement.dataset.theme, 'system');
});

test('appearance follows device changes only in system mode and synchronizes tabs', async () => {
  const { createThemeStore } = await import(
    pathToFileURL(path.join(frontend, 'src/features/theme/theme.js')).href
  );
  const fixture = browser('system');
  const { window, document, media, storage } = fixture;
  const store = createThemeStore(window, document);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(document.documentElement.dataset.colorScheme, 'dark');
  store.setTheme('light');
  assert.equal(storage.get('mazad-theme'), 'light');
  media.dispatchEvent(new Event('change'));
  assert.equal(document.documentElement.dataset.colorScheme, 'light');
  assert.equal(
    browser(storage.get('mazad-theme'), true).document.documentElement.dataset.colorScheme,
    'light',
  );
  window.dispatchEvent(
    Object.assign(new Event('storage'), { key: 'mazad-theme', newValue: 'dark' }),
  );
  assert.equal(store.getSnapshot(), 'dark');
  window.dispatchEvent(Object.assign(new Event('storage'), { key: null, newValue: null }));
  assert.equal(store.getSnapshot(), 'system');
  assert.equal(document.documentElement.dataset.colorScheme, 'dark');
  unsubscribe();
  const before = notifications;
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  assert.equal(notifications, before);
  const blocked = browser(null, false, true);
  const blockedStore = createThemeStore(blocked.window, blocked.document);
  blockedStore.setTheme('dark');
  assert.equal(blocked.document.documentElement.dataset.colorScheme, 'dark');
});
