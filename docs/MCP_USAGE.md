# MCP and API Usage

This Actor is designed for Apify Console, REST API, JavaScript/Python clients, CLI, schedules, webhooks, and Apify MCP.

## Actor identity

```text
Store slug: spbotdel/facebook-profile-posts-all-photos-scraper
Actor ID: dh91XwP7wQscfKkxU
Store URL: https://apify.com/spbotdel/facebook-profile-posts-all-photos-scraper
```

## Connect through the hosted Apify MCP server

Use a tool-scoped MCP URL so an agent sees this Actor directly instead of searching the full Store:

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com?tools=spbotdel/facebook-profile-posts-all-photos-scraper"
    }
  }
}
```

Authenticate through the MCP client's Apify OAuth flow when prompted, or configure the server with an Apify token where the client supports header-based authentication.

## Natural-language MCP prompts

Use prompts that identify the Facebook surface, volume, ordering, and desired fields:

```text
Use spbotdel/facebook-profile-posts-all-photos-scraper to collect the latest
20 public posts from https://www.facebook.com/zuck. Include Facebook publish
time, text, post URL, author, engagement, and all recoverable photo URLs.
Read SUMMARY and report whether coverage completed.
```

```text
Monitor these public Facebook personal profiles. Start from the newest posts,
omit pinned posts, and stop at these known post IDs. Return only new rows.
Keep successful profiles even if another profile is partial.
```

```text
Backfill up to 1,000 older public posts from this Facebook personal profile.
Return the dataset ID and SUMMARY.profiles[0].pointer.nextCursor for the next chunk.
```

## Start a run with REST API

```bash
curl "https://api.apify.com/v2/acts/spbotdel~facebook-profile-posts-all-photos-scraper/runs?token=$APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrls": ["https://www.facebook.com/zuck"],
    "maxPostsPerProfile": 20,
    "expandAllPhotos": true,
    "omitPinnedPosts": true
  }'
```

The response contains `defaultDatasetId` and `defaultKeyValueStoreId`.

## Read results

```bash
curl "https://api.apify.com/v2/datasets/DATASET_ID/items?clean=true&format=json"
```

```bash
curl "https://api.apify.com/v2/key-value-stores/STORE_ID/records/SUMMARY"
```

An agent should read both. Dataset rows contain posts; `SUMMARY` contains evidence about coverage, retries, charge boundaries, and the next older-history cursor.

## Required post-run validation

An agent must not treat `SUCCEEDED` as proof that every requested profile was fully covered. After each run:

1. Read the default dataset and the `SUMMARY` key-value-store record.
2. Check every `SUMMARY.profiles[].coverageStatus` and its stop reason.
3. Preserve healthy profile rows when another profile is partial; retry only the affected profile.
4. Review rows where `media_declared_count_satisfied=false`, `media_plus_n_risk=true`, or `media_review_severity` is `medium` or `high`.
5. Persist `source_post_id` values for future monitoring, or `pointer.nextCursor` only for an older-history backfill.
6. Report partial coverage honestly. A green process badge is not a notarized statement from Facebook, despite the interface's optimism.

## Node.js client

```js
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const run = await client.actor('spbotdel/facebook-profile-posts-all-photos-scraper').call({
    profileUrls: ['https://www.facebook.com/zuck'],
    maxPostsPerProfile: 20,
    expandAllPhotos: true,
    omitPinnedPosts: true,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
const summary = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord('SUMMARY');

console.log({ posts: items.length, summary: summary?.value });
```

## Python client

```python
import os
from apify_client import ApifyClient

client = ApifyClient(os.environ['APIFY_TOKEN'])
run = client.actor('spbotdel/facebook-profile-posts-all-photos-scraper').call(run_input={
    'profileUrls': ['https://www.facebook.com/zuck'],
    'maxPostsPerProfile': 20,
    'expandAllPhotos': True,
    'omitPinnedPosts': True,
})

posts = client.dataset(run['defaultDatasetId']).list_items(clean=True).items
summary = client.key_value_store(run['defaultKeyValueStoreId']).get_record('SUMMARY')
print({'posts': len(posts), 'summary': summary.get('value') if summary else None})
```

## Monitoring state

Persist these values outside the Actor:

- newest stored `source_post_id` values for recurring monitoring;
- unique constraint on `source_post_id` or `source_url` in the destination database;
- `nextCursor` only for an active older-history backfill;
- the last `SUMMARY` for operational audit.

For new posts, start from the profile head every time. For old posts, continue with the cursor. Reversing those two is how a crawler becomes an archaeology department by accident.
