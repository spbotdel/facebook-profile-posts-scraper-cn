import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';

import { createResultChargeBudget } from './charging.js';
import {
    buildGraphqlBody,
    discoverProfileDocIds,
    extractEmbeddedJsonValues,
    extractProfileBootstrap,
    FALLBACK_DOC_IDS,
    fetchText,
    graphqlErrors,
    initialProfileVariables,
    parseJsonPayload,
    profileFeedUrl,
    QUERY_NAMES,
    readProfileTargets,
    refetchProfileVariables,
    resolveProfileRoute,
    unique,
    USER_AGENT,
} from './facebook.js';
import { cleanImageUrls } from './htmlMedia.js';
import {
    expandPostPhotos,
    mapWithConcurrency,
    mediaSetTokensForPost,
    normalizeProfilePost,
} from './mediaExpansion.js';
import {
    extractEndCursor,
    extractHasNextPage,
    extractPosts,
    makePostKeys,
    mergePosts,
    parseSinceDate,
    splitAtBoundary,
} from './postParser.js';
import { buildProxySessionId } from './proxySession.js';
import { proxyCountryCandidates, shouldRetryProfileInAnotherCountry } from './profileRetry.js';

const VERSION = '1.0.0';
const POSTS_PER_REFETCH = 3;
const GRAPHQL_RATE_LIMIT_BACKOFF_MS = 2500;
const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function integerSetting(input, key, fallback, min, max) {
    const parsed = Number(input?.[key]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function booleanSetting(input, key, fallback) {
    return typeof input?.[key] === 'boolean' ? input[key] : fallback;
}

function errorSummary(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        code: error?.code || null,
        retryable: Boolean(error?.retryable),
    };
}

class FacebookRequestError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'FacebookRequestError';
        this.code = options.code || null;
        this.retryable = options.retryable !== false;
        this.details = options.details || null;
    }
}

function isRateLimit(errors, text, statusCode) {
    if (statusCode === 429) return true;
    if ((errors || []).some((error) => Number(error.code) === 1675004)) return true;
    return /rate limit|too many requests|temporarily blocked/i.test(String(text || ''));
}

function isInvalidCursor(errors, text) {
    return (errors || []).some((error) => /invalid cursor/i.test(`${error.summary || ''} ${error.debug_info || ''} ${error.message || ''}`))
        || /invalid cursor/i.test(String(text || ''));
}

