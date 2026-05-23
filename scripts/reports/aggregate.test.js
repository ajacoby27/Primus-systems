// scripts/reports/aggregate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLap, mergeLeaderboard, mergeCarLeaderboard, rankAndTrim, weekId,
} from './aggregate.js';

test('formatLap converts ten-thousandths of a second to m:ss.mmm', () => {
  assert.equal(formatLap(1364210), '2:16.421');
  assert.equal(formatLap(600000), '1:00.000');
  assert.equal(formatLap(64210), '0:06.421');
});

test('formatLap treats 0 / -1 / null as no time', () => {
  assert.equal(formatLap(0), null);
  assert.equal(formatLap(-1), null);
  assert.equal(formatLap(null), null);
  assert.equal(formatLap(undefined), null);
});

const row = (custId, lapMs, extra = {}) =>
  ({ custId, driver: `D${custId}`, irating: 3000, car: 'Ferrari 296 GT3', lapMs, setAt: 1000, ...extra });

test('mergeLeaderboard keeps each driver\'s best and sorts ascending', () => {
  const existing = [row(1, 1365000), row(2, 1366000)];
  const candidates = [row(1, 1364000), row(3, 1363000)];
  const out = mergeLeaderboard(existing, candidates);
  assert.deepEqual(out.map(e => e.custId), [3, 1, 2]);
  assert.equal(out.find(e => e.custId === 1).lapMs, 1364000);
});

test('mergeLeaderboard ignores no-time candidates and respects keepN', () => {
  const candidates = [row(1, 0), row(2, -1), row(3, 1364000), row(4, 1365000)];
  const out = mergeLeaderboard([], candidates, { keepN: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].custId, 3);
});

test('mergeCarLeaderboard keeps best lap per car model', () => {
  const cands = [
    row(1, 1364000, { car: 'Ferrari 296 GT3' }),
    row(2, 1363000, { car: 'Porsche 911 GT3 R' }),
    row(3, 1362000, { car: 'Ferrari 296 GT3' }),
  ];
  const out = mergeCarLeaderboard([], cands);
  assert.equal(out.length, 2);
  assert.equal(out[0].car, 'Ferrari 296 GT3');
  assert.equal(out[0].lapMs, 1362000);
});

test('rankAndTrim adds rank + formatted lap and caps at n', () => {
  const out = rankAndTrim([row(3, 1363000), row(1, 1364000)], 10);
  assert.equal(out[0].rank, 1);
  assert.equal(out[0].lap, '2:16.300');
  assert.equal(out.length, 2);
});

test('weekId is stable from season identifiers', () => {
  assert.equal(weekId(2026, 2, 7), '2026-2-7');
});
