import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFrames, parseTraceLines, extractCpFrames } from '../../kit/report/trace-frames.mjs';

const STEP_LINES = [
    '{"type":"before","callId":"test.step@1","method":"test.step","title":"cp-01: 노출","startTime":100}',
    '{"type":"before","callId":"pw:api@2","method":"pw:api","title":"Wait for function","startTime":120}',
    '{"type":"after","callId":"pw:api@2","endTime":150}',
    '{"type":"after","callId":"test.step@1","endTime":200}',
    '{"type":"before","callId":"test.step@3","method":"test.step","title":"setup: 진입","startTime":50}',
    '{"type":"after","callId":"test.step@3","endTime":90}'
].join('\n');

const FRAMES = [
    { type: 'screencast-frame', file: 'screencast/p-a.jpeg', timestamp: 150 },
    { type: 'screencast-frame', file: 'screencast/p-b.jpeg', timestamp: 199 },
    { type: 'screencast-frame', file: 'screencast/p-c.jpeg', timestamp: 250 }
];

test('cp step 종료 직전의 마지막 프레임을 고르고 cp 가 아닌 step 은 건너뛴다', () => {
    const picked = pickFrames(parseTraceLines(STEP_LINES), FRAMES);
    assert.equal(picked.get('cp-01'), 'screencast/p-b.jpeg');
    assert.equal(picked.has('setup'), false);
    assert.equal(picked.size, 1);
});

test('extractCpFrames: zip 항목을 읽어 data URI 로 만든다', () => {
    const entries = {
        'test.trace': STEP_LINES,
        '1-trace.trace': FRAMES.map((f) => JSON.stringify(f)).join('\n'),
        'screencast/p-b.jpeg': Buffer.from('JPEG')
    };
    const zip = {
        list: () => Object.keys(entries),
        read: (entry) => Buffer.from(entries[entry])
    };
    const out = extractCpFrames('/x/trace.zip', zip);
    assert.equal(
        out.get('cp-01'),
        `data:image/jpeg;base64,${Buffer.from('JPEG').toString('base64')}`
    );
});

test('extractCpFrames: 읽기 실패면 빈 Map', () => {
    const zip = {
        list: () => {
            throw new Error('no zip');
        },
        read: () => Buffer.alloc(0)
    };
    assert.equal(extractCpFrames('/x/none.zip', zip).size, 0);
});
