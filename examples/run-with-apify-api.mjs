import { ApifyClient } from 'apify-client';

const token = process.env.APIFY_TOKEN;
if (!token) throw new Error('Set APIFY_TOKEN before running this example.');

const client = new ApifyClient({ token });
const actorId = 'spbotdel/facebook-profile-posts-all-photos-scraper';

const run = await client.actor(actorId).call({
    profileUrls: ['https://www.facebook.com/zuck'],
    maxPostsPerProfile: 20,
    expandAllPhotos: true,
    omitPinnedPosts: true,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
const summaryRecord = await client.keyValueStore(run.defaultKeyValueStoreId).getRecord('SUMMARY');

console.log(JSON.stringify({
    runId: run.id,
    datasetId: run.defaultDatasetId,
    posts: items.length,
    summary: summaryRecord?.value ?? null,
}, null, 2));
