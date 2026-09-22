# SEO and Recommender Intent Map

Apify Store and Apify MCP discovery behave like intent-based recommenders, not only static keyword indexes. This map keeps the Actor aligned with the jobs humans and agents ask it to perform.

## Primary positioning

**Public Facebook personal-profile posts scraper with all recoverable photo URLs.**

The differentiators are:

- personal profiles rather than Pages or Groups;
- newest-to-older ordering with pinned-post omission;
- Facebook publication timestamps and stable post IDs;
- direct and nested/shared text recovery;
- hidden `+N` album expansion;
- declared media-count audit and explicit completeness states;
- incremental monitoring through known IDs or a date boundary;
- resumable historical cursor backfill;
- deterministic API/MCP output and per-profile diagnostics.

## High-intent searches

| Search or agent intent | Landing-page emphasis |
| --- | --- |
| facebook profile posts scraper | Public personal profiles, one row per post, stable fields. |
| facebook personal profile scraper | Supported URL forms and public-only boundary. |
| scrape public facebook profile posts | Quick start and newest-to-older collection. |
| facebook profile photo scraper | Hidden `+N` album recovery and media audit. |
| facebook profile posts with images | All recoverable photos included with each post row. |
| latest facebook profile posts | Pinned omission, `knownPostIds`, and `sinceDate`. |
| monitor public facebook profiles | Schedules, stop boundaries, idempotent database import. |
| facebook profile historical posts | Cursor backfill and `SUMMARY.pointer.nextCursor`. |
| facebook profile scraper api | REST, JavaScript, Python, Dataset, and SUMMARY examples. |
| facebook profile scraper mcp | Explicit Actor identity, agent prompts, and selection contract. |
| facebook profile post timestamps | `created_at` provenance and scrape-time distinction. |
| facebook profile posts json export | Normalized dataset and export formats. |

## Negative intents

| Intent | Correct routing |
| --- | --- |
| Facebook Page posts | Use a Page-post Actor. |
| Facebook group posts | Use the related group-post Actor. |
| Facebook Marketplace | Use a Marketplace Actor. |
| global Facebook keyword search | Use a search Actor. |
| Facebook comments scraper | Use a comments Actor after collecting post URLs. |
| private Facebook profile scraper | Unsupported. |
| Facebook video downloader | Unsupported product guarantee. |

## Recommender signals to improve over time

- successful runs from distinct users;
- repeat users and scheduled monitoring runs;
- low failed-run rate and quick issue responses;
- clear input descriptions and useful defaults;
- coherent README, input schema, output schema, and pricing language;
- public task pages for specific use cases;
- links from GitHub, documentation, tutorials, and external content;
- ratings from real repeat users, never manufactured activity.

