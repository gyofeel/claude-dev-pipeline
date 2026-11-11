import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRuntime, runtimeErrors } from '../../kit/utils/runtime-filter.mjs';

test('filterRuntime drops whitelisted console errors by text or url and counts them', () => {
    const { runtimeData, whitelistedErrors, whitelistedNetworkErrors } = filterRuntime(
        {
            consoleErrors: [{ text: 'known noise' }, { text: 'Failed to load resource', url: 'https://px.example/a' }, { text: 'real' }],
            networkErrors: [{ url: 'https://px.example/a', status: 400 }, { url: 'http://app/api', status: 500 }]
        },
        ['known'],
        ['px.example']
    );
    assert.deepEqual(runtimeData.consoleErrors.map((e) => e.text), ['real']);
    assert.equal(whitelistedErrors.filteredCount, 2);
    assert.deepEqual(runtimeData.networkErrors.map((e) => e.status), [500]);
    assert.equal(whitelistedNetworkErrors.filteredCount, 1);
});

test('runtimeErrors applies the same whitelists to a live collector and ignores non-error console entries', () => {
    const collector = {
        consoleEntries: [
            { type: 'error', text: 'known noise' },
            { type: 'error', text: 'Failed to load resource', url: 'https://px.example/a' },
            { type: 'error', text: 'real' },
            { type: 'warning', text: 'warn' }
        ],
        networkErrors: [{ url: 'https://px.example/a', status: 400 }, { url: 'http://app/api', status: 500 }]
    };
    const out = runtimeErrors(collector, { consoleErrorWhitelist: ['known'], networkErrorWhitelist: ['px.example'] });
    assert.deepEqual(out.consoleErrors.map((e) => e.text), ['real']);
    assert.deepEqual(out.networkErrors.map((e) => e.status), [500]);
    assert.deepEqual(runtimeErrors(collector).consoleErrors.length, 3);
});
