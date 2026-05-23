// scripts/reports/catalog.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, matchSeriesName } from './catalog.js';

test('catalog has the expected ~12 entries with required fields', () => {
  assert.ok(CATALOG.length >= 12);
  for (const s of CATALOG) {
    assert.ok(s.key && s.displayName && s.category, `entry missing fields: ${JSON.stringify(s)}`);
    assert.ok(Array.isArray(s.classes) && s.classes.length >= 1);
    assert.ok(Array.isArray(s.match) && s.match.length >= 1);
  }
});

test('multiclass series declare multiple classes', () => {
  const imsaOpen = CATALOG.find(s => s.key === 'imsa-open');
  assert.deepEqual([...imsaOpen.classes].sort(), ['GT3','GTP','LMP2']);
  const scc = CATALOG.find(s => s.key === 'sports-car-challenge');
  assert.deepEqual([...scc.classes].sort(), ['GT4','LMP3']);
});

test('matchSeriesName maps real iRacing names to a catalog entry', () => {
  assert.equal(matchSeriesName('GT3 Regional Tour - Europe').key, 'gt3-regional-europe');
  assert.equal(matchSeriesName('iRacing Porsche Cup - Fixed by CONSPIT').key, 'porsche-cup-fixed');
  assert.equal(matchSeriesName('iRacing Porsche Cup by CONSPIT').key, 'porsche-cup');
  assert.equal(matchSeriesName('Sports Car Challenge by Falken Tyre').key, 'sports-car-challenge');
  assert.equal(matchSeriesName('IMSA iRacing Series - Fixed').key, 'imsa-fixed');
  assert.equal(matchSeriesName('IMSA iRacing Series').key, 'imsa-open');
  assert.equal(matchSeriesName('Totally Unknown Oval Series'), null);
});
