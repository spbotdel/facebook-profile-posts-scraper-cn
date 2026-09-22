import assert from 'node:assert/strict';
import test from 'node:test';

import {
    extractEndCursor,
    extractHasNextPage,
    extractPosts,
    parseSinceDate,
    splitAtBoundary,
} from '../src/postParser.js';

function profilePostNode(overrides = {}) {
    return {
        comet_sections: {
            content: {
                story: {
                    post_id: '90001',
                    wwwURL: 'https://www.facebook.com/alice/posts/90001/',
                    actors: [{ id: '101', name: 'Alice', url: 'https://www.facebook.com/alice' }],
                    comet_sections: {
                        message: { story: { message: { text: 'Fresh public profile post' } } },
                    },
                },
            },
            context_layout: {
                story: {
                    creation_time: 1_750_000_000,
                    comet_sections: {
                        actor_photo: {
                            story: { actors: [{ id: '101', name: 'Alice', url: 'https://www.facebook.com/alice' }] },
                        },
                    },
                },
            },
            attachment: {
                story: {
                    attachments: [{ media: { __typename: 'Photo', id: 'photo-1', image: { uri: 'https://scontent.xx.fbcdn.net/photo.jpg' } } }],
                },
            },
            ...overrides,
        },
    };
}

test('extractPosts normalizes profile post text, author, timestamp, and photos', () => {
    const posts = extractPosts([{ data: { user: { timeline_list_feed_units: { edges: [{ node: profilePostNode() }] } } } }]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].post_id, '90001');
    assert.equal(posts[0].text, 'Fresh public profile post');
    assert.equal(posts[0].author.id, '101');
    assert.equal(posts[0].created_at, new Date(1_750_000_000_000).toISOString());
    assert.equal(posts[0].media.imageUrls.length, 1);
});

test('extractPosts retains Facebook declared album count for completeness checks', () => {
    const node = profilePostNode({
        attachment: {
            story: {
                attachments: [{
                    styles: {
                        attachment: {
                            mediaset_token: 'pcb.90001',
                            all_subattachments: { count: 13, nodes: [] },
                        },
                    },
                }],
            },
        },
    });
    const posts = extractPosts([{ data: { user: { timeline_list_feed_units: { edges: [{ node }] } } } }]);
    assert.equal(posts[0].media.declaredCount, 13);
    assert.deepEqual(posts[0].media.mediaSetTokens, ['pcb.90001']);
});

test('extractPosts does not emit a nested shared story as another timeline post', () => {
    const outer = profilePostNode({
        attachment: {
            story: {
                creation_time: 1_450_000_000,
                post_id: 'old-shared-post',
                wwwURL: 'https://www.facebook.com/alice/posts/old-shared-post/',
                comet_sections: {
                    message: { story: { message: { text: 'Text from an old shared memory' } } },
                },
            },
        },
    });
    const posts = extractPosts([{ data: { user: { timeline_list_feed_units: { edges: [{ node: outer }] } } } }]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].post_id, '90001');
    assert.equal(posts[0].text, 'Fresh public profile post');
});

test('extractPosts keeps nested shared text as fallback on the outer timeline row', () => {
    const outer = profilePostNode({
        content: {
            story: {
                post_id: '90002',
                wwwURL: 'https://www.facebook.com/alice/posts/90002/',
                actors: [{ id: '101', name: 'Alice', url: 'https://www.facebook.com/alice' }],
                comet_sections: {},
                attached_story: {
                    comet_sections: {
                        message: { story: { message: { text: 'Only the attached story has text' } } },
                    },
                },
            },
        },
    });
    const posts = extractPosts([{ data: { user: { timeline_list_feed_units: { edges: [{ node: outer }] } } } }]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].post_id, '90002');
    assert.equal(posts[0].text, 'Only the attached story has text');
    assert.equal(posts[0].text_source, 'fallback_nested_message');
});

