import assert from 'node:assert/strict';
import test from 'node:test';

import {
    extractDocIdsFromText,
    extractEmbeddedJsonValues,
    fetchText,
    normalizeProfileTarget,
    parseJsonPayload,
    profileFeedUrl,
} from '../src/facebook.js';

test('normalizeProfileTarget supports handles, numeric IDs, and profile.php URLs', () => {
    assert.equal(
        normalizeProfileTarget('@example.profile').url,
        'https://www.facebook.com/example.profile',
    );
    assert.equal(normalizeProfileTarget('123456').hintedId, '123456');
    assert.equal(
        normalizeProfileTarget('https://m.facebook.com/profile.php?id=9988&ref=bookmarks').url,
        'https://www.facebook.com/profile.php?id=9988&ref=bookmarks',
    );
});

test('normalizeProfileTarget rejects non-profile Facebook surfaces', () => {
    assert.throws(() => normalizeProfileTarget('https://www.facebook.com/groups/123/'), /personal profile/i);
    assert.throws(() => normalizeProfileTarget('https://example.com/alice'), /facebook\.com/i);
});

test('profileFeedUrl preserves profile IDs and opens the public posts route', () => {
    assert.equal(
        profileFeedUrl('https://www.facebook.com/Michaelzuh'),
        'https://www.facebook.com/Michaelzuh?sk=posts',
    );
    assert.equal(
        profileFeedUrl('https://www.facebook.com/profile.php?id=9988&ref=bookmarks'),
        'https://www.facebook.com/profile.php?id=9988&ref=bookmarks&sk=posts',
    );
});

test('extractDocIdsFromText finds profile query document IDs', () => {
    const text = [
        'e.exports="25018373637835603";/* ProfileCometTimelineFeedQuery */',
        'ProfileCometTimelineFeedRefetchQuery blah "doc_id":"25873749612229405"',
    ].join('\n');
    const ids = extractDocIdsFromText(text);
    assert.equal(ids.ProfileCometTimelineFeedQuery, '25018373637835603');
    assert.equal(ids.ProfileCometTimelineFeedRefetchQuery, '25873749612229405');
});

test('parseJsonPayload handles Facebook multiline GraphQL responses', () => {
    const parsed = parseJsonPayload('for (;;);{"data":{"one":1}}\n{"label":"defer","data":{"two":2}}');
    assert.equal(parsed.values.length, 2);
    assert.deepEqual(parsed.errors, []);
});

test('fetchText translates a millisecond timeout into got timeout options', async () => {
    let receivedOptions;
    const client = async (_url, options) => {
        receivedOptions = options;
        return { statusCode: 200, url: 'https://www.facebook.com/alice', headers: {}, body: 'ok' };
    };
    await fetchText(client, 'https://www.facebook.com/alice', { timeout: 12345 });
    assert.deepEqual(receivedOptions.timeout, { request: 12345 });
});

test('extractEmbeddedJsonValues reads Facebook prefetched application/json scripts', () => {
    const html = '<script type="application/json">{"require":[["RelayPrefetchedStreamCache",[],[],[{"post":1}]]] }</script>';
    const parsed = extractEmbeddedJsonValues(html);
    assert.equal(parsed.values.length, 1);
    assert.equal(parsed.values[0].require[0][3][0].post, 1);
});
