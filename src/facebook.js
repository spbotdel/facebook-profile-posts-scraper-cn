import { normalizeHtml } from './htmlMedia.js';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const QUERY_NAMES = {
    initial: 'ProfileCometTimelineFeedQuery',
    refetch: 'ProfileCometTimelineFeedRefetchQuery',
};

// Refreshed from public Facebook bundles in June 2026. Live discovery is used when these rotate.
export const FALLBACK_DOC_IDS = {
    [QUERY_NAMES.initial]: ['25018373637835603'],
    [QUERY_NAMES.refetch]: ['25873749612229405'],
};

// Logged-out Relay queries currently expect these feature-provider variables.
// Facebook may add or remove providers; zero is the conservative logged-out value.
const RELAY_PROVIDER_VARIABLES = {
    __relay_internal__pv__ProfilePageImprovementsEnabledrelayprovider: 0,
    __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: 0,
    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: 0,
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: 0,
    __relay_internal__pv__IsWorkUserrelayprovider: 0,
    __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: 0,
    __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: 0,
    __relay_internal__pv__FeedDeepDiveTopicPillThreadViewEnabledrelayprovider: 0,
    __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: 0,
    __relay_internal__pv__FBReels_enable_meta_ai_label_gkrelayprovider: 0,
    __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: 0,
    __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: 0,
    __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: 0,
    __relay_internal__pv__IsMergQAPollsrelayprovider: 0,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: 0,
    __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: 0,
    __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: 0,
    __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: 0,
    __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: 0,
    __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 0,
    __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: 0,
    __relay_internal__pv__CometFeedStoryCopyLinkMenuItem_isLinkSharingEnabledrelayprovider: 0,
    __relay_internal__pv__isAttachmentsQueryOptimizationEnabledrelayprovider: 0,
    __relay_internal__pv__isWaAddressableFieldsEnabledrelayprovider: 0,
    __relay_internal__pv__GroupsCometGroupChatLazyLoadLastMessageSnippetrelayprovider: 0,
    __relay_internal__pv__GroupsCometLazyLoadFeaturedSectionrelayprovider: 0,
    __relay_internal__pv__CometVideoHomeCopyLinkMenuItem_isLinkSharingEnabledrelayprovider: 0,
    __relay_internal__pv__MWEBNewUserOnboardingShouldLoadUpsellsrelayprovider: 0,
    __relay_internal__pv__CometUnifiedVideoCreation_showPrivacyMergerelayprovider: 0,
};

export function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function firstMatch(text, patterns, fallback = null) {
    for (const pattern of patterns) {
        const match = String(text || '').match(pattern);
        if (match?.[1] !== undefined) return match[1];
    }
    return fallback;
}

function decodeEscapedText(value) {
    const text = normalizeHtml(value);
    if (!text) return null;
    if (!/\\u[0-9a-f]{4}|\\n|\\t|\\r/i.test(text)) return text;
    try {
        return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
    } catch {
        return text;
    }
}

function cleanDisplayName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || /^(error|facebook|log in or sign up)$/i.test(text)) return null;
    return text
        .replace(/\s*\|\s*Facebook\s*$/i, '')
        .replace(/\s*\(@[^)]+\)\s*[•|].*$/i, '')
        .replace(/\s*[•|]\s*Facebook(?:,.*)?$/i, '')
        .trim() || null;
}

export function normalizeProfileTarget(value) {
    const input = String(value || '').trim();
    if (!input) return null;
    if (/^\d+$/.test(input)) {
        return {
            input,
            url: `https://www.facebook.com/profile.php?id=${input}`,
            hintedId: input,
        };
    }

    const withoutAt = input.startsWith('@') ? input.slice(1) : input;
    const urlText = /^https?:\/\//i.test(withoutAt)
        ? withoutAt
        : `https://www.facebook.com/${withoutAt.replace(/^\/+|\/+$/g, '')}`;
    let url;
    try {
        url = new URL(urlText);
    } catch {
        throw new Error(`Invalid Facebook profile target: ${input}`);
    }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) {
        throw new Error(`Only facebook.com profile targets are supported: ${input}`);
    }
    if (/^\/groups(?:\/|$)|^\/marketplace(?:\/|$)/i.test(url.pathname)) {
        throw new Error(`Expected a personal profile, not a group or Marketplace URL: ${input}`);
    }

    url.hostname = 'www.facebook.com';
    url.hash = '';
    const queryId = url.pathname.toLowerCase() === '/profile.php' ? url.searchParams.get('id') : null;
    const peopleId = url.pathname.match(/\/people\/[^/]+\/(\d+)\/?$/i)?.[1] || null;
    const numericPathId = url.pathname.match(/^\/(\d+)\/?$/)?.[1] || null;
    if (url.pathname.toLowerCase() !== '/profile.php') url.search = '';
    return {
        input,
        url: url.toString(),
        hintedId: queryId || peopleId || numericPathId || null,
    };
}

