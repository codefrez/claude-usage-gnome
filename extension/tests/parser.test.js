import test from 'node:test';
import assert from 'node:assert/strict';

import {parseUsage} from '../parser.js';

test('lê five_hour e seven_day', () => {
    const r = parseUsage({
        five_hour: {utilization: 42, resets_at: '2026-10-18T18:00:00Z'},
        seven_day: {utilization: 18.5, resets_at: '2026-10-21T00:00:00Z'},
    });
    assert.equal(r.fiveHour.utilization, 42);
    assert.equal(r.fiveHour.resetsAt.toISOString(), '2026-10-18T18:00:00.000Z');
    assert.equal(r.sevenDay.utilization, 18.5);
    assert.deepEqual(r.scoped, []);
});

test('clampa utilization entre 0 e 100', () => {
    const r = parseUsage({five_hour: {utilization: 130}, seven_day: {utilization: -5}});
    assert.equal(r.fiveHour.utilization, 100);
    assert.equal(r.sevenDay.utilization, 0);
});

test('janela sem utilization numérica é ignorada', () => {
    const r = parseUsage({five_hour: {utilization: '42'}, seven_day: {utilization: 10}});
    assert.equal(r.fiveHour, null);
    assert.equal(r.sevenDay.utilization, 10);
});

test('resets_at inválido ou ausente vira null', () => {
    const r = parseUsage({five_hour: {utilization: 1, resets_at: 'lixo'}, seven_day: {utilization: 2}});
    assert.equal(r.fiveHour.resetsAt, null);
    assert.equal(r.sevenDay.resetsAt, null);
});

test('seven_day_opus e seven_day_sonnet entram em scoped', () => {
    const r = parseUsage({
        seven_day: {utilization: 18},
        seven_day_opus: {utilization: 9, resets_at: '2026-10-21T00:00:00Z'},
        seven_day_sonnet: {utilization: 4},
    });
    assert.deepEqual(r.scoped.map(s => [s.name, s.utilization]), [['Opus', 9], ['Sonnet', 4]]);
});

test('limits weekly_scoped entram em scoped', () => {
    const r = parseUsage({
        seven_day: {utilization: 18},
        limits: [{kind: 'weekly_scoped', percent: 33, scope: {model: {display_name: 'Haiku'}}}],
    });
    assert.deepEqual(r.scoped.map(s => [s.name, s.utilization]), [['Haiku', 33]]);
});

test('limits com modelo já presente em seven_day_* não duplica', () => {
    const r = parseUsage({
        seven_day_opus: {utilization: 9},
        limits: [
            {kind: 'weekly_scoped', percent: 9, scope: {model: {display_name: 'Claude Opus 4'}}},
            {kind: 'weekly_scoped', percent: 5, scope: {model: {display_name: 'Haiku'}}},
        ],
    });
    assert.deepEqual(r.scoped.map(s => s.name), ['Opus', 'Haiku']);
});

test('limits malformados são ignorados', () => {
    const r = parseUsage({
        seven_day: {utilization: 1},
        limits: [null, 5, {kind: 'other', percent: 1}, {kind: 'weekly_scoped', percent: 'x', scope: {}}, {kind: 'weekly_scoped', percent: 3}],
    });
    assert.deepEqual(r.scoped, []);
});

test('limits que não é array (plano sem limites por modelo)', () => {
    assert.deepEqual(parseUsage({seven_day: {utilization: 1}, limits: null}).scoped, []);
    assert.deepEqual(parseUsage({seven_day: {utilization: 1}, limits: []}).scoped, []);
});

test('sem nenhuma janela reconhecida devolve null', () => {
    assert.equal(parseUsage({}), null);
    assert.equal(parseUsage(null), null);
    assert.equal(parseUsage('texto'), null);
    assert.equal(parseUsage([]), null);
    assert.equal(parseUsage({five_hour: null, limits: []}), null);
});
