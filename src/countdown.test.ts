import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describe, pad, remaining } from './countdown.ts';

const DROP = Date.parse('2026-12-01T00:00:00-05:00');

test('the drop is midnight Eastern on December 1, 2026', () => {
  assert.equal(new Date(DROP).toISOString(), '2026-12-01T05:00:00.000Z');
});

test('splits the time left into days, hours, minutes and seconds', () => {
  const now = DROP - (17 * 86_400_000 + 4 * 3_600_000 + 22 * 60_000 + 51 * 1000);
  assert.deepEqual(remaining(DROP, now), {
    days: 17,
    hours: 4,
    minutes: 22,
    seconds: 51,
    done: false,
  });
});

test('rounds a partial second up, so one second left reads 1 until the end', () => {
  assert.equal(remaining(DROP, DROP - 1).seconds, 1);
  assert.equal(remaining(DROP, DROP - 1000).seconds, 1);
  assert.equal(remaining(DROP, DROP - 1001).seconds, 2);
});

test('rolls a full minute over instead of showing 60 seconds', () => {
  const r = remaining(DROP, DROP - 59_500);
  assert.equal(r.minutes, 1);
  assert.equal(r.seconds, 0);
});

test('stops at zero once the moment has passed', () => {
  for (const now of [DROP, DROP + 1, DROP + 86_400_000]) {
    assert.deepEqual(remaining(DROP, now), {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
  }
});

test('pads to two digits and keeps longer day counts whole', () => {
  assert.equal(pad(0), '00');
  assert.equal(pad(7), '07');
  assert.equal(pad(42), '42');
  assert.equal(pad(123), '123');
});

test('describes the wait in words, with correct singulars', () => {
  assert.equal(
    describe({ days: 1, hours: 1, minutes: 0, seconds: 0, done: false }),
    '1 day and 1 hour until the theme and registration drop.',
  );
  assert.equal(
    describe({ days: 17, hours: 4, minutes: 0, seconds: 0, done: false }),
    '17 days and 4 hours until the theme and registration drop.',
  );
  assert.equal(
    describe({ days: 0, hours: 0, minutes: 0, seconds: 0, done: true }),
    'The theme and registration have dropped.',
  );
});
