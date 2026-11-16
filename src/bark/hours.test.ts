import assert from 'node:assert/strict';
import { test } from 'node:test';

import { smallHours } from './hours.ts';

test('the small hours are two to six in the morning, by Pittsburgh time', () => {
  // In winter Pittsburgh is five hours behind Greenwich.
  assert.equal(smallHours(new Date('2026-11-17T06:59:00Z')), false, '1:59 a.m.');
  assert.equal(smallHours(new Date('2026-11-17T07:00:00Z')), true, '2:00 a.m.');
  assert.equal(smallHours(new Date('2026-11-17T08:10:00Z')), true, '3:10 a.m.');
  assert.equal(smallHours(new Date('2026-11-17T10:59:00Z')), true, '5:59 a.m.');
  assert.equal(smallHours(new Date('2026-11-17T11:00:00Z')), false, '6:00 a.m.');
  assert.equal(smallHours(new Date('2026-11-16T20:00:00Z')), false, '3:00 in the afternoon');
});

test('they follow the clocks there when they change, not the visitor’s', () => {
  // In summer it is four hours behind.
  assert.equal(smallHours(new Date('2027-07-01T05:30:00Z')), false, '1:30 a.m. in July');
  assert.equal(smallHours(new Date('2027-07-01T06:30:00Z')), true, '2:30 a.m. in July');
  // The night of the hackathon itself.
  assert.equal(smallHours(new Date('2027-02-06T08:00:00Z')), true, '3:00 a.m. on February 6');
});
