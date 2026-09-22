import assert from 'node:assert/strict';
import test from 'node:test';

import {
    proxyCountryCandidates,
    shouldRetryProfileInAnotherCountry,
} from '../src/profileRetry.js';

test('proxyCountryCandidates normalizes, deduplicates, and bounds countries', () => {
    assert.deepEqual(proxyCountryCandidates('us', ['DE', 'us', 'GB', 'NL'], 3), ['US', 'DE', 'GB']);
    assert.deepEqual(proxyCountryCandidates('invalid', ['de']), ['DE']);
});

test('shouldRetryProfileInAnotherCountry only selects transient profile failures', () => {
    assert.equal(shouldRetryProfileInAnotherCountry({ code: 'rate_limited', retryable: true }), true);
    assert.equal(shouldRetryProfileInAnotherCountry({ code: 'profile_not_found', retryable: true }), true);
    assert.equal(shouldRetryProfileInAnotherCountry({ code: 'login_wall', retryable: false }), false);
    assert.equal(shouldRetryProfileInAnotherCountry({ code: 'rate_limited', retryable: false }), false);
});
