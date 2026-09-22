import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.apify.com/v2';
const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [rawKey, inlineValue] = token.slice(2).split('=', 2);
        const next = argv[index + 1];
        if (inlineValue !== undefined) options[rawKey] = inlineValue;
        else if (next && !next.startsWith('--')) {
            options[rawKey] = next;
            index += 1;
        } else options[rawKey] = true;
    }
    return options;
}

async function readToken() {
    if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
    const authPath = path.join(homedir(), '.apify', 'auth.json');
    const auth = JSON.parse(await readFile(authPath, 'utf8'));
    if (!auth.token) throw new Error(`No Apify token found in APIFY_TOKEN or ${authPath}`);
    return auth.token;
}

async function apiRequest(token, pathname, options = {}) {
    const response = await fetch(`${API_BASE}${pathname}`, {
        ...options,
        headers: {
            authorization: `Bearer ${token}`,
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Apify API ${response.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
}

async function waitForRun(token, runId, pollMs) {
    while (true) {
        const payload = await apiRequest(token, `/actor-runs/${encodeURIComponent(runId)}`);
        const run = payload.data;
        if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
        console.log(`[run ${runId}] ${run.status}; ${Math.round((run.stats?.runTimeSecs || 0))}s`);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

async function startRun(token, actorId, input, timeoutSecs) {
    const query = new URLSearchParams({ memory: '1024', timeout: String(timeoutSecs) });
    const payload = await apiRequest(token, `/acts/${encodeURIComponent(actorId)}/runs?${query}`, {
        method: 'POST',
        body: JSON.stringify(input),
    });
    return payload.data;
}

async function getSummary(token, keyValueStoreId) {
    return apiRequest(token, `/key-value-stores/${encodeURIComponent(keyValueStoreId)}/records/SUMMARY`);
}

async function getDatasetItems(token, datasetId) {
    const result = [];
    const limit = 1000;
    for (let offset = 0; ; offset += limit) {
        const query = new URLSearchParams({ clean: 'true', format: 'json', offset: String(offset), limit: String(limit) });
        const batch = await apiRequest(token, `/datasets/${encodeURIComponent(datasetId)}/items?${query}`);
        result.push(...batch);
        if (batch.length < limit) break;
    }
    return result;
}

function postKey(post) {
    if (post.source_post_id) return `id:${post.source_post_id}`;
    if (post.source_url) return `url:${post.source_url}`;
    return `fallback:${post.created_at || ''}:${String(post.raw_text || '').slice(0, 500)}`;
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replaceAll('"', '""')}"`;
}

function sortedPosts(posts) {
    return [...posts].sort((left, right) => {
        const leftTime = Date.parse(left.created_at || '') || 0;
        const rightTime = Date.parse(right.created_at || '') || 0;
        return rightTime - leftTime;
    });
}

function outputPrefixForProfile(profileUrl, explicitPrefix) {
    const candidate = explicitPrefix || (() => {
        const url = new URL(profileUrl);
        if (url.pathname === '/profile.php') return url.searchParams.get('id') || 'facebook-profile';
        return url.pathname.split('/').filter(Boolean).at(-1) || 'facebook-profile';
    })();
    return String(candidate)
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'facebook-profile';
}

async function writeOutputs(outputDir, outputPrefix, posts, state) {
    const ordered = sortedPosts(posts);
    const jsonl = ordered.map((post) => JSON.stringify(post)).join('\n');
    await writeFile(path.join(outputDir, `${outputPrefix}_posts.jsonl`), `${jsonl}${jsonl ? '\n' : ''}`, 'utf8');

    const csvFields = [
        'created_at',
        'creation_time',
        'source_post_id',
        'source_url',
        'source_profile_id',
        'source_profile_name',
        'text_source',
        'raw_text',
    ];
    const csvRows = [csvFields.map(csvCell).join(',')];
    for (const post of ordered) csvRows.push(csvFields.map((field) => csvCell(post[field])).join(','));
    await writeFile(path.join(outputDir, `${outputPrefix}_texts.csv`), `${csvRows.join('\r\n')}\r\n`, 'utf8');

    const markdown = [
        `# ${outputPrefix} Facebook posts`,
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
    ];
    for (const post of ordered.filter((item) => String(item.raw_text || '').trim())) {
        markdown.push(`## ${post.created_at || 'Unknown date'}`);
        markdown.push('');
        if (post.source_url) markdown.push(`[Open Facebook post](${post.source_url})`, '');
        markdown.push(String(post.raw_text).trim(), '');
    }
    await writeFile(path.join(outputDir, `${outputPrefix}_texts.md`), `${markdown.join('\n')}\n`, 'utf8');

    const dates = ordered.map((post) => post.created_at).filter(Boolean);
    const yearCounts = {};
    for (const date of dates) {
        const year = String(date).slice(0, 4);
        yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
    const summary = {
        ...state,
        updatedAt: new Date().toISOString(),
        totalPosts: ordered.length,
        postsWithText: ordered.filter((post) => String(post.raw_text || '').trim()).length,
        postsWithoutText: ordered.filter((post) => !String(post.raw_text || '').trim()).length,
        newestPostAt: dates[0] || null,
        oldestPostAt: dates.at(-1) || null,
        yearCounts,
    };
    await writeFile(path.join(outputDir, 'SUMMARY.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(path.join(outputDir, 'backfill-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function loadExisting(outputDir, outputPrefix) {
    let posts = [];
    let state = null;
    try {
        const lines = (await readFile(path.join(outputDir, `${outputPrefix}_posts.jsonl`), 'utf8'))
            .split(/\r?\n/)
            .filter(Boolean);
        posts = lines.map((line) => JSON.parse(line));
    } catch {}
    try {
        state = JSON.parse(await readFile(path.join(outputDir, 'backfill-state.json'), 'utf8'));
    } catch {}
    return { posts, state };
}

async function ingestRun(token, run, batchIndex, outputDir, postsByKey) {
    if (run.status !== 'SUCCEEDED') throw new Error(`Run ${run.id} ended with ${run.status}`);
    const [items, summary] = await Promise.all([
        getDatasetItems(token, run.defaultDatasetId),
        getSummary(token, run.defaultKeyValueStoreId),
    ]);
    const batchesDir = path.join(outputDir, 'batches');
    await mkdir(batchesDir, { recursive: true });
    const batchName = `batch-${String(batchIndex).padStart(3, '0')}-${run.id}.json`;
    await writeFile(path.join(batchesDir, batchName), `${JSON.stringify({ run, summary, items }, null, 2)}\n`, 'utf8');
    let added = 0;
    for (const item of items) {
        const key = postKey(item);
        if (!postsByKey.has(key)) added += 1;
        postsByKey.set(key, item);
    }
    const profile = summary.profiles?.[0] || {};
    return {
        run,
        summary,
        profile,
        items: items.length,
        added,
        nextCursor: profile.pointer?.nextCursor || null,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const actorId = String(args.actor || 'dh91XwP7wQscfKkxU');
    const profileUrl = String(args.profile || 'https://www.facebook.com/Michaelzuh');
    const outputPrefix = outputPrefixForProfile(profileUrl, args.prefix);
    const outputDir = path.resolve(String(args.output || path.join('outputs', `${outputPrefix}-backfill`)));
    const chunkSize = Math.max(1, Math.min(1000, Number(args.chunk || 1000)));
    const maxTotal = Math.max(1, Number(args['max-total'] || 10000));
    const pollMs = Math.max(3000, Number(args['poll-ms'] || 10000));
    const retryDelayMs = Math.max(10000, Number(args['retry-delay-ms'] || 60000));
    const timeoutSecs = Math.max(300, Number(args.timeout || 7200));
    const proxyCountries = String(args['proxy-countries'] || 'US,DE,GB,NL')
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
    if (!proxyCountries.length) proxyCountries.push('US');
    const token = await readToken();
    await mkdir(outputDir, { recursive: true });

    const existing = await loadExisting(outputDir, outputPrefix);
    const postsByKey = new Map(existing.posts.map((post) => [postKey(post), post]));
    const state = existing.state || {
        actorId,
        profileUrl,
        startedAt: new Date().toISOString(),
        runs: [],
        nextCursor: null,
        complete: false,
        totalUsageUsd: 0,
        retryStreak: 0,
        nextProxyIndex: 0,
    };
    state.retryStreak = Number(state.retryStreak || 0);
    state.nextProxyIndex = Number(state.nextProxyIndex || 0);
    let seedRunId = args['seed-run'] || null;
    if (seedRunId) {
        state.complete = false;
        delete state.completeReason;
    }
    let batchIndex = state.runs.length + 1;
    let noNewBatches = 0;
    const seenCursors = new Set(state.runs.map((item) => item.nextCursor).filter(Boolean));

    while (!state.complete && postsByKey.size < maxTotal) {
        let run;
        if (seedRunId) {
            run = await waitForRun(token, String(seedRunId), pollMs);
            seedRunId = null;
        } else {
            const remaining = Math.min(chunkSize, maxTotal - postsByKey.size);
            const input = {
                profileUrls: [profileUrl],
                maxProfilesPerRun: 1,
                maxPostsPerProfile: remaining,
                expandAllPhotos: false,
                omitPinnedPosts: true,
                graphqlPageRetries: 4,
                proxyCountry: proxyCountries[state.nextProxyIndex % proxyCountries.length],
                debug: false,
            };
            if (state.nextCursor) input.startCursor = state.nextCursor;
            const started = await startRun(token, actorId, input, timeoutSecs);
            console.log(`[run ${started.id}] started batch ${batchIndex}`);
            run = await waitForRun(token, started.id, pollMs);
        }

        const batch = await ingestRun(token, run, batchIndex, outputDir, postsByKey);
        state.runs.push({
            id: run.id,
            status: run.status,
            buildNumber: run.buildNumber,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            usageTotalUsd: run.usageTotalUsd || 0,
            datasetId: run.defaultDatasetId,
            keyValueStoreId: run.defaultKeyValueStoreId,
            items: batch.items,
            added: batch.added,
            stopReason: batch.profile.stopReason || null,
            coverageStatus: batch.profile.coverageStatus || null,
            nextCursor: batch.nextCursor,
        });
        state.totalUsageUsd = state.runs.reduce((sum, item) => sum + Number(item.usageTotalUsd || 0), 0);
        state.nextCursor = batch.nextCursor;
        noNewBatches = batch.added === 0 ? noNewBatches + 1 : 0;

        const terminalReasons = new Set(['feed_exhausted', 'no_public_posts']);
        const partialCoverage = String(batch.profile.coverageStatus || '').startsWith('partial_');
        if (terminalReasons.has(batch.profile.stopReason)) state.complete = true;
        if (!batch.nextCursor && !partialCoverage) state.complete = true;
        if (seenCursors.has(batch.nextCursor) && !partialCoverage) state.complete = true;
        if (partialCoverage) {
            state.retryStreak = Number(state.retryStreak || 0) + 1;
            state.nextProxyIndex = Number(state.nextProxyIndex || 0) + 1;
        } else {
            state.retryStreak = 0;
        }
        if (noNewBatches >= 3 || state.retryStreak >= 5) {
            state.complete = true;
            state.completeReason = 'retry_exhausted';
        }
        if (batch.nextCursor) seenCursors.add(batch.nextCursor);

        await writeOutputs(outputDir, outputPrefix, [...postsByKey.values()], state);
        console.log(
            `[run ${run.id}] ${batch.profile.coverageStatus || 'unknown'}; `
            + `${batch.items} rows, ${batch.added} new, ${postsByKey.size} total, `
            + `$${Number(run.usageTotalUsd || 0).toFixed(4)}`,
        );
        if (partialCoverage && !state.complete) {
            const delay = Math.min(retryDelayMs * state.retryStreak, 300000);
            console.log(`Partial coverage; waiting ${Math.round(delay / 1000)}s before retrying the same boundary.`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
        batchIndex += 1;
    }

    if (postsByKey.size >= maxTotal) state.completeReason = 'max_total_reached';
    else if (state.complete && !state.completeReason) state.completeReason = state.runs.at(-1)?.stopReason || 'cursor_exhausted';
    await writeOutputs(outputDir, outputPrefix, [...postsByKey.values()], state);
    console.log(`Done: ${postsByKey.size} unique posts in ${outputDir}`);
}

main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
});
