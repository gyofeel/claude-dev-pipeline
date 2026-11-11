import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheckpoint } from '../../kit/utils/checkpoint.mjs';
import { labels } from '../../kit/report/labels.mjs';

const fakeStep = () => {
    const titles = [];
    const step = async (title, body) => {
        titles.push(title);
        return body();
    };
    return { step, titles };
};

test('passing sets the flag and keeps the return value as actual', async () => {
    const { step, titles } = fakeStep();
    const c = { id: 'cp-01', desc: 'toast shown', passed: false };
    const r = await runCheckpoint(step, c, 'cp-01', async () => 'profile changed');
    assert.equal(r, 'profile changed');
    assert.deepEqual(titles, ['cp-01: toast shown']);
    assert.equal(c.passed, true);
    assert.equal(c.actual, 'profile changed');
});

test('failing leaves the flag unset and rethrows', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-01', desc: 'd', passed: false };
    await assert.rejects(
        runCheckpoint(step, c, 'cp-01', async () => {
            throw new Error('expect failed');
        }),
        /expect failed/
    );
    assert.equal(c.passed, false);
});

test('soft does not throw and records the reason', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-04', desc: 'playback starts', passed: false };
    const logs = [];
    await runCheckpoint(
        step,
        c,
        'cp-04',
        async () => {
            throw new Error('no playStatus\nstack');
        },
        { soft: true, log: (m) => logs.push(m) }
    );
    assert.equal(c.passed, false);
    assert.equal(c.soft, true);
    assert.equal(c.softReason, 'no playStatus');
    assert.equal(logs[0], labels('en').softLog('cp-04: playback starts', 'no playStatus'));
    assert.match(logs[0], /\(recheck on device\)/);
});

test('soft log uses the configured locale', async () => {
    const { step } = fakeStep();
    const logs = [];
    await runCheckpoint(step, null, 'cp-09', async () => { throw new Error('x'); }, { soft: true, log: (m) => logs.push(m), locale: 'ko' });
    assert.match(logs[0], /실기기 재검증 필요/);
});

test('an undeclared cp id still runs the step', async () => {
    const { step, titles } = fakeStep();
    await runCheckpoint(step, null, 'cp-09', async () => undefined);
    assert.deepEqual(titles, ['cp-09']);
});

test('actual is stringified and capped at 200 chars', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-01', desc: 'd', passed: false };
    await runCheckpoint(step, c, 'cp-01', async () => ({ text: 'x'.repeat(300) }));
    assert.equal(c.actual.length, 200);
});

test('soft reason has terminal colour codes stripped', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-02', desc: 'd', passed: false };
    await runCheckpoint(
        step,
        c,
        'cp-02',
        async () => {
            throw new Error('\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m)');
        },
        { soft: true, log: () => {} }
    );
    assert.equal(c.softReason, 'expect(received)');
});

test('a failed assertion keeps the last value passed to seen as actual', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-03', desc: 'menu landing', passed: false };
    await assert.rejects(
        runCheckpoint(step, c, 'cp-03', async (seen) => {
            seen('/jump/home/1');
            throw new Error('expect failed');
        })
    );
    assert.equal(c.passed, false);
    assert.equal(c.actual, '/jump/home/1');
});

test('seen(5) then a failed assertion leaves actual "5"', async () => {
    const { step } = fakeStep();
    const c = { id: 'cp-05', desc: 'd', passed: false };
    await assert.rejects(runCheckpoint(step, c, 'cp-05', async (seen) => { seen(5); throw new Error('no'); }));
    assert.equal(c.actual, '5');
});

test('actual falls back to String() for values JSON.stringify cannot take', async () => {
    const circular = { a: 1 };
    circular.self = circular;
    for (const [value, expected] of [[circular, '[object Object]'], [10n, '10'], [() => 1, '() => 1'], [Symbol('s'), 'Symbol(s)']]) {
        const { step } = fakeStep();
        const c = { id: 'cp-01', desc: 'd', passed: false };
        await runCheckpoint(step, c, 'cp-01', async () => value);
        assert.equal(c.passed, true);
        assert.equal(c.actual, expected);
    }
});
