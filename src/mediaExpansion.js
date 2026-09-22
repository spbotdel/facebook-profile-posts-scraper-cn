import { gotScraping } from 'got-scraping';

import { cleanImageUrls, extractImageUrlsFromHtml, mediaKey } from './htmlMedia.js';
import { legacyMediaCompleteness, mediaCompleteness, mediaReviewSeverity } from './mediaQuality.js';
import { fetchText, unique, USER_AGENT } from './facebook.js';

const PROVIDER_NAME = 'dachapify_facebook_profile_posts_all_photos';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFacebookUrl(value) {
    const url = String(value || '').trim();
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) return `https://www.facebook.com${url}`;
    return null;
}

export function mediaSetTokensForPost(post) {
    const tokens = [...(post?.media?.mediaSetTokens || [])];
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    if (!tokens.length && post?.post_id && feedImages.length >= 4) tokens.push(`pcb.${post.post_id}`);
    return unique(tokens);
}

function mediaSetUrls(token) {
    const encoded = encodeURIComponent(token);
    return [
        `https://www.facebook.com/media/set/?set=${encoded}&type=1`,
        `https://m.facebook.com/media/set/?set=${encoded}&type=1`,
    ];
}

export function profilePermalinkUrls(post, profile) {
    const urls = [];
    const sourceUrl = normalizeFacebookUrl(post?.post_url);
    if (sourceUrl) {
        urls.push(sourceUrl.replace(/^https?:\/\/m\.facebook\.com/i, 'https://www.facebook.com'));
        urls.push(sourceUrl.replace(/^https?:\/\/(?:www\.)?facebook\.com/i, 'https://m.facebook.com'));
    }
    const profileId = profile?.id || post?.author?.id;
    const postId = post?.post_id;
    if (profileId && postId) {
        urls.push(`https://www.facebook.com/${profileId}/posts/${postId}/`);
        urls.push(`https://m.facebook.com/${profileId}/posts/${postId}/`);
        urls.push(`https://www.facebook.com/profile.php?id=${profileId}&story_fbid=${postId}`);
        urls.push(`https://m.facebook.com/profile.php?id=${profileId}&story_fbid=${postId}`);
    }
    return unique(urls);
}

async function fetchExpansionPage(url, { client, proxyConfiguration }) {
    if (client) {
        return fetchText(client, url, {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                referer: 'https://www.facebook.com/',
            },
        });
    }
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    const response = await gotScraping({
        url,
        proxyUrl,
        throwHttpErrors: false,
        followRedirect: true,
        timeout: { request: 30000 },
        headers: {
            'accept-language': 'en-US,en;q=0.9',
            'user-agent': USER_AGENT,
        },
    });
    return {
        statusCode: response.statusCode,
        url: response.url,
        headers: response.headers,
        body: String(response.body || ''),
    };
}

function candidateIsBetter(candidate, current) {
    if (candidate.images.length !== current.images.length) return candidate.images.length > current.images.length;
    if (!current.url) return true;
    return candidate.source === 'media_set' && current.source !== 'media_set';
}

async function tryExpansionUrl(url, context, metadata) {
    const attempts = [];
    let best = { ...metadata, url: null, images: [], rawCount: 0, statusCode: null, attempts };
    for (let attempt = 1; attempt <= context.retries + 1; attempt += 1) {
        const startedAt = new Date().toISOString();
        try {
            const response = await fetchExpansionPage(url, context);
            const rawImages = extractImageUrlsFromHtml(response.body);
            const images = cleanImageUrls(rawImages);
            attempts.push({
                url,
                attempt,
                startedAt,
                statusCode: response.statusCode,
                finalUrl: response.url,
                rawCount: rawImages.length,
                cleanCount: images.length,
                source: metadata.source,
            });
            best = {
                ...metadata,
                url: response.url || url,
                images,
                rawCount: rawImages.length,
                statusCode: response.statusCode,
                attempts,
            };
            if (images.length || (response.statusCode < 500 && ![400, 429].includes(response.statusCode))) break;
        } catch (error) {
            attempts.push({
                url,
                attempt,
                startedAt,
                source: metadata.source,
                error: error.message,
                code: error.code || null,
            });
        }
        if (attempt <= context.retries) await sleep(context.retryDelayMs * attempt);
    }
    return best;
}

export async function expandPostPhotos(post, profile, options = {}) {
    const context = {
        client: options.client || null,
        proxyConfiguration: options.proxyConfiguration || null,
        retries: Math.max(0, Number(options.retries) || 0),
        retryDelayMs: Math.max(0, Number(options.retryDelayMs) || 800),
    };
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    const tokens = mediaSetTokensForPost(post);
    const allAttempts = [];
    let best = { token: null, source: null, url: null, images: [], rawCount: 0, statusCode: null, attempts: [] };

    for (const token of tokens) {
        for (const url of mediaSetUrls(token)) {
            const candidate = await tryExpansionUrl(url, context, { token, source: 'media_set' });
            allAttempts.push(...candidate.attempts);
            if (candidateIsBetter(candidate, best)) best = candidate;
            if (best.images.length > feedImages.length) break;
        }
        if (best.images.length > feedImages.length) break;
    }

    const needsPermalinkFallback = feedImages.length >= 5 && best.images.length <= feedImages.length;
    if (needsPermalinkFallback) {
        for (const url of profilePermalinkUrls(post, profile)) {
            const candidate = await tryExpansionUrl(url, context, { token: tokens[0] || null, source: 'post_permalink_fallback' });
            candidate.images = cleanImageUrls([...candidate.images, ...feedImages]);
            allAttempts.push(...candidate.attempts);
            if (candidateIsBetter(candidate, best)) best = candidate;
            if (best.images.length > feedImages.length) break;
        }
    }

    return { ...best, attempts: allAttempts };
}

