import test from 'node:test';
import assert from 'node:assert/strict';

import {formatClock, formatPercent, formatRemaining, levelFor} from '../format.js';

const now = new Date('2026-10-18T12:00:00Z');
const at = ms => new Date(now.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('formatRemaining em minutos, horas e dias', () => {
    assert.equal(formatRemaining(at(40 * MIN), now), '40m');
    assert.equal(formatRemaining(at(30_000), now), '1m');
    assert.equal(formatRemaining(at(2 * HOUR), now), '2h');
    assert.equal(formatRemaining(at(2 * HOUR + 10 * MIN), now), '2h 10m');
    assert.equal(formatRemaining(at(3 * DAY + 5 * HOUR), now), '3d');
});

test('formatRemaining com passado ou data desconhecida', () => {
    assert.equal(formatRemaining(at(-MIN), now), '0m');
    assert.equal(formatRemaining(null, now), '');
});

test('formatClock usa hora local com zero à esquerda', () => {
    assert.equal(formatClock(new Date(2026, 9, 18, 3, 0)), '03:00');
    assert.equal(formatClock(new Date(2026, 9, 18, 14, 5)), '14:05');
    assert.equal(formatClock(null), '');
});

test('formatPercent usado e restante', () => {
    assert.equal(formatPercent(42.4), '42%');
    assert.equal(formatPercent(42.6), '43%');
    assert.equal(formatPercent(42, 'remaining'), '58%');
    assert.equal(formatPercent(150, 'used'), '100%');
});

test('levelFor limiares 70 e 90', () => {
    assert.equal(levelFor(70), 'normal');
    assert.equal(levelFor(70.1), 'warn');
    assert.equal(levelFor(90), 'warn');
    assert.equal(levelFor(91), 'critical');
});
