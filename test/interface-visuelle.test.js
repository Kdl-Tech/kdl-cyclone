import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
]);

test("l'identite publique parle de veille Caraibes", () => {
  assert.match(html, /Veille Caraïbes/);
  assert.doesNotMatch(html, /Veille Antilles/);
  assert.match(js, /Centre de veille Caraïbes/);
});

test('le premier theme suit le systeme sans preference enregistree', () => {
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /matchMedia/);
});