export function normalizeProfilePost(post, rank, profile, expansion, options = {}) {
    const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
    const expandedImages = cleanImageUrls(expansion?.images || []);
    const finalImages = expandedImages.length >= feedImages.length && expandedImages.length
        ? expandedImages
        : feedImages;
    const usedExpansion = finalImages === expandedImages;
    const expansionAttempted = Boolean(expansion);
    const mediaSetTokens = mediaSetTokensForPost(post);
    const declaredCount = Number.isInteger(Number(post?.media?.declaredCount)) && Number(post.media.declaredCount) > 0
        ? Number(post.media.declaredCount)
        : null;
    const completeness = mediaCompleteness({
        feedImages,
        expandedImages,
        expansionAttempted,
        mediaSetTokens,
        declaredCount,
    });
    const legacyCompleteness = legacyMediaCompleteness({ feedImages, expandedImages, expansionAttempted });
    const reviewSeverity = mediaReviewSeverity({
        media_completeness: completeness,
        media_completeness_legacy: legacyCompleteness,
        media_preview_count: feedImages.length,
        media_expanded_count: expandedImages.length,
    });
    const author = post?.author || {};
    const profileId = profile?.id || author.id || null;
    const sourceUrl = post?.post_url
        || (profileId && post?.post_id ? `https://www.facebook.com/${profileId}/posts/${post.post_id}/` : null);
    const mediaSource = usedExpansion ? (expansion?.source || 'media_set') : 'feed';

    return {
        record_type: 'post',
        source_platform: 'facebook',
        provider: PROVIDER_NAME,
        rank,
        source_profile_id: profileId,
        source_profile_url: profile?.url || null,
        source_profile_name: profile?.name || author.name || null,
        source_profile_type: profile?.type || 'profile',
        source_post_id: post?.post_id || null,
        source_url: sourceUrl,
        created_at: post?.created_at || null,
        created_at_source: post?.created_at ? 'graphql_creation_time' : null,
        created_at_precision: post?.created_at ? 'second' : null,
        creation_time: post?.creation_time || null,
        raw_text: post?.text || '',
        text_source: post?.text_source || (post?.text ? 'direct_message' : 'missing'),
        text_missing_reason: post?.text_missing_reason || null,
        text_candidates: post?.text_candidates || [],
        author: {
            id: author.id || profileId,
            source_user_id: author.id || profileId,
            name: author.name || profile?.name || null,
            url: author.url || (profileId ? `https://www.facebook.com/profile.php?id=${profileId}` : null),
        },
        stats: post?.stats || {},
        media: finalImages.map((url, index) => ({
            source_media_id: post?.media?.mediaIds?.[index] || mediaKey(url),
            media_type: 'photo',
            source_url: url,
            thumbnail_url: url,
            width: 0,
            height: 0,
            ocr_text: null,
            source: mediaSource,
            index: index + 1,
        })),
        video_urls: unique(post?.media?.videoUrls || []),
        media_set_tokens: mediaSetTokens,
        media_preview_count: feedImages.length,
        media_expanded_count: expandedImages.length,
        media_final_count: finalImages.length,
        media_declared_count: declaredCount,
        media_declared_count_satisfied: declaredCount ? finalImages.length >= declaredCount : null,
        media_completeness: completeness,
        media_completeness_legacy: legacyCompleteness,
        media_review_severity: reviewSeverity,
        media_plus_n_risk: completeness === 'likely_incomplete_plusN',
        media_counts: {
            feed_photo_count: feedImages.length,
            expanded_photo_count: expandedImages.length,
            final_photo_count: finalImages.length,
            facebook_declared_attachment_count: declaredCount,
            expanded_raw_count: expansion?.rawCount || 0,
            video_url_count: post?.media?.videoUrls?.length || 0,
        },
        media_source: mediaSource,
        media_complete_confidence: usedExpansion ? 'high' : (completeness === 'feed_complete' ? 'medium' : 'unknown'),
        media_expansion: {
            attempted: expansionAttempted,
            requested_retries: expansionAttempted ? (options.retries ?? null) : null,
            status_code: expansion?.statusCode || null,
            url: expansion?.url || null,
            attempts: expansion?.attempts || [],
        },
        coverage_status: options.coverageStatus || 'unknown',
        warnings: options.warnings || [],
        raw_payload_json: options.includeRawPayload ? (post?.raw_comet_payload_json || null) : undefined,
    };
}

export async function mapWithConcurrency(items, concurrency, worker) {
    const output = new Array(items.length);
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            output[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return output;
}
