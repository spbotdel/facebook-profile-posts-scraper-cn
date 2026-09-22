# Operations guide

## Recurring newest-post monitoring

1. Start every scheduled run from the profile URL without `startCursor`.
2. Pass a small set of newest stored `source_post_id` values as `knownPostIds`.
3. Import rows with a unique key on `(source_profile_id, source_post_id)`.
4. Advance your application watermark only when that profile reports a complete coverage status.
5. Retry failed profiles independently. Do not discard successful rows from other profiles.

The Actor processes profiles independently and writes successful rows immediately after each profile completes.

For pay-per-event runs, the Actor also respects Apify's user-configured maximum run charge. It caps `maxPostsPerProfile` before collecting a profile and stops before later profiles when no paid result capacity remains. Inspect `SUMMARY.charging.budgetLimited` and `SUMMARY.skippedProfilesByChargeLimit`; keep the previous watermark for any profile with `partial_charge_limit`.

`SUMMARY.profiles[].unavailablePostsSkipped` counts unique timeline cards whose attached Facebook content was explicitly deleted or access-restricted. These cards are skipped by default and do not consume `maxPostsPerProfile`. Enable `includeUnavailablePosts` only for an audit that needs their IDs and timestamps.

## Historical backfill

`SUMMARY.profiles[].pointer.nextCursor` moves from newer posts to older posts. Use it only to continue a historical backfill for the same profile.

A Facebook cursor is opaque and can expire. If an older-history cursor stops working, restart from the profile head with a larger bounded limit and deduplicate by post ID.

### Checkpointed export runner

The repository includes `scripts/backfill-profile.mjs` for long, resumable exports through the Apify API:

```bash
npm run backfill:profile -- \
  --profile "https://www.facebook.com/example.profile" \
  --output "./outputs/example-profile" \
  --chunk 1000 \
  --max-total 10000 \
  --proxy-countries US,DE,GB,NL
```

The runner persists `backfill-state.json` after every successful batch and generates:

- `*_posts.jsonl` with complete normalized rows;
- `*_texts.csv` and `*_texts.md` for text-and-date analysis;
- `batches/` snapshots for audit and recovery;
- `SUMMARY.json` with run IDs, spend, coverage, cursor, and year counts.

Pass `--seed-run RUN_ID` to import an already completed Actor run without paying for another scrape. A run is considered complete only when the Actor reports a complete coverage status such as `complete_feed_exhausted`; a partial run without a cursor is retried instead of silently truncating history.

Do not stop a deep backfill merely because several pages add no new rows. Facebook can expose a long duplicate or non-post tail before `has_next_page` becomes false. Use the explicit coverage status and keep a cost/time ceiling outside the Actor if your workflow requires one.

## Failure codes

| Code | Meaning | Recommended action |
| --- | --- | --- |
| `rate_limited` | Facebook returned error `1675004` or HTTP 429 | Retry the failed profile later; the Actor already rotates several sessions in-run |
| `login_wall` | Logged-out public content was not exposed | Confirm the profile is public; do not provide or bypass credentials |
| `profile_not_found` | Route returned 404 | Verify the URL or numeric profile ID |
| `profile_unavailable` | Facebook marked content unavailable | Treat as inaccessible or removed |
| `profile_id_missing` | Public route could not be resolved | Capture debug diagnostics and report an issue |
| `graphql_query_failed` | Current query documents produced no usable feed | Rebuild with refreshed document IDs or use dynamic bundle discovery diagnostics |
| `page_failed` | Timeline page exhausted its bounded retries | Retry only that profile from the profile head or saved backfill cursor |

For profile-level transient failures, the Actor first rotates sessions in `proxyCountry`, then tries the bounded `fallbackProxyCountries` list. `SUMMARY.profiles[].proxyCountryUsed` records the successful country and `countryAttempts` records each country-level outcome. Permanent privacy and login failures are not retried across countries.

## Debugging

Set `debug: true` for a bounded test. `SUMMARY.profiles[].diagnostics` then includes:

- bootstrap HTTP status, final URL, resolved profile ID, and session identifier;
- HTML prefetch extraction counts;
- GraphQL query name, document ID source, response size, post count, cursor state, and Facebook errors;
- a short response preview for failed or unusual query shapes;
- dynamically discovered document IDs.

Do not leave `includeRawPayload` or `debug` enabled for large routine runs unless you need them. They increase storage and make summaries much larger.

If users specifically need deleted/restricted timeline-card diagnostics, set `includeUnavailablePosts: true`. Normal monitoring should leave it disabled so an inaccessible share cannot displace an accessible post from the requested result count.

## Media handling

Photo expansion first tries each public `mediaset_token`, then a post-permalink fallback for suspicious five-image previews. The larger of feed and expanded photo sets wins.

CDN URLs may expire. A downstream pipeline that needs durable media should download promptly, validate HTTP status and content type, and store its own media checksum.

## Health policy

- Import rows from profiles with `status: succeeded` or `status: partial`; keep the previous watermark for partial coverage.
- Queue only failed profiles for retry.
- Treat `coverage_status` beginning with `complete_` as a safe boundary for advancing that profile's watermark.
- Keep the previous watermark for `partial_*`, `no_public_posts` when unexpected, and `failed`.
- A `partial_charge_limit` is not a Facebook failure. Increase the run charge limit or split profiles into separate runs, then retry from the profile head with the same known-ID boundary.
