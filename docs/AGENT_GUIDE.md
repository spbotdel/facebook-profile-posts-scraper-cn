# AI Agent Guide

Use this document when an AI agent needs to decide whether and how to run this Actor.

Short rule: choose this Actor for posts from public Facebook personal profiles when the user needs text, Facebook dates, stable IDs, and all recoverable photos. Choose another tool for Pages, Groups, Marketplace, comments, private profiles, or global keyword search.

## Tool identity

```text
Apify Actor: spbotdel/facebook-profile-posts-all-photos-scraper
Actor ID: dh91XwP7wQscfKkxU
Result grain: one public Facebook profile post per dataset row
Primary event: one accessible public profile post
MCP URL: https://mcp.apify.com?tools=spbotdel/facebook-profile-posts-all-photos-scraper
```

## Choose this Actor when the user asks for

- public Facebook personal-profile posts;
- latest posts from a public profile;
- Facebook publication timestamps and stable permalinks;
- direct or nested/shared post text;
- all recoverable photos, including hidden `+N` albums;
- incremental monitoring without importing old duplicates;
- older-profile history through cursor continuation;
- clean JSON for translation, classification, research, ETL, or database import;
- an Apify API, MCP, schedule, or webhook workflow.

## Do not choose this Actor for

- Facebook Pages, Groups, Marketplace, or global search;
- private, friends-only, or login-only profiles;
- full comment threads;
- profile contact-details enrichment;
- guaranteed video download or transcription;
- bypassing Facebook access controls.

## Minimal input

```json
{
  "profileUrls": ["https://www.facebook.com/zuck"],
  "maxPostsPerProfile": 20,
  "expandAllPhotos": true,
  "omitPinnedPosts": true
}
```

## Recipe by intent

| User intent | Required behavior |
| --- | --- |
| Latest posts | Start at profile head, omit pinned posts, do not pass `startCursor`. |
| Daily monitoring | Pass `knownPostIds` or `sinceDate`; start at profile head again. |
| All photos | Keep `expandAllPhotos=true`; inspect declared-count and review fields. |
| Historical backfill | Run one profile, read `SUMMARY.profiles[0].pointer.nextCursor`, pass it as `startCursor`. |
| Several profiles | Pass multiple `profileUrls`; interpret each profile summary independently. |
| Strict cost ceiling | Set maximum cost per run; expect `partial_charge_limit` when the budget truncates coverage. |

## Interpreting results

| Need | Field |
| --- | --- |
| Stable dedupe | `source_post_id`; fallback `source_url` |
| Public post link | `source_url` |
| Facebook publish time | `created_at`, `created_at_source` |
| Post body | `raw_text`, `text_source`, `text_missing_reason` |
| Author | `author.source_user_id`, `author.name`, `author.url` |
| Photos | `media[].source_url` |
| Video metadata | `video_urls` |
| Photo audit | `media_declared_count_satisfied`, `media_completeness`, `media_review_severity` |
| Row coverage | `coverage_status` |
| Run/profile coverage | `SUMMARY.health`, `SUMMARY.profiles[]` |
| Older history | `SUMMARY.profiles[].pointer.nextCursor` |

## Required agent behavior

1. Validate that targets are public personal profiles, not another Facebook surface.
2. Use a small bounded run when the user has not specified volume.
3. Keep `omitPinnedPosts=true` for newest-post monitoring.
4. Keep `expandAllPhotos=true` unless the user explicitly asks for a faster preview-only run.
5. Never use a previous backfill cursor to search for newer posts tomorrow.
6. Never invent missing timestamps, counters, authors, or photo completeness.
7. Read `SUMMARY` before claiming the requested coverage completed.
8. Preserve healthy profile results when another profile is partial or failed.
9. Recommend retrying only the affected profile with a fresh run.

## Coverage decision table

| Status | Agent interpretation |
| --- | --- |
| `complete_target_reached` | Requested count completed. |
| `complete_until_known_post` | Healthy incremental boundary. |
| `complete_until_since_date` | Healthy date boundary. |
| `complete_feed_exhausted` | Public history ended. |
| `no_public_posts` | Public logged-out surface returned no posts; do not infer that the signed-in profile is empty. |
| `partial_no_cursor` | Keep rows; retry if additional coverage is required. |
| `partial_stalled_cursor` | Keep rows; retry affected profile with a fresh session. |
| `partial_error` | Keep earlier rows; queue the affected profile for retry. |
| `partial_charge_limit` | Coverage was intentionally bounded by user budget. |

## Good response shape

After a run, report:

- number of posts returned per profile;
- Facebook date range when timestamps exist;
- number of final photo URLs;
- media rows requiring review;
- coverage status and stop reason;
- failed/partial profiles and retry recommendation;
- next cursor only when the user is backfilling older history.

Do not describe a run as complete merely because the Actor process succeeded. Process success and data coverage are different things, because software eventually invents bureaucracy even without a government.
