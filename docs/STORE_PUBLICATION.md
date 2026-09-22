# Store publication checklist

Technical release target: Actor `spbotdel/facebook-profile-posts-all-photos-scraper`, build tag `latest`, version `1.0.x`.

Current verified release: build `1.0.4`, tagged `latest` on 2026-07-12.

## Monetization

Configure this once in Apify Console:

1. Select **Pay per event**.
2. Keep **Pay per event + usage** disabled so platform usage is included.
3. Keep the synthetic Actor-start event at `$0.00005`.
4. Configure the default dataset item event:
   - title: `Facebook profile post`
   - description: `One accessible public Facebook profile post with text, timestamp, author, engagement, stable URL, and all recoverable photo URLs.`
   - price: `$0.00499` per result (`$4.99 / 1,000`)
5. Select **Facebook profile post** as the primary event.
6. Do not add custom events.

The code uses Apify's default dataset-item event and stops paid work when the caller's maximum run charge is exhausted.

## Store fields

- Title: `Facebook Profile Posts & All Photos Scraper`
- SEO title: `Facebook Profile Posts Scraper with All Photos`
- SEO description: `Scrape public Facebook personal-profile posts with text, dates, stable URLs, engagement, and all recoverable photos. Agent-ready API/MCP output.`
- Categories: `Social media`, `MCP servers`, `Automation`
- Support: `spbotdel@gmail.com`
- Source repository: `https://github.com/spbotdel/-facebook-profile-posts-scraper`

Upload a distinct square icon that does not use Facebook's official logo, review the README preview, accept the Store terms, and publish.

## Public task examples

Five saved tasks are prepared for the Actor. Publish them from each task's **Publication** tab because the public landing-page configuration is not exposed by the documented Actor Tasks API.

Use the exact titles, descriptions, visible fields, and `Posts` dataset view from [`TASK_PAGE_GUIDE.md`](TASK_PAGE_GUIDE.md).

Prepared task slugs:

- `latest-public-facebook-profile-posts`
- `facebook-profile-posts-with-all-photos`
- `daily-facebook-profile-monitoring`
- `historical-facebook-profile-backfill`
- `monitor-multiple-public-facebook-profiles`

After publication, verify that all five appear in the Actor's **Examples** tab and that their public URLs match the links in the README.

## Store discounts

Store discounts are tier-specific prices for the same result event, not coupons or monthly subscriptions. Enable them only after checking the current paid-user cost distribution. Apply discounts to the `Facebook profile post` result event, not to the synthetic Actor-start event.

Keep every tier price high enough that `(0.8 * event revenue) - platform costs` remains non-negative for the intended run sizes. Small one-result runs have proportionally higher startup overhead and should be included in that audit.

## Post-publication customer smoke test

Run from a separate Apify account with a low maximum charge:

```json
{
  "profileUrls": [
    "https://www.facebook.com/lam.tp.chien.phuong",
    "https://www.facebook.com/trang.phan.298890"
  ],
  "maxPostsPerProfile": 5,
  "expandAllPhotos": true
}
```

Expected checks:

- billed dataset rows equal returned dataset rows;
- `SUMMARY.charging.resultEventEnabled` is `true`;
- a low run charge produces `partial_charge_limit` instead of unpaid work;
- the run uses the `latest` 1.0.x build with 1024 MB memory;
- sampled `media[].source_url` values return image content.
