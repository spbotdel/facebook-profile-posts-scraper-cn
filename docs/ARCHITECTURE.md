# Architecture

```text
profile URL or ID
    |
    v
public route resolution -> numeric profile ID
    |
    v
logged-out HTML bootstrap -> cookies, LSD token, prefetched feed
    |
    v
ProfileCometTimelineFeedQuery / RefetchQuery
    |
    +-> bounded session rotation on rate limit or transient failure
    |
    v
post parser -> text, time, author, IDs, stats, media tokens
    |
    v
boundary filter -> knownPostIds / sinceDate / requested limit
    |
    v
pay-per-event budget cap -> effective per-profile result limit
    |
    v
photo expansion -> media set -> permalink fallback -> preserve larger set
    |
    v
normalized dataset rows + per-profile SUMMARY
```

## Runtime properties

- Direct HTTP requests through `got-scraping`; no Playwright browser.
- Logged-out public Facebook session; no user cookies or Facebook credentials.
- Apify residential proxy sessions with bounded rotation.
- Per-profile failure isolation.
- Newest-to-older cursor pagination.
- Dataset rows are the pay-per-event billable result unit; the charging manager caps paid work before feed and album processing.

## Main modules

| Module | Responsibility |
| --- | --- |
| `src/facebook.js` | Profile target normalization, bootstrap tokens, route resolution, document-ID discovery, GraphQL request encoding |
| `src/postParser.js` | Recursive post extraction, nested/shared text recovery, media signals, timeline page-info selection, monitoring boundaries |
| `src/mediaExpansion.js` | Public album/permalink fetches, final photo selection, normalized output rows |
| `src/mediaQuality.js` | Completeness and review-risk classification |
| `src/proxySession.js` | Apify-compatible proxy session IDs |
| `src/charging.js` | Pay-per-event budget calculation and result-limit accounting |
| `src/main.js` | Actor lifecycle, retries, per-profile orchestration, dataset and SUMMARY output |

## Maintenance points

Facebook can rotate persisted GraphQL document IDs or add required Relay provider variables. The Actor uses both known fallback IDs and bundle discovery. If a query shape changes:

1. Run one profile with `debug: true` and a small post limit.
2. Inspect GraphQL errors and response previews in `SUMMARY`.
3. Refresh fallback IDs only after confirming the query name and response shape.
4. Add a parser fixture before deploying the change.
5. Re-run both a normal feed and an album-heavy profile.

The implementation was written independently. Public open-source projects were used as protocol research references; third-party source code was not copied into this repository.