test('extractPosts skips unavailable Facebook timeline cards by default', () => {
    const unavailable = profilePostNode({
        content: {
            story: {
                post_id: 'unavailable-1',
                wwwURL: 'https://www.facebook.com/alice/posts/unavailable-1/',
                attachments: [{
                    styles: {
                        attachment: {
                            title_with_entities: { text: "This content isn't available right now" },
                            description: {
                                text: "When this happens, it's usually because the owner only shared it with a small group of people, changed who can see it or it's been deleted.",
                            },
                        },
                    },
                }],
            },
        },
    });
    const skipped = new Set();
    const posts = extractPosts([unavailable], 10, { unavailablePostKeys: skipped });
    assert.equal(posts.length, 0);
    assert.equal(skipped.size, 1);
});

test('extractPosts can include unavailable timeline cards for audits', () => {
    const unavailable = profilePostNode({
        content: {
            story: {
                post_id: 'unavailable-2',
                wwwURL: 'https://www.facebook.com/alice/posts/unavailable-2/',
                attachments: [{
                    styles: {
                        attachment: {
                            title_with_entities: { text: "This content isn't available right now" },
                        },
                    },
                }],
            },
        },
    });
    const posts = extractPosts([unavailable], 10, { includeUnavailablePosts: true });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].text_missing_reason, 'content_unavailable');
});

test('timeline cursor wins over nested comment cursor', () => {
    const payload = {
        data: {
            user: {
                timeline_list_feed_units: {
                    page_info: { end_cursor: 'TIMELINE_CURSOR', has_next_page: true },
                    edges: [{ node: { feedback: { comments: { page_info: { end_cursor: 'COMMENT_CURSOR', has_next_page: false } } } } }],
                },
            },
        },
    };
    assert.equal(extractEndCursor([payload]), 'TIMELINE_CURSOR');
    assert.equal(extractHasNextPage([payload]), true);
});

test('route labels from profile HTML are not accepted as timeline cursors', () => {
    const payload = {
        data: {
            user: {
                timeline_list_feed_units: {
                    page_info: { end_cursor: 'photos', has_next_page: false },
                },
            },
        },
    };
    assert.equal(extractEndCursor([payload]), null);
    assert.equal(extractHasNextPage([payload]), false);
});

test('unrelated Relay cursors are ignored even when they look substantial', () => {
    const payload = {
        data: {
            user: {
                photos: {
                    page_info: { end_cursor: 'AQHR_UNRELATED_PHOTO_CURSOR_12345', has_next_page: true },
                },
            },
        },
    };
    assert.equal(extractEndCursor([payload]), null);
    assert.equal(extractHasNextPage([payload]), null);
});

test('splitAtBoundary stops before known or old posts', () => {
    const posts = [
        { post_id: 'new', created_at: '2026-07-10T10:00:00.000Z' },
        { post_id: 'known', created_at: '2026-07-09T10:00:00.000Z' },
        { post_id: 'old', created_at: '2026-07-01T10:00:00.000Z' },
    ];
    const known = splitAtBoundary(posts, { knownPostIds: ['known'], sinceDate: null });
    assert.deepEqual(known.posts.map((post) => post.post_id), ['new']);
    assert.equal(known.hit.type, 'known_post_id');

    const dated = splitAtBoundary(posts, { knownPostIds: [], sinceDate: parseSinceDate('2026-07-05') });
    assert.deepEqual(dated.posts.map((post) => post.post_id), ['new', 'known']);
    assert.equal(dated.hit.type, 'older_than_since_date');
});

test('video_urls contains media URLs rather than XML manifests or JPG thumbnails', () => {
    const node = profilePostNode({
        video_attachment: {
            dash_manifest: '<MPD><BaseURL>https://video-iad3-1.xx.fbcdn.net/movie.mp4?token=one&amp;x=2</BaseURL></MPD>',
            thumbnail: 'https://scontent-iad3-1.xx.fbcdn.net/thumb.jpg?token=two',
            playable_url: 'https://video-iad3-2.xx.fbcdn.net/direct.mp4?token=three',
        },
    });
    const [post] = extractPosts([{ data: { user: { timeline_list_feed_units: { edges: [{ node }] } } } }]);
    assert.equal(post.media.videoUrls.length, 2);
    assert.ok(post.media.videoUrls.every((url) => url.startsWith('https://') && url.includes('.mp4')));
    assert.ok(post.media.imageUrls.some((url) => url.includes('thumb.jpg')));
});