function isTransientRequestRejection(text) {
    return /"error":1357054|Your Request Couldn(?:'|\\u0027)t be Processed/i.test(String(text || ''));
}

function queryCandidateIds(queryName, discovered = {}) {
    return unique([
        discovered[queryName],
        ...(FALLBACK_DOC_IDS[queryName] || []),
    ]);
}

function clientHeaders() {
    return {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'upgrade-insecure-requests': '1',
        'user-agent': USER_AGENT,
    };
}

async function createSession(proxyConfiguration, reason, attempt) {
    const sessionId = buildProxySessionId(reason, attempt);
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl(sessionId) : undefined;
    const cookieJar = new CookieJar();
    const client = gotScraping.extend({
        proxyUrl,
        cookieJar,
        headers: clientHeaders(),
        retry: { limit: 0 },
    });
    return {
        sessionId,
        proxyUrl: proxyUrl ? proxyUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : null,
        cookieJar,
        client,
        bootstrap: null,
        html: '',
        docIds: {},
        discoveryAttempted: false,
    };
}

async function bootstrapProfile(target, proxyConfiguration, options, reason = 'initial') {
    const attempts = [];
    let lastError = null;
    for (let attempt = 1; attempt <= options.bootstrapRetries; attempt += 1) {
        const session = await createSession(proxyConfiguration, `${reason}-${target.input}`, attempt);
        try {
            const feedUrl = profileFeedUrl(target.url);
            const response = await fetchText(session.client, feedUrl, {
                headers: clientHeaders(),
                timeout: 35000,
            });
            session.html = response.body;
            const bootstrap = extractProfileBootstrap(response.body, response.url, target);
            let route = null;
            if (!bootstrap.unavailable && response.statusCode < 500 && response.statusCode !== 429) {
                try {
                    route = await resolveProfileRoute(session.client, feedUrl, bootstrap);
                } catch (error) {
                    route = { error: error.message };
                }
            }
            session.bootstrap = {
                ...bootstrap,
                feedUrl,
                profileId: route?.profileId || bootstrap.profileId,
                profileName: route?.profileName || bootstrap.profileName,
                profileType: route?.profileType || bootstrap.profileType || 'profile',
            };
            attempts.push({
                attempt,
                sessionId: session.sessionId,
                statusCode: response.statusCode,
                finalUrl: response.url,
                htmlLength: response.body.length,
                profileId: session.bootstrap.profileId,
                hasLoginWall: session.bootstrap.hasLoginWall,
                unavailable: session.bootstrap.unavailable,
                route,
            });

            if (session.bootstrap.unavailable) {
                throw new FacebookRequestError('Facebook reports that this profile is unavailable.', {
                    code: 'profile_unavailable',
                    retryable: false,
                });
            }
            if (response.statusCode === 404) {
                throw new FacebookRequestError('Facebook profile was not found.', {
                    code: 'profile_not_found',
                    // Logged-out Facebook occasionally returns a proxy/session-specific 404
                    // for a valid public handle. Confirm it across the bounded bootstrap pool.
                    retryable: true,
                });
            }
            if (response.statusCode === 429 || response.statusCode >= 500) {
                throw new FacebookRequestError(`Profile bootstrap returned HTTP ${response.statusCode}.`, {
                    code: response.statusCode === 429 ? 'rate_limited' : 'bootstrap_http_error',
                });
            }
            if (!session.bootstrap.profileId) {
                throw new FacebookRequestError(
                    session.bootstrap.hasLoginWall
                        ? 'Facebook returned a login wall instead of a public profile.'
                        : 'Could not resolve the public profile to a numeric Facebook ID.',
                    { code: session.bootstrap.hasLoginWall ? 'login_wall' : 'profile_id_missing' },
                );
            }
            return { session, attempts };
        } catch (error) {
            lastError = error;
            const previous = attempts.at(-1);
            if (!previous || previous.attempt !== attempt) {
                attempts.push({ attempt, sessionId: session.sessionId, error: errorSummary(error) });
            } else {
                previous.error = errorSummary(error);
            }
            if (error?.retryable === false) break;
            if (attempt < options.bootstrapRetries) await sleep(500 * attempt);
        }
    }
    const wrapped = lastError instanceof FacebookRequestError
        ? lastError
        : new FacebookRequestError(lastError?.message || 'Profile bootstrap failed.', { code: 'bootstrap_failed' });
    wrapped.details = { ...(wrapped.details || {}), attempts };
    throw wrapped;
}

async function discoverDocIds(session, debug) {
    if (session.discoveryAttempted) return session.docIds;
    session.discoveryAttempted = true;
    const discovery = await discoverProfileDocIds(session.client, session.html, {
        fetchBundles: true,
        debug,
    });
    session.docIds = { ...session.docIds, ...discovery.found };
    session.discovery = discovery;
    return session.docIds;
}

function variablesForQuery(kind, profileId, cursor, count, omitPinnedPosts) {
    return kind === 'initial'
        ? initialProfileVariables(profileId, Math.min(1, count), omitPinnedPosts)
        : refetchProfileVariables(profileId, cursor || null, Math.min(POSTS_PER_REFETCH, count), omitPinnedPosts);
}

async function executeGraphqlPage(session, parameters) {
    const queryName = QUERY_NAMES[parameters.kind];
    const variables = variablesForQuery(
        parameters.kind,
        parameters.profileId,
        parameters.cursor,
        parameters.count,
        parameters.omitPinnedPosts,
    );
    const attempts = [];

    async function tryIds(ids, source) {
        for (const docId of ids) {
            const body = buildGraphqlBody(session.bootstrap, queryName, docId, variables);
            try {
                const response = await fetchText(session.client, GRAPHQL_URL, {
                    method: 'POST',
                    body,
                    headers: {
                        accept: '*/*',
                        'content-type': 'application/x-www-form-urlencoded',
                        origin: 'https://www.facebook.com',
                        referer: session.bootstrap.feedUrl || session.bootstrap.finalUrl || parameters.profileUrl,
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'x-fb-friendly-name': queryName,
                        'x-fb-lsd': session.bootstrap.lsd || '_',
                    },
                    timeout: 40000,
                });
                const parsed = parseJsonPayload(response.body);
                const errors = graphqlErrors(parsed.values);
                const posts = extractPosts(parsed.values, Math.max(parameters.count * 4, 30), {
                    includeRawPayload: parameters.includeRawPayload,
                    includeUnavailablePosts: parameters.includeUnavailablePosts,
                    unavailablePostKeys: parameters.unavailablePostKeys,
                });
                const endCursor = extractEndCursor(parsed.values, response.body);
                const hasNextPage = extractHasNextPage(parsed.values);
                const attempt = {
                    queryName,
                    docId,
                    source,
                    statusCode: response.statusCode,
                    responseLength: response.body.length,
                    posts: posts.length,
                    endCursor: Boolean(endCursor),
                    hasNextPage,
                    errors,
                    parseErrors: parsed.errors,
                    responsePreview: parameters.debug ? response.body.slice(0, 1500) : undefined,
                };
                attempts.push(attempt);

                if (isRateLimit(errors, response.body, response.statusCode)) {
                    throw new FacebookRequestError('Facebook rate-limited the timeline query.', {
                        code: 'rate_limited',
                        details: attempt,
                    });
                }
                if (parameters.kind === 'refetch' && isInvalidCursor(errors, response.body)) {
                    throw new FacebookRequestError('Facebook rejected the historical timeline cursor.', {
                        code: 'invalid_cursor',
                        retryable: false,
                        details: attempt,
                    });
                }
                if (isTransientRequestRejection(response.body)) {
                    throw new FacebookRequestError('Facebook transiently rejected the timeline request.', {
                        code: 'request_rejected',
                        retryable: true,
                        details: attempt,
                    });
                }
                if (response.statusCode >= 500) {
                    throw new FacebookRequestError(`Timeline query returned HTTP ${response.statusCode}.`, {
                        code: 'graphql_http_error',
                        details: attempt,
                    });
                }
                if (posts.length || endCursor || hasNextPage === false) {
                    session.docIds[queryName] = docId;
                    return { posts, endCursor, hasNextPage, errors, attempts, responseLength: response.body.length };
                }
            } catch (error) {
                if (error instanceof FacebookRequestError
                    && (error.code === 'rate_limited'
                        || error.code === 'request_rejected'
                        || error.retryable === false)) throw error;
                attempts.push({ queryName, docId, source, error: errorSummary(error) });
            }
        }
        return null;
    }

    const initialResult = await tryIds(queryCandidateIds(queryName, session.docIds), 'known_or_fallback');
    if (initialResult) return initialResult;

    await discoverDocIds(session, parameters.debug);
    const discoveredResult = await tryIds(queryCandidateIds(queryName, session.docIds), 'bundle_discovery');
    if (discoveredResult) return discoveredResult;

    throw new FacebookRequestError(`No working document ID produced a usable ${queryName} response.`, {
        code: 'graphql_query_failed',
        details: { attempts, discovery: parameters.debug ? session.discovery : undefined },
    });
}

function profileDescriptor(target, bootstrap) {
    return {
        id: bootstrap.profileId,
        url: bootstrap.finalUrl || target.url,
        inputUrl: target.input,
        name: bootstrap.profileName || null,
        type: bootstrap.profileType || 'profile',
    };
}

function coverageStatusForStop(stopReason, postsCount) {
    if (stopReason === 'target_reached') return 'complete_target_reached';
    if (stopReason === 'known_post_id' || stopReason === 'known_post_url_fragment') return 'complete_until_known_post';
    if (stopReason === 'older_than_since_date') return 'complete_until_since_date';
    if (stopReason === 'feed_exhausted') return 'complete_feed_exhausted';
    if (stopReason === 'no_public_posts' && postsCount === 0) return 'no_public_posts';
    if (stopReason === 'no_cursor') return 'partial_no_cursor';
    if (stopReason === 'stalled_cursor') return 'partial_stalled_cursor';
    if (stopReason === 'page_limit') return 'partial_page_limit';
    return 'partial_error';
}

async function collectProfileFeed(target, proxyConfiguration, options) {
    let bootstrapped = await bootstrapProfile(target, proxyConfiguration, options, 'profile-bootstrap');
    let session = bootstrapped.session;
    const profile = profileDescriptor(target, session.bootstrap);
    const posts = [];
    const seen = new Set();
    const cursorsSeen = new Set();
    const queryAttempts = [];
    const warnings = [];
    const unavailablePostKeys = new Set();
    let cursor = options.startCursor || null;
    let kind = cursor ? 'refetch' : 'initial';
    let stopReason = null;
    let boundaryHit = null;
    let terminalPageError = null;
    let pages = 0;
    let emptyPages = 0;
    const maxPages = Math.max(12, Math.ceil(options.maxPostsPerProfile / POSTS_PER_REFETCH) + 20);

    if (!cursor) {
        const htmlCandidates = [{ source: 'public_profile_html', html: session.html }];
        let prefetched = null;
        for (let candidateIndex = 0; candidateIndex < 2; candidateIndex += 1) {
            if (candidateIndex === 1) {
                try {
                    const canonicalUrl = `https://www.facebook.com/profile.php?id=${profile.id}&sk=posts`;
                    const response = await fetchText(session.client, canonicalUrl, {
                        headers: clientHeaders(),
                        timeout: 35000,
                    });
                    htmlCandidates.push({ source: 'numeric_profile_html', html: response.body, statusCode: response.statusCode });
                    if (response.statusCode === 200 && response.body.length > session.html.length) session.html = response.body;
                } catch (error) {
                    queryAttempts.push({
                        page: 0,
                        kind: 'html_prefetch',
                        source: 'numeric_profile_html',
                        error: errorSummary(error),
                    });
                    break;
                }
            }
            const candidate = htmlCandidates[candidateIndex];
            const embedded = extractEmbeddedJsonValues(candidate.html);
            const candidatePosts = extractPosts(embedded.values, Math.max(options.maxPostsPerProfile, 30), {
                includeRawPayload: options.includeRawPayload,
                includeUnavailablePosts: options.includeUnavailablePosts,
                unavailablePostKeys,
            });
            const candidateCursor = extractEndCursor(embedded.values);
            const candidateHasNextPage = extractHasNextPage(embedded.values);
            queryAttempts.push({
                page: 0,
                kind: 'html_prefetch',
                source: candidate.source,
                statusCode: candidate.statusCode || 200,
                posts: candidatePosts.length,
                endCursor: Boolean(candidateCursor),
                hasNextPage: candidateHasNextPage,
                embeddedJsonBlocks: embedded.values.length,
                parseErrors: options.debug ? embedded.errors : undefined,
            });
            if (candidatePosts.length) {
                prefetched = {
                    posts: candidatePosts,
                    cursor: candidateCursor,
                    hasNextPage: candidateHasNextPage,
                };
                break;
            }
        }
        if (prefetched?.posts.length) {
            const boundarySplit = splitAtBoundary(prefetched.posts, options.boundary);
            mergePosts(posts, boundarySplit.posts, seen, options.maxPostsPerProfile);
            if (boundarySplit.stopped) {
                boundaryHit = boundarySplit.hit;
                stopReason = boundarySplit.hit.type;
            } else if (posts.length >= options.maxPostsPerProfile) {
                stopReason = 'target_reached';
            } else {
                // HTML contains several unrelated Relay connections. Use it for posts only;
                // let the initial timeline query establish an authoritative page cursor.
                cursor = null;
                kind = 'initial';
            }
        }
    }

    while (!stopReason && posts.length < options.maxPostsPerProfile && pages < maxPages) {
        pages += 1;
        let page = null;
        let lastError = null;
        for (let pageAttempt = 1; pageAttempt <= options.graphqlPageRetries + 1; pageAttempt += 1) {
            try {
                page = await executeGraphqlPage(session, {
                    kind,
                    profileId: profile.id,
                    profileUrl: profile.url,
                    cursor,
                    count: options.maxPostsPerProfile - posts.length,
                    omitPinnedPosts: options.omitPinnedPosts,
                    includeRawPayload: options.includeRawPayload,
                    includeUnavailablePosts: options.includeUnavailablePosts,
                    unavailablePostKeys,
                    debug: options.debug,
                });
                queryAttempts.push({ page: pages, pageAttempt, kind, cursor: cursor || null, sessionId: session.sessionId, attempts: page.attempts });
                break;
            } catch (error) {
                lastError = error;
                queryAttempts.push({
                    page: pages,
                    pageAttempt,
                    kind,
                    cursor: cursor || null,
                    sessionId: session.sessionId,
                    error: errorSummary(error),
                    details: options.debug ? error?.details : undefined,
                });
                if (pageAttempt > options.graphqlPageRetries || error?.retryable === false) break;
                bootstrapped = await bootstrapProfile(target, proxyConfiguration, options, `page-${pages}-retry`);
                session = bootstrapped.session;
                warnings.push(`Page ${pages} required a fresh Facebook proxy session.`);
                const retryBaseDelay = error?.code === 'rate_limited' ? GRAPHQL_RATE_LIMIT_BACKOFF_MS : 600;
                await sleep(retryBaseDelay * pageAttempt);
            }
        }
        if (!page) {
            if (posts.length) {
                terminalPageError = errorSummary(lastError);
                stopReason = 'page_error';
                warnings.push(`Stopped after ${posts.length} posts because the next timeline page exhausted its retries.`);
                break;
            }
            throw new FacebookRequestError(lastError?.message || `Timeline page ${pages} failed.`, {
                code: lastError?.code || 'page_failed',
                details: { profile, pages, postsCollected: posts.length, queryAttempts },
            });
        }

        const boundarySplit = splitAtBoundary(page.posts, options.boundary);
        mergePosts(posts, boundarySplit.posts, seen, options.maxPostsPerProfile);
        if (pages === 1 || pages % 10 === 0) {
            await Actor.setStatusMessage(
                `${profile.name || profile.id}: ${posts.length}/${options.maxPostsPerProfile} posts; ${pages} timeline pages`,
            );
        }
        if (boundarySplit.stopped) {
            boundaryHit = boundarySplit.hit;
            stopReason = boundarySplit.hit.type;
            break;
        }

        if (!page.posts.length) emptyPages += 1;
        else emptyPages = 0;
        if (posts.length >= options.maxPostsPerProfile) {
            stopReason = 'target_reached';
            break;
        }
        if (page.hasNextPage === false) {
            stopReason = posts.length ? 'feed_exhausted' : 'no_public_posts';
            break;
        }
        if (!page.endCursor) {
            stopReason = posts.length ? 'no_cursor' : 'no_public_posts';
            break;
        }
        if (cursorsSeen.has(page.endCursor) || page.endCursor === cursor) {
            stopReason = 'stalled_cursor';
            break;
        }
        cursorsSeen.add(page.endCursor);
        cursor = page.endCursor;
        kind = 'refetch';
        if (emptyPages >= 3) {
            stopReason = 'no_cursor';
            warnings.push('Three consecutive timeline pages contained no new posts.');
            break;
        }
    }

    if (!stopReason) stopReason = posts.length >= options.maxPostsPerProfile ? 'target_reached' : 'page_limit';
    const coverageStatus = coverageStatusForStop(stopReason, posts.length);
    return {
        profile,
        posts,
        session,
        coverageStatus,
        stopReason,
        boundaryHit,
        nextCursor: cursor,
        pages,
        warnings,
        unavailablePostsSkipped: unavailablePostKeys.size,
        diagnostics: {
            bootstrapAttempts: bootstrapped.attempts,
            queryAttempts,
            discoveredDocIds: session.docIds,
            discovery: options.debug ? session.discovery : undefined,
            terminalPageError,
        },
    };
}

async function normalizeAndExpand(feed, proxyConfiguration, options) {
    return mapWithConcurrency(feed.posts, options.mediaExpansionConcurrency, async (post, index) => {
        const feedImages = cleanImageUrls(post?.media?.imageUrls || []);
        const shouldExpand = options.expandAllPhotos
            && (mediaSetTokensForPost(post).length > 0 || feedImages.length >= 5);
        let expansion = null;
        if (shouldExpand) {
            try {
                expansion = await expandPostPhotos(post, feed.profile, {
                    client: feed.session.client,
                    proxyConfiguration,
                    retries: options.mediaSetRetries,
                    retryDelayMs: 800,
                });
            } catch (error) {
                expansion = {
                    images: [],
                    rawCount: 0,
                    statusCode: null,
                    source: null,
                    url: null,
                    attempts: [{ error: error.message, code: error.code || null }],
                };
            }
        }
        return normalizeProfilePost(post, index + 1, feed.profile, expansion, {
            retries: options.mediaSetRetries,
            coverageStatus: feed.coverageStatus,
            warnings: feed.warnings,
            includeRawPayload: options.includeRawPayload,
        });
    });
}

async function pushRowsWithinChargeLimit(rows, chargeBudget) {
    let pushedRows = 0;
    let limitReached = false;
    for (let offset = 0; offset < rows.length; offset += 100) {
        const remaining = chargeBudget.remainingRows();
        if (remaining <= 0) {
            limitReached = chargeBudget.resultEventEnabled;
            break;
        }
        const chunkLimit = Number.isFinite(remaining) ? Math.min(100, remaining) : 100;
        const chunk = rows.slice(offset, offset + chunkLimit);
        if (!chunk.length) break;
        const chargeResult = await Actor.pushData(chunk);
        const written = chargeBudget.pushedRows(chunk.length, chargeResult);
        pushedRows += written;
        if (written < chunk.length || chargeBudget.limitReached(chargeResult)) {
            limitReached = true;
            break;
        }
    }
    return { pushedRows, limitReached };
}

await Actor.init();

const startedAt = new Date();
const input = await Actor.getInput() || {};
const chargeBudget = createResultChargeBudget(Actor.getChargingManager());
const targets = readProfileTargets(input);
if (!targets.length) throw new Error('Provide at least one public Facebook personal profile in profileUrls.');

const options = {
    maxProfilesPerRun: integerSetting(input, 'maxProfilesPerRun', 10, 1, 20),
    maxPostsPerProfile: integerSetting(input, 'maxPostsPerProfile', 20, 1, 1000),
    expandAllPhotos: booleanSetting(input, 'expandAllPhotos', true),
    omitPinnedPosts: booleanSetting(input, 'omitPinnedPosts', true),
    includeRawPayload: booleanSetting(input, 'includeRawPayload', false),
    includeUnavailablePosts: booleanSetting(input, 'includeUnavailablePosts', false),
    bootstrapRetries: integerSetting(input, 'bootstrapRetries', 4, 1, 10),
    graphqlPageRetries: integerSetting(input, 'graphqlPageRetries', 4, 0, 5),
    mediaExpansionConcurrency: integerSetting(input, 'mediaExpansionConcurrency', 3, 1, 8),
    mediaSetRetries: integerSetting(input, 'mediaSetRetries', 1, 0, 5),
    proxyCountry: String(input.proxyCountry || 'US').trim().toUpperCase(),
    fallbackProxyCountries: unique((input.fallbackProxyCountries || ['DE', 'GB', 'NL'])
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value) => /^[A-Z]{2}$/.test(value)))
        .slice(0, 3),
    startCursor: typeof input.startCursor === 'string' && input.startCursor.trim() ? input.startCursor.trim() : null,
    debug: booleanSetting(input, 'debug', false),
    boundary: {
        knownPostIds: unique((input.knownPostIds || []).map(String)),
        sinceDate: parseSinceDate(input.sinceDate),
    },
};

