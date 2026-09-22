import { normalizeHtml } from './htmlMedia.js';
import { unique } from './facebook.js';

function getPath(obj, path) {
    let current = obj;
    for (const part of path) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

function firstDeepValue(value, keys, depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 16 || seen.has(value)) return null;
    seen.add(value);
    for (const key of keys) {
        const direct = value[key];
        if (direct !== undefined && direct !== null && direct !== '') return direct;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        const result = firstDeepValue(child, keys, depth + 1, seen);
        if (result !== null) return result;
    }
    return null;
}

function cleanText(value) {
    if (typeof value !== 'string') return null;
    return normalizeHtml(value).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function isUiText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) return true;
    return [
        'like', 'comment', 'share', 'send', 'see translation', 'write a comment',
        'most relevant', 'view more comments', 'public figure',
    ].some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function isUnavailableAttachmentText(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return normalized === "this content isn't available right now"
        || normalized.startsWith("when this happens, it's usually because the owner only shared it");
}

function isAttachmentTitlePath(path) {
    const lower = String(path || '').toLowerCase();
    return /attachments\.\d+\.(?:styles|style_type_renderer)\.title$/.test(lower)
        || /attachments\.\d+\..*attachment\.title_with_entities\.text$/.test(lower);
}

function collectTextSignals(obj) {
    const signals = { unavailableAttachment: false, accessibilityCaptionCount: 0 };
    const seen = new Set();
    function walk(value, path = '', depth = 0) {
        if (!value || depth > 18) return;
        if (typeof value === 'object') {
            if (seen.has(value)) return;
            seen.add(value);
            for (const [key, child] of (Array.isArray(value)
                ? value.map((child, index) => [String(index), child])
                : Object.entries(value))) {
                walk(child, path ? `${path}.${key}` : key, depth + 1);
            }
            return;
        }
        if (typeof value !== 'string') return;
        const text = cleanText(value);
        if (!text) return;
        if (isUnavailableAttachmentText(text)) signals.unavailableAttachment = true;
        if (/accessibility_caption$/i.test(path)) signals.accessibilityCaptionCount += 1;
    }
    walk(obj);
    return signals;
}

