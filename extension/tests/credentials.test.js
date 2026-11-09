import test from 'node:test';
import assert from 'node:assert/strict';

import {evaluateCredentials, parseRetryAfter, planLabel} from '../credentials.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const creds = oauth => ({claudeAiOauth: {accessToken: 'tok-fake', ...oauth}});

test('credenciais válidas', () => {
    const r = evaluateCredentials(creds({
        expiresAt: NOW + 3_600_000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x',
    }), NOW);
    assert.deepEqual(r, {
        status: 'ok', accessToken: 'tok-fake', subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x',
    });
});

test('sem claudeAiOauth ou sem token é não logado', () => {
    assert.equal(evaluateCredentials(null, NOW).status, 'not-logged-in');
    assert.equal(evaluateCredentials({}, NOW).status, 'not-logged-in');
    assert.equal(evaluateCredentials({claudeAiOauth: null}, NOW).status, 'not-logged-in');
    assert.equal(evaluateCredentials(creds({accessToken: ''}), NOW).status, 'not-logged-in');
    assert.equal(evaluateCredentials(creds({accessToken: 5}), NOW).status, 'not-logged-in');
});

test('expirado, inclusive dentro da margem de 30 s', () => {
    assert.equal(evaluateCredentials(creds({expiresAt: NOW - 1}), NOW).status, 'expired');
    assert.equal(evaluateCredentials(creds({expiresAt: NOW + 29_000}), NOW).status, 'expired');
    assert.equal(evaluateCredentials(creds({expiresAt: NOW + 31_000}), NOW).status, 'ok');
});

test('expiresAt em segundos é reconhecido', () => {
    assert.equal(evaluateCredentials(creds({expiresAt: NOW / 1000 - 10}), NOW).status, 'expired');
    assert.equal(evaluateCredentials(creds({expiresAt: NOW / 1000 + 3600}), NOW).status, 'ok');
});

test('expiresAt ausente não bloqueia', () => {
    assert.equal(evaluateCredentials(creds({}), NOW).status, 'ok');
});

test('planLabel', () => {
    assert.equal(planLabel('max', 'default_claude_max_20x'), 'Max 20x');
    assert.equal(planLabel('max', 'default_claude_max_5x'), 'Max 5x');
    assert.equal(planLabel('pro', 'default_claude_pro'), 'Pro');
    assert.equal(planLabel('max', null), 'Max');
    assert.equal(planLabel(null, null), '');
});

test('parseRetryAfter', () => {
    assert.equal(parseRetryAfter('120', NOW), 120);
    assert.equal(parseRetryAfter(' 0 ', NOW), 0);
    assert.equal(parseRetryAfter('Sun, 18 Oct 2026 12:01:30 GMT', NOW), 90);
    assert.equal(parseRetryAfter('Sun, 18 Oct 2026 11:00:00 GMT', NOW), 0);
    assert.equal(parseRetryAfter('lixo', NOW), null);
    assert.equal(parseRetryAfter(null, NOW), null);
    assert.equal(parseRetryAfter('', NOW), null);
});