export function readProfileTargets(input) {
    const values = [];
    if (Array.isArray(input.profileUrls)) values.push(...input.profileUrls);
    if (typeof input.profileUrl === 'string') values.push(input.profileUrl);
    if (Array.isArray(input.targets)) values.push(...input.targets);
    const normalized = values.map(normalizeProfileTarget).filter(Boolean);
    const seen = new Set();
    return normalized.filter((target) => {
        const key = target.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function fetchText(client, url, options = {}) {
    const { timeout = 30000, ...requestOptions } = options;
    const response = await client(url, {
        throwHttpErrors: false,
        followRedirect: true,
        ...requestOptions,
        timeout: { request: timeout },
    });
    return {
        statusCode: response.statusCode,
        url: response.url,
        headers: response.headers,
        body: String(response.body || ''),
    };
}

function commonBootstrapFields(decoded) {
    return {
        lsd: firstMatch(decoded, [
            /"LSD",\[\],\{"token":"([^"]+)"/,
            /"token":"([^"]+)","async_get_token"/,
            /name="lsd"\s+value="([^"]+)"/,
        ], '_'),
        jazoest: firstMatch(decoded, [/&jazoest=(\d+)"/, /name="jazoest"\s+value="([^"]+)"/], ''),
        av: firstMatch(decoded, [/__user=(\d+)&/, /"USER_ID":"(\d+)"/], '0'),
        user: firstMatch(decoded, [/__user=(\d+)&/, /"USER_ID":"(\d+)"/], '0'),
        a: firstMatch(decoded, [/__a=(\d+)&/], '1'),
        hs: firstMatch(decoded, [/"haste_session":"([^"]+)"/], ''),
        dpr: firstMatch(decoded, [/"pr":([0-9.]+)/], '1'),
        ccg: firstMatch(decoded, [/"connectionClass":"([^"]+)"/], 'GOOD'),
        rev: firstMatch(decoded, [/"__spin_r":(\d+)/, /\{"rev":(\d+)\}/], ''),
        hsi: firstMatch(decoded, [/"hsi":"([^"]+)"/], ''),
        cometReq: firstMatch(decoded, [/__comet_req=(\d+)&/], '15'),
        spinR: firstMatch(decoded, [/"__spin_r":(\d+)/], ''),
        spinB: firstMatch(decoded, [/"__spin_b":"([^"]+)"/], 'trunk'),
        spinT: firstMatch(decoded, [/"__spin_t":(\d+)/], ''),
    };
}

export function extractProfileBootstrap(html, finalUrl, target = {}) {
    const decoded = normalizeHtml(html);
    const urlId = (() => {
        try {
            const url = new URL(finalUrl || target.url);
            return url.searchParams.get('id')
                || url.pathname.match(/\/people\/[^/]+\/(\d+)\/?$/i)?.[1]
                || url.pathname.match(/^\/(\d+)\/?$/)?.[1]
                || null;
        } catch {
            return null;
        }
    })();
    const profileId = firstMatch(decoded, [
        /"userID":"(\d+)"/,
        /"profileID":"(\d+)"/,
        /"profile_id":"(\d+)"/,
        /"selectedID":"(\d+)"/,
        /"entityID":"(\d+)"/,
    ], target.hintedId || urlId || null);
    const title = cleanDisplayName(decodeEscapedText(firstMatch(decoded, [/<title[^>]*>(.*?)<\/title>/is])));
    const hasLoginWall = !profileId && /you must log in|log in to facebook|login_required|checkpoint|create new account/i.test(decoded);
    const unavailable = /this content isn't available|page isn't available|content not found/i.test(decoded);
    return {
        ...commonBootstrapFields(decoded),
        profileId,
        profileName: title,
        profileType: null,
        hasLoginWall,
        unavailable,
        htmlLength: html.length,
        finalUrl: finalUrl || target.url || null,
    };
}

export function profileFeedUrl(targetUrl) {
    const url = new URL(targetUrl);
    url.hash = '';
    url.searchParams.set('sk', 'posts');
    return url.toString();
}

