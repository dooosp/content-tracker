import Parser from 'rss-parser';
import { normalizeRssItem } from './normalizer/article-normalizer.js';
import { dedupeBy, toErrorMessage } from './utils.js';

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'content-tracker/1.0',
  },
});

const clampItemsPerFeed = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(30, Math.trunc(parsed)));
};

const fetchFeedsWithMeta = async (config = {}) => {
  const feeds = (config?.feeds || [])
    .map(v => String(v || '').trim())
    .filter(Boolean);

  if (feeds.length === 0) {
    return {
      posts: [],
      errors: [{ error: 'No RSS feeds configured' }],
      fetchedAt: new Date().toISOString(),
    };
  }

  const maxItemsPerFeed = clampItemsPerFeed(config?.maxItemsPerFeed);
  const posts = [];
  const errors = [];

  for (const feedUrl of feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const items = (feed.items || [])
        .slice(0, maxItemsPerFeed)
        .map(item => normalizeRssItem(item, feedUrl))
        .filter(item => item.postId && item.url);
      posts.push(...items);
    } catch (error) {
      errors.push({ feed: feedUrl, error: toErrorMessage(error) });
    }
  }

  const unique = dedupeBy(posts, (post) => `${post.source}:${post.postId}`);

  return {
    posts: unique,
    errors,
    fetchedAt: new Date().toISOString(),
  };
};

export async function fetchFeeds(config = {}) {
  const result = await fetchFeedsWithMeta(config);
  return result.posts;
}

const rssClient = {
  fetchAll: fetchFeedsWithMeta,
};

export default rssClient;
