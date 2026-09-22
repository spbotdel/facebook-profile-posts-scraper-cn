# Public Task Page Guide

Public task pages are focused landing pages for concrete jobs. They appear in the Actor's Examples tab and can be discovered by search engines and AI agents.

## Field-selection rule

Expose only the fields required for that task. Hide proxy, retry, debug, and concurrency controls unless the use case explicitly needs them.

Use the `Posts` dataset view for every public task.

## Recommended task pages

### Latest public Facebook profile posts

Slug:

```text
latest-public-facebook-profile-posts
```

SEO title:

```text
Latest public Facebook profile posts
```

SEO description:

```text
Collect the latest public Facebook personal-profile posts with text, timestamps, stable URLs, engagement, and all recoverable photo URLs.
```

Expose: `profileUrls`, `maxPostsPerProfile`, `expandAllPhotos`, `omitPinnedPosts`.

### Facebook profile posts with all photos

Slug:

```text
facebook-profile-posts-with-all-photos
```

SEO title:

```text
Facebook profile posts with all photos
```

SEO description:

```text
Scrape public Facebook profile posts and recover photo URLs hidden behind +N album grids. One structured dataset row per post.
```

Expose: `profileUrls`, `maxPostsPerProfile`, `expandAllPhotos`, `omitPinnedPosts`.

### Daily Facebook profile monitoring

Slug:

```text
daily-facebook-profile-monitoring
```

SEO title:

```text
Daily Facebook profile monitoring
```

SEO description:

```text
Monitor public Facebook personal profiles for new posts and stop at known post IDs or a date boundary without importing old duplicates.
```

Expose: `profileUrls`, `maxPostsPerProfile`, `knownPostIds`, `sinceDate`, `expandAllPhotos`, `omitPinnedPosts`.

### Historical Facebook profile backfill

Slug:

```text
historical-facebook-profile-backfill
```

SEO title:

```text
Historical Facebook profile posts backfill
```

SEO description:

```text
Backfill older public Facebook profile posts in resumable cursor chunks with dates, text, stable URLs, and recoverable photos.
```

Expose: `profileUrls`, `maxPostsPerProfile`, `startCursor`, `expandAllPhotos`.

### Monitor multiple public Facebook profiles

Slug:

```text
monitor-multiple-public-facebook-profiles
```

SEO title:

```text
Monitor multiple public Facebook profiles
```

SEO description:

```text
Collect newest posts from several public Facebook personal profiles with per-profile isolation, stable IDs, timestamps, and photo URLs.
```

Expose: `profileUrls`, `maxProfilesPerRun`, `maxPostsPerProfile`, `knownPostIds`, `expandAllPhotos`, `omitPinnedPosts`.

## Dataset promise

Use this wording consistently:

> One result equals one accessible public Facebook personal-profile post. All photo URLs recovered for that post are included in the same result.