function routePathForTarget(targetUrl) {
    const url = new URL(targetUrl);
    return `${url.pathname}${url.search}`.replace(/^\//, '');
}

export async function resolveProfileRoute(client, targetUrl, bootstrap) {
    const routePath = routePathForTarget(targetUrl);
    const data = new URLSearchParams({
        client_previous_actor_id: '',
        route_url: `/${routePath}`,
        routing_namespace: 'fb_comet',
        __aaid: '0',
        __user: bootstrap.user || '0',
        __a: bootstrap.a || '1',
        __req: 'j',
        __hs: bootstrap.hs || '',
        dpr: bootstrap.dpr || '1',
        __ccg: bootstrap.ccg || 'GOOD',
        __rev: bootstrap.rev || '',
        __hsi: bootstrap.hsi || '',
        __comet_req: bootstrap.cometReq || '15',
        lsd: bootstrap.lsd || '_',
        jazoest: bootstrap.jazoest || '',
        __spin_r: bootstrap.spinR || '',
        __spin_b: bootstrap.spinB || 'trunk',
        __spin_t: bootstrap.spinT || '',
    });
    const response = await fetchText(client, 'https://www.facebook.com/ajax/navigation/', {
        method: 'POST',
        body: data.toString(),
        headers: {
            accept: '*/*',
            'content-type': 'application/x-www-form-urlencoded',
            referer: targetUrl,
            'x-fb-lsd': bootstrap.lsd || '_',
        },
    });
    const decoded = normalizeHtml(response.body);
    let routeResult = null;
    try {
        const parsed = JSON.parse(decoded.replace(/^for\s*\(;;\);/, ''));
        let result = parsed?.payload?.payload?.result || null;
        if (result?.type === 'route_redirect') result = result.redirect_result;
        routeResult = result;
    } catch {
        routeResult = null;
    }
    const exportsData = routeResult?.exports || null;
    const profileId = firstMatch(decoded, [
        /"userID":"(\d+)"/,
        /"profileID":"(\d+)"/,
        /"selectedID":"(\d+)"/,
        /"entity_id":"(\d+)"/,
        /"entityID":"(\d+)"/,
    ]);
    const profileType = exportsData?.entityKeyConfig?.entity_type?.value
        || firstMatch(decoded, [/"entity_type":\{"value":"([^"]+)"/]);
    const structuredProfileId = exportsData?.rootView?.props?.userID || null;
    const profileName = cleanDisplayName(decodeEscapedText(firstMatch(decoded, [
        /"name":"([^"]+)","url":"https:\/\/www\.facebook\.com\//,
        /"title":"([^"]+)","url":"https:\/\/www\.facebook\.com\//,
    ])));
    return {
        statusCode: response.statusCode,
        profileId: structuredProfileId || profileId,
        profileType,
        profileName,
        responseLength: response.body.length,
    };
}

function absolutize(url) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `https://www.facebook.com${url}`;
    return url;
}

