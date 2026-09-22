# Output contract

Each default dataset item represents one accessible public Facebook profile post. Timeline cards whose attached content is explicitly deleted or access-restricted are skipped by default. Set `includeUnavailablePosts: true` to return them as diagnostic rows with `text_missing_reason: content_unavailable`.

## Identity and time

| Field | Type | Notes |
| --- | --- | --- |
| `source_profile_id` | string or null | Numeric profile ID resolved from the public route |
| `source_profile_url` | string | Canonical or final public profile URL |
| `source_profile_name` | string or null | Public display name |
| `source_post_id` | string or null | Stable numeric Facebook post ID when exposed |
| `source_url` | string or null | Public post URL or generated profile/post fallback |
| `created_at` | ISO 8601 string or null | Facebook publication time |
| `created_at_source` | string or null | `graphql_creation_time` when present |
| `creation_time` | number or null | Raw Unix timestamp in seconds |

`created_at` is not the scrape timestamp. Run timing is stored in `SUMMARY.startedAt` and `SUMMARY.finishedAt`.

## Text and author

| Field | Type | Notes |
| --- | --- | --- |
| `raw_text` | string | Best recovered post body |
| `text_source` | string | `direct_message`, `fallback_nested_message`, or `missing` |
| `text_missing_reason` | string or null | Diagnostic reason when no body was recovered |
| `text_candidates` | array | Ranked text extraction candidates for audit |
| `author` | object | Public author ID, display name, and profile URL when exposed |

Shared or attachment-style posts can store their useful body below the normal message path. The fallback extractor scores nested message and attachment-title paths while suppressing common Facebook UI labels.

An empty `raw_text` is not automatically an extraction failure. Image-only posts use `text_missing_reason: media_accessibility_caption_only` or `no_message_text`. Deleted/restricted attachment cards use `content_unavailable` and are omitted unless explicitly requested.

## Engagement

`stats` contains `reactions`, `comments`, and `shares`. Each value can be `null` when Facebook omits that counter from the logged-out public payload.

## Photos and video metadata

`media` contains final photo objects only. Every photo includes `source_url`, `thumbnail_url`, `source_media_id`, `source`, and a one-based `index`.

`video_urls` is a separate best-effort array. It contains direct HTTP media URLs extracted from public payloads, not raw XML manifests. The Actor does not download videos.

| Completeness value | Meaning |
| --- | --- |
| `expanded` | Expansion returned at least as many photos as the feed |
| `feed_complete` | Feed photos were retained and no hidden-photo risk was detected |
| `feed_preserved_after_partial_expansion` | Expansion was smaller, so the larger feed set was preserved |
| `likely_incomplete_declared_count` | Facebook declared more album attachments than the Actor recovered after expansion |
| `preview_only_declared_count` | Facebook declared more album attachments, but photo expansion was disabled |
| `likely_incomplete_plusN` | A photo set probably contains more than the recovered URLs |
| `media_set_failed_feed_fallback` | Expansion failed; feed photos remain available |
| `none` | No photos were exposed |

`media_declared_count` stores Facebook's `all_subattachments.count` when exposed. `media_declared_count_satisfied` is `true` when the final recovered URL count meets or exceeds that declaration, `false` when it does not, and `null` when Facebook provided no declared count. Facebook keyframe (`.kf`) assets are excluded because they are animation metadata rather than downloadable photos.

## Coverage

| `coverage_status` | Meaning |
| --- | --- |
| `complete_target_reached` | Requested result limit was reached |
| `complete_until_known_post` | Monitoring stopped at a known ID |
| `complete_until_since_date` | Monitoring reached the date boundary |
| `complete_feed_exhausted` | Facebook reported no older page |
| `no_public_posts` | No public post rows were visible |
| `partial_no_cursor` | Some rows were returned but Facebook did not provide a continuation cursor |
| `partial_stalled_cursor` | Facebook repeated a cursor |
| `partial_page_limit` | Internal safety page limit was reached |
| `partial_error` | Earlier rows were preserved after a later page exhausted its retries |
| `partial_charge_limit` | The caller's maximum run charge reduced the requested rows or stopped later profiles |

Always pair the dataset with `SUMMARY` when a caller needs proof of coverage rather than just rows.

## Charging metadata

`SUMMARY.charging` makes budget-bounded runs explicit:

| Field | Meaning |
| --- | --- |
| `pricingModel` | Active Apify pricing model for the run |
| `resultEventEnabled` | Whether dataset rows are charged as pay-per-event results |
| `perResultPriceUsd` | Price of one result event when available |
| `maxTotalChargeUsd` | User-configured maximum total charge, or `null` when not bounded |
| `chargeLimitReached` | No additional result could be charged at the end of processing |
| `budgetLimited` | Requested coverage was actually reduced by the run budget |

Each profile summary includes `requestedMaxPosts` and `effectiveMaxPosts`. Profiles not started because the remaining result budget was exhausted appear in `SUMMARY.skippedProfilesByChargeLimit`.