const selectedTargets = targets.slice(0, options.maxProfilesPerRun);
const skippedTargets = targets.slice(options.maxProfilesPerRun);
const profileSummaries = [];
const skippedProfilesByChargeLimit = [];
let totalRows = 0;
let chargeLimitReached = false;
let budgetLimited = false;
for (const [targetIndex, target] of selectedTargets.entries()) {
    const effectiveMaxPosts = chargeBudget.capRequestedRows(options.maxPostsPerProfile);
    if (effectiveMaxPosts <= 0) {
        chargeLimitReached = chargeBudget.resultEventEnabled;
        budgetLimited = chargeLimitReached;
        skippedProfilesByChargeLimit.push(
            ...selectedTargets.slice(targetIndex).map((remainingTarget) => remainingTarget.input),
        );
        break;
    }
    const profileOptions = effectiveMaxPosts === options.maxPostsPerProfile
        ? options
        : { ...options, maxPostsPerProfile: effectiveMaxPosts };
    if (effectiveMaxPosts < options.maxPostsPerProfile) budgetLimited = true;

    await Actor.setStatusMessage(`Profile ${targetIndex + 1}/${selectedTargets.length}: ${target.input}`);
    const countryAttempts = [];
    const countries = proxyCountryCandidates(options.proxyCountry, options.fallbackProxyCountries);
    let completed = false;
    let lastError = null;
    for (const [countryIndex, countryCode] of countries.entries()) {
        const proxyConfiguration = await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode,
        });
        try {
            const feed = await collectProfileFeed(target, proxyConfiguration, profileOptions);
            if (effectiveMaxPosts < options.maxPostsPerProfile) {
                feed.stopReason = 'charge_limit';
                feed.coverageStatus = 'partial_charge_limit';
                feed.warnings.push(
                    `Result collection was capped at ${effectiveMaxPosts} posts by the user's maximum run charge.`,
                );
            }
            const rows = await normalizeAndExpand(feed, proxyConfiguration, profileOptions);
            countryAttempts.push({ countryCode, status: 'succeeded' });
            const pushOutcome = await pushRowsWithinChargeLimit(rows, chargeBudget);
            const publishedRows = rows.slice(0, pushOutcome.pushedRows);
            if (publishedRows.length < rows.length) {
                budgetLimited = true;
                feed.stopReason = 'charge_limit';
                feed.coverageStatus = 'partial_charge_limit';
                feed.warnings.push(
                    `Only ${publishedRows.length} of ${rows.length} collected posts fit within the user's maximum run charge.`,
                );
                for (const row of publishedRows) row.coverage_status = 'partial_charge_limit';
            }
            chargeLimitReached ||= pushOutcome.limitReached;
            totalRows += publishedRows.length;
            profileSummaries.push({
                status: feed.coverageStatus.startsWith('partial_') ? 'partial' : 'succeeded',
                input: target.input,
                profile: feed.profile,
                requestedMaxPosts: options.maxPostsPerProfile,
                effectiveMaxPosts,
                postsReturned: publishedRows.length,
                pagesRead: feed.pages,
                stopReason: feed.stopReason,
                coverageStatus: feed.coverageStatus,
                proxyCountryUsed: countryCode,
                countryAttempts,
                boundaryHit: feed.boundaryHit,
                pointer: {
                    direction: 'newest_to_older',
                    nextCursor: feed.nextCursor,
                    useFor: 'historical_backfill_only',
                },
                unavailablePostsSkipped: feed.unavailablePostsSkipped,
                media: {
                    postsWithPhotos: publishedRows.filter((row) => row.media_final_count > 0).length,
                    finalPhotoUrls: publishedRows.reduce((sum, row) => sum + row.media_final_count, 0),
                    expansionAttempted: publishedRows.filter((row) => row.media_expansion?.attempted).length,
                    highReviewRisk: publishedRows.filter((row) => row.media_review_severity === 'high').length,
                },
                warnings: feed.warnings,
                diagnostics: options.debug ? feed.diagnostics : undefined,
            });
            completed = true;
            break;
        } catch (error) {
            lastError = error;
            countryAttempts.push({ countryCode, status: 'failed', error: errorSummary(error) });
            const hasFallback = countryIndex < countries.length - 1;
            if (!hasFallback || !shouldRetryProfileInAnotherCountry(error)) break;
            log.warning(`Retrying profile through ${countries[countryIndex + 1]} after ${error.code}.`, {
                profile: target.input,
                previousCountry: countryCode,
            });
            await sleep(GRAPHQL_RATE_LIMIT_BACKOFF_MS * (countryIndex + 1));
        }
    }
    if (!completed) {
        const error = lastError || new FacebookRequestError('Profile collection failed.', {
            code: 'profile_failed',
            retryable: false,
        });
        log.error(`Profile failed: ${target.input}`, { error: error.message, code: error.code });
        profileSummaries.push({
            status: 'failed',
            input: target.input,
            postsReturned: 0,
            coverageStatus: 'failed',
            error: errorSummary(error),
            countryAttempts,
            diagnostics: options.debug ? error?.details : undefined,
        });
    }
    if (chargeLimitReached && targetIndex < selectedTargets.length - 1) {
        budgetLimited = true;
        skippedProfilesByChargeLimit.push(
            ...selectedTargets.slice(targetIndex + 1).map((remainingTarget) => remainingTarget.input),
        );
        break;
    }
}