export function extractAssetUrls(html) {
    const decoded = normalizeHtml(html);
    const urls = [];
    for (const match of decoded.matchAll(/(?:href|src)=["']([^"']+(?:\.js|rsrc\.php)[^"']*)["']/gi)) {
        urls.push(absolutize(match[1]));
    }
    for (const match of decoded.matchAll(/https?:\/\/static\.[^"'<>\\\s]+?(?:\.js|rsrc\.php)[^"'<>\\\s]*/gi)) {
        urls.push(normalizeHtml(match[0]));
    }
    return unique(urls);
}

export function extractEmbeddedJsonValues(html) {
    const values = [];
    const errors = [];
    const source = String(html || '');
    for (const match of source.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const body = match[1].trim();
        if (!body) continue;
        try {
            values.push(JSON.parse(body));
        } catch (error) {
            errors.push(error.message);
        }
    }
    return { values, errors: unique(errors).slice(0, 10) };
}

export function extractDocIdsFromText(text) {
    const decoded = normalizeHtml(text);
    const found = {};
    for (const queryName of Object.values(QUERY_NAMES)) {
        const occurrences = [...decoded.matchAll(new RegExp(queryName, 'g'))];
        if (!occurrences.length) continue;
        const candidates = [];
        for (const occurrence of occurrences) {
            const index = occurrence.index;
            const before = decoded.slice(Math.max(0, index - 1200), index);
            const after = decoded.slice(index, index + 1600);
            const precedingExports = [...before.matchAll(/e\.exports\s*=\s*["'](\d{8,})["']/g)].at(-1);
            if (precedingExports) {
                candidates.push({ id: precedingExports[1], distance: before.length - precedingExports.index, priority: 2 });
            }
            for (const match of after.matchAll(/["']doc_id["']\s*:\s*["'](\d{8,})["']|doc_id=(\d{8,})/g)) {
                candidates.push({ id: match[1] || match[2], distance: match.index, priority: 3 });
            }
            for (const match of before.matchAll(/["']doc_id["']\s*:\s*["'](\d{8,})["']|doc_id=(\d{8,})/g)) {
                candidates.push({ id: match[1] || match[2], distance: before.length - match.index, priority: 1 });
            }
        }
        const best = candidates.toSorted((left, right) => {
            const leftScore = left.priority * 10 - left.distance;
            const rightScore = right.priority * 10 - right.distance;
            return rightScore - leftScore;
        })[0];
        if (best?.id) found[queryName] = best.id;
    }
    return found;
}

export async function discoverProfileDocIds(client, html, { fetchBundles = true, debug = false } = {}) {
    const found = extractDocIdsFromText(html);
    const checked = [];
    if (!fetchBundles || Object.keys(found).length === Object.keys(QUERY_NAMES).length) {
        return { found, checked: debug ? checked : undefined };
    }
    for (const url of extractAssetUrls(html).slice(0, 35)) {
        try {
            const response = await fetchText(client, url, {
                headers: { accept: '*/*', referer: 'https://www.facebook.com/' },
                timeout: 20000,
            });
            const current = extractDocIdsFromText(response.body);
            Object.assign(found, current);
            if (debug) checked.push({ url, statusCode: response.statusCode, length: response.body.length, found: current });
            if (Object.keys(found).length === Object.keys(QUERY_NAMES).length) break;
        } catch (error) {
            if (debug) checked.push({ url, error: error.message });
        }
    }
    return { found, checked: debug ? checked : undefined };
}

export function initialProfileVariables(profileId, count, omitPinnedPosts) {
    return {
        UFI2CommentsProvider_commentsKey: 'ProfileCometTimelineFeedQuery',
        count,
        feedbackSource: 0,
        feedLocation: 'TIMELINE',
        focusCommentID: null,
        omitPinnedPost: omitPinnedPosts,
        privacySelectorRenderLocation: 'COMET_STREAM',
        renderLocation: 'timeline',
        scale: 1,
        shouldShowProfilePinnedPost: !omitPinnedPosts,
        stream_count: 1,
        useDefaultActor: false,
        userID: profileId,
        ...RELAY_PROVIDER_VARIABLES,
    };
}

export function refetchProfileVariables(profileId, cursor, count, omitPinnedPosts) {
    return {
        UFI2CommentsProvider_commentsKey: 'ProfileCometTimelineFeedQuery',
        afterTime: null,
        beforeTime: null,
        count,
        cursor,
        feedLocation: 'TIMELINE',
        feedbackSource: 0,
        focusCommentID: null,
        memorializedSplitTimeFilter: null,
        omitPinnedPost: omitPinnedPosts,
        postedBy: null,
        privacy: null,
        privacySelectorRenderLocation: 'COMET_STREAM',
        renderLocation: 'timeline',
        scale: 1,
        stream_count: 1,
        taggedInOnly: null,
        trackingCode: null,
        useDefaultActor: false,
        id: profileId,
        ...RELAY_PROVIDER_VARIABLES,
    };
}

export function buildGraphqlBody(bootstrap, queryName, docId, variables) {
    const data = {
        av: bootstrap.av || '0',
        __aaid: '0',
        __user: bootstrap.user || '0',
        __a: bootstrap.a || '1',
        __req: 'f',
        __hs: bootstrap.hs || '',
        dpr: bootstrap.dpr || '1',
        __ccg: bootstrap.ccg || 'GOOD',
        __rev: bootstrap.rev || '',
        __hsi: bootstrap.hsi || '',
        __comet_req: bootstrap.cometReq || '15',
        lsd: bootstrap.lsd || '_',
        jazoest: bootstrap.jazoest || '',
        __spin_r: bootstrap.spinR || '',
        __spin_b: bootstrap.spinB || 'trunk',
        __spin_t: bootstrap.spinT || '',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: queryName,
        server_timestamps: 'true',
        variables: JSON.stringify(variables),
        doc_id: String(docId),
    };
    return new URLSearchParams(data).toString();
}

export function parseJsonPayload(text) {
    const cleaned = String(text || '').replace(/^for\s*\(;;\);/, '');
    const values = [];
    const errors = [];
    for (const line of cleaned.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        try {
            values.push(JSON.parse(line));
        } catch (error) {
            errors.push(error.message);
        }
    }
    if (!values.length && cleaned.trim()) {
        try {
            values.push(JSON.parse(cleaned));
        } catch (error) {
            errors.push(error.message);
        }
    }
    return { values, errors: unique(errors).slice(0, 5) };
}

export function graphqlErrors(values) {
    return (values || []).flatMap((value) => value?.errors || []).map((error) => ({
        message: error?.message || 'Unknown GraphQL error',
        code: error?.code ?? null,
        severity: error?.severity ?? null,
    }));
}