function collectTextCandidates(obj) {
    const candidates = [];
    const seenObjects = new Set();
    const seenTexts = new Set();
    function scoreCandidate(text, path) {
        const collapsed = text.replace(/\s+/g, ' ').trim();
        const lowerPath = path.toLowerCase();
        const attachmentTitle = isAttachmentTitlePath(path);
        let score = Math.min(collapsed.length, 500);
        if (/message(?:_container)?\.story\.message\.text/.test(lowerPath)) score += 160;
        if (/attached_story|story_attachment|subattachment|share/i.test(path)) score += 90;
        if (/comet_sections/i.test(path)) score += 35;
        if (attachmentTitle) score += 80;
        if (text.includes('\n')) score += 25;
        if (/actor|actors|name|url|wwwurl|tracking|feedback|reaction|comment|ufi|accessibility|caption|subtitle/i.test(path)) score -= 110;
        if (/title/i.test(path) && !attachmentTitle) score -= 100;
        if (/^\d+\s*(?:m|h|d|w)$/i.test(collapsed) || /^https?:\/\//i.test(collapsed)) score -= 170;
        if (isUnavailableAttachmentText(collapsed)) score -= 500;
        if (isUiText(collapsed)) score -= 220;
        return score;
    }
    function walk(value, path = '', depth = 0) {
        if (!value || depth > 18) return;
        if (typeof value === 'object') {
            if (seenObjects.has(value)) return;
            seenObjects.add(value);
            for (const [key, child] of (Array.isArray(value)
                ? value.map((child, index) => [String(index), child])
                : Object.entries(value))) {
                walk(child, path ? `${path}.${key}` : key, depth + 1);
            }
            return;
        }
        if (typeof value !== 'string') return;
        const text = cleanText(value);
        if (!text || text.length < 3 || seenTexts.has(text)) return;
        seenTexts.add(text);
        const lowerPath = path.toLowerCase();
        const messageText = /(?:^|\.)message(?:\.|_|$)/.test(lowerPath) && lowerPath.endsWith('.text');
        const cometText = /comet_sections|attached_story|story_attachment|subattachment|message_container/.test(lowerPath)
            && lowerPath.endsWith('.text');
        if (!messageText && !cometText && !isAttachmentTitlePath(path)) return;
        const score = scoreCandidate(text, path);
        if (score > 0) candidates.push({ text, path, score });
    }
    walk(obj);
    return candidates.toSorted((left, right) => right.score - left.score).slice(0, 12);
}

function choosePostText(comet, directText) {
    const direct = cleanText(directText);
    const candidates = collectTextCandidates(comet);
    const signals = collectTextSignals(comet);
    if (direct) return { text: direct, source: 'direct_message', missingReason: null, candidates: candidates.slice(0, 5) };
    const best = candidates[0] || null;
    return {
        text: best?.text || null,
        source: best ? 'fallback_nested_message' : 'missing',
        missingReason: best
            ? null
            : (signals.unavailableAttachment
                ? 'content_unavailable'
                : (signals.accessibilityCaptionCount ? 'media_accessibility_caption_only' : 'no_message_text')),
        candidates: candidates.slice(0, 5),
    };
}

function collectMedia(obj) {
    const urls = [];
    const tokens = [];
    const mediaIds = [];
    const videoUrls = [];
    const declaredCounts = [];
    const seen = new Set();
    function walk(value, path = '', depth = 0) {
        if (!value || typeof value !== 'object' || depth > 20 || seen.has(value)) return;
        seen.add(value);
        const type = String(value.__typename || '');
        const declaredCount = Number(value.all_subattachments?.count);
        if (Number.isInteger(declaredCount) && declaredCount > 0) declaredCounts.push(declaredCount);
        if (typeof value.id === 'string' && /^(?:pcb\.|set\.)/.test(value.id)) tokens.push(value.id);
        if (typeof value.id === 'string' && /^(?:Photo|Video)$/i.test(type)) mediaIds.push(value.id);
        for (const [key, child] of Object.entries(value)) {
            const childPath = path ? `${path}.${key}` : key;
            if (/mediaset|media_set|photoset/i.test(key) && typeof child === 'string') tokens.push(child);
            if (typeof child === 'string') {
                const normalized = normalizeHtml(child);
                if (/<MPD\b/i.test(normalized)) {
                    for (const match of normalized.matchAll(/<BaseURL>(https?:\/\/[^<]+)<\/BaseURL>/gi)) {
                        videoUrls.push(normalizeHtml(match[1]));
                    }
                } else if (/^https?:\/\//i.test(normalized) && /(?:fbcdn|scontent)/i.test(normalized)) {
                    const isImage = /\.(?:jpe?g|png|webp)(?:[?&#]|$)/i.test(normalized);
                    const isVideo = /\.(?:mp4|m3u8)(?:[?&#]|$)/i.test(normalized)
                        || /video-[^.]+\.xx\.fbcdn\.net/i.test(normalized);
                    if (isVideo && !isImage) videoUrls.push(normalized);
                    else if (isImage) urls.push(normalized);
                }
            }
            walk(child, childPath, depth + 1);
        }
    }
    walk(obj);
    const raw = JSON.stringify(obj);
    for (const match of raw.matchAll(/pcb\.\d+/g)) tokens.push(match[0]);
    return {
        imageUrls: unique(urls).slice(0, 120),
        videoUrls: unique(videoUrls).slice(0, 20),
        mediaSetTokens: unique(tokens).slice(0, 20),
        mediaIds: unique(mediaIds).slice(0, 120),
        declaredCount: declaredCounts.length ? Math.max(...declaredCounts) : null,
    };
}

function parseCometSections(holder) {
    const comet = holder?.comet_sections ? holder.comet_sections : holder;
    const story = getPath(comet, ['content', 'story']) || comet?.story || holder;
    const actor = getPath(comet, ['context_layout', 'story', 'comet_sections', 'actor_photo', 'story', 'actors', 0])
        || getPath(comet, ['content', 'story', 'actors', 0])
        || story?.actors?.[0]
        || null;
    const creationTime = firstDeepValue(getPath(comet, ['context_layout']) || comet, ['creation_time', 'creationTime']);
    const directText = getPath(comet, ['content', 'story', 'comet_sections', 'message', 'story', 'message', 'text'])
        || getPath(comet, ['content', 'story', 'comet_sections', 'message_container', 'story', 'message', 'text'])
        || getPath(comet, ['message', 'story', 'message', 'text'])
        || story?.message?.text;
    const textExtraction = choosePostText(comet, directText);
    const feedback = firstDeepValue(getPath(comet, ['feedback']) || comet, ['feedback_target_with_context'])
        || getPath(comet, ['feedback', 'story'])
        || story?.feedback
        || null;
    const postUrl = story?.wwwURL || story?.url || firstDeepValue(story, ['wwwURL']);
    const postIdFromUrl = String(postUrl || '').match(/\/(?:posts|permalink)\/([^/?#]+)/)?.[1] || null;
    const postId = story?.post_id
        || feedback?.subscription_target_id
        || feedback?.post_id
        || getPath(comet, ['feedback', 'story', 'post_id'])
        || postIdFromUrl
        || null;
    const media = collectMedia(comet);
    if (!postId && !textExtraction.text && !postUrl) return null;

    const reactionCount = firstDeepValue(feedback, ['reaction_count']);
    const commentCount = firstDeepValue(feedback, ['comment_count']);
    const shareCount = firstDeepValue(feedback, ['share_count']);
    return {
        post_id: postId ? String(postId) : null,
        story_id: story?.id || holder?.id || null,
        post_url: postUrl || null,
        created_at: Number.isFinite(Number(creationTime)) ? new Date(Number(creationTime) * 1000).toISOString() : null,
        creation_time: Number.isFinite(Number(creationTime)) ? Number(creationTime) : null,
        text: textExtraction.text,
        text_source: textExtraction.source,
        text_missing_reason: textExtraction.missingReason,
        text_candidates: textExtraction.candidates,
        author: actor ? { id: actor.id || null, name: actor.name || null, url: actor.url || null } : null,
        stats: {
            reactions: reactionCount?.count ?? reactionCount ?? null,
            comments: commentCount?.total_count ?? commentCount?.count ?? commentCount ?? null,
            shares: shareCount?.count ?? shareCount ?? null,
        },
        media,
    };
}

export function makePostKeys(post) {
    const text = String(post?.text || '').replace(/\s+/g, ' ').trim();
    return unique([
        post?.post_id ? `id:${post.post_id}` : null,
        post?.post_url ? `url:${post.post_url}` : null,
        post?.story_id ? `story:${post.story_id}` : null,
        text && post?.creation_time ? `time_text:${post.creation_time}:${text.slice(0, 300)}` : null,
    ]);
}

export function extractPosts(values, maxPosts = 1000, {
    includeRawPayload = false,
    includeUnavailablePosts = false,
    unavailablePostKeys = null,
} = {}) {
    const posts = [];
    const seenPosts = new Set();
    const seenObjects = new Set();
    function visit(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 24 || posts.length >= maxPosts || seenObjects.has(value)) return;
        seenObjects.add(value);
        const parsed = value.comet_sections ? parseCometSections(value) : null;
        if (parsed && (parsed.post_id || parsed.post_url || parsed.creation_time)) {
            const keys = makePostKeys(parsed);
            if (!includeUnavailablePosts && parsed.text_missing_reason === 'content_unavailable') {
                if (unavailablePostKeys instanceof Set) {
                    const diagnosticKey = keys[0] || `story:${parsed.story_id || parsed.creation_time || 'unknown'}`;
                    unavailablePostKeys.add(diagnosticKey);
                }
                return;
            }
            if (keys.length && !keys.some((key) => seenPosts.has(key))) {
                keys.forEach((key) => seenPosts.add(key));
                if (includeRawPayload) parsed.raw_comet_payload_json = value;
                posts.push(parsed);
            }
            // A timeline unit can contain a complete shared post or memory below it.
            // Its text/media are already inspected by parseCometSections; do not emit
            // the nested story as another independent timeline result.
            return;
        }
        for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, depth + 1);
    }
    for (const value of values || []) visit(value);
    return posts;
}

export function mergePosts(target, incoming, seen, maxPosts) {
    for (const post of incoming || []) {
        if (target.length >= maxPosts) break;
        const keys = makePostKeys(post);
        if (!keys.length || keys.some((key) => seen.has(key))) continue;
        keys.forEach((key) => seen.add(key));
        target.push(post);
    }
}

function collectPageInfoCandidates(value, candidates, path = '', depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 22 || seen.has(value)) return;
    seen.add(value);
    const cursor = typeof value.end_cursor === 'string'
        ? value.end_cursor
        : (typeof value.endCursor === 'string' ? value.endCursor : null);
    const hasNextPage = typeof value.has_next_page === 'boolean'
        ? value.has_next_page
        : (typeof value.hasNextPage === 'boolean' ? value.hasNextPage : null);
    if (cursor || hasNextPage !== null) {
        const lowerPath = path.toLowerCase();
        let score = 0;
        if (/timeline|feed_units|profilecomettimeline|stream/.test(lowerPath)) score += 120;
        if (/page_info|pageinfo/.test(lowerPath)) score += 40;
        if (cursor && hasNextPage !== null) score += 20;
        if (/comment|feedback|ufi|reaction|liker/.test(lowerPath)) score -= 150;
        candidates.push({ cursor, hasNextPage, path, score });
    }
    for (const [key, child] of (Array.isArray(value)
        ? value.map((child, index) => [String(index), child])
        : Object.entries(value))) {
        collectPageInfoCandidates(child, candidates, path ? `${path}.${key}` : key, depth + 1, seen);
    }
}

function isPlausibleTimelineCursor(cursor) {
    if (typeof cursor !== 'string') return false;
    const normalized = cursor.trim();
    if (normalized.length < 12 || /\s/.test(normalized)) return false;
    return !/^(?:about|friends|photos|posts|reels|videos)$/i.test(normalized);
}

function bestPageInfo(values) {
    const candidates = [];
    for (const value of values || []) collectPageInfoCandidates(value, candidates);
    const timelineCandidates = candidates.filter((candidate) => {
        const path = candidate.path.toLowerCase();
        if (/comment|feedback|ufi|reaction|liker/.test(path)) return false;
        return /timeline_list_feed_units|profilecomettimeline|timeline\.page_info|timeline\.pageinfo/.test(path);
    });
    return timelineCandidates
        .toSorted((left, right) => right.score - left.score)
        .find((item) => isPlausibleTimelineCursor(item.cursor) || item.hasNextPage === false) || null;
}

export function extractEndCursor(values, responseText = '') {
    const best = bestPageInfo(values);
    if (isPlausibleTimelineCursor(best?.cursor)) return best.cursor;
    const cursors = [];
    for (const match of String(responseText).matchAll(/"end_cursor":"([^"]+)"/g)) {
        const cursor = normalizeHtml(match[1]);
        if (isPlausibleTimelineCursor(cursor)) cursors.push(cursor);
    }
    return unique(cursors).at(-1) || null;
}

export function extractHasNextPage(values) {
    return bestPageInfo(values)?.hasNextPage ?? null;
}

export function parseSinceDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid sinceDate: ${value}`);
    return { input: value, timestamp, iso: new Date(timestamp).toISOString() };
}

export function boundaryHit(post, { knownPostIds = [], sinceDate = null } = {}) {
    const id = post?.post_id ? String(post.post_id) : null;
    const url = String(post?.post_url || '');
    if (id && knownPostIds.includes(id)) return { type: 'known_post_id', postId: id };
    const knownInUrl = knownPostIds.find((known) => known && url.includes(known));
    if (knownInUrl) return { type: 'known_post_url_fragment', postId: id, known: knownInUrl };
    const timestamp = post?.created_at ? Date.parse(post.created_at) : Number(post?.creation_time) * 1000;
    if (sinceDate && Number.isFinite(timestamp) && timestamp < sinceDate.timestamp) {
        return { type: 'older_than_since_date', postId: id, createdAt: post.created_at, sinceDate: sinceDate.iso };
    }
    return null;
}

export function splitAtBoundary(posts, boundary) {
    const accepted = [];
    for (const [index, post] of (posts || []).entries()) {
        const hit = boundaryHit(post, boundary);
        if (hit) return { posts: accepted, hit: { ...hit, index }, stopped: true };
        accepted.push(post);
    }
    return { posts: accepted, hit: null, stopped: false };
}