const finishedAt = new Date();
const failedProfiles = profileSummaries.filter((item) => item.status === 'failed').length;
const partialProfiles = profileSummaries.filter((item) => item.status === 'partial').length;
const succeededProfiles = profileSummaries.filter((item) => item.status === 'succeeded').length;
const summary = {
    actor: 'facebook-profile-posts-all-photos-scraper',
    version: VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Number(((finishedAt - startedAt) / 1000).toFixed(3)),
    requestedProfiles: targets.length,
    processedProfiles: profileSummaries.length,
    skippedProfilesByLimit: skippedTargets.map((target) => target.input),
    skippedProfilesByChargeLimit,
    succeededProfiles,
    partialProfiles,
    failedProfiles,
    datasetRows: totalRows,
    options: {
        ...options,
        boundary: {
            knownPostIdsCount: options.boundary.knownPostIds.length,
            sinceDate: options.boundary.sinceDate?.iso || null,
        },
    },
    profiles: profileSummaries,
    charging: {
        pricingModel: chargeBudget.pricingModel,
        resultEventEnabled: chargeBudget.resultEventEnabled,
        perResultPriceUsd: chargeBudget.perResultPriceUsd,
        maxTotalChargeUsd: chargeBudget.maxTotalChargeUsd,
        chargeLimitReached,
        budgetLimited,
    },
    health: profileSummaries.length === 0
        ? (budgetLimited || chargeLimitReached ? 'partial' : 'failed')
        : (failedProfiles === profileSummaries.length
            ? 'failed'
            : (failedProfiles || partialProfiles || budgetLimited ? 'partial' : 'healthy')),
};

await Actor.setValue('SUMMARY', summary);
await Actor.setStatusMessage(`${summary.health}: ${totalRows} posts; ${summary.succeededProfiles} complete, ${summary.partialProfiles} partial, ${summary.failedProfiles} failed`);
await Actor.exit();
