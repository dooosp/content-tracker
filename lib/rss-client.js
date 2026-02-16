import Parser from 'rss-parser';

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

const toErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  return error.message || String(error);
};

const toISODate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const normalizeItem = (item, feedUrl) => {
  const fallbackId = Buffer
    .from(`${feedUrl}:${item.title || ''}:${item.link || ''}`)
    .toString('base64url')
    .slice(0, 40);

  return {
    postId: String(item.guid || item.id || item.link || `rss_${fallbackId}`),
    title: (item.title || '(no title)').trim(),
    url: item.link || item.guid || feedUrl,
    source: 'rss',
    publishedAt: toISODate(item.isoDate || item.pubDate),
    author: item.creator || item.author || '',
    raw: item,
  };
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
        .map(item => normalizeItem(item, feedUrl))
        .filter(item => item.postId && item.url);
      posts.push(...items);
    } catch (error) {
      errors.push({ feed: feedUrl, error: toErrorMessage(error) });
    }
  }

  const seen = new Set();
  const unique = posts.filter(post => {
    const key = `${post.source}:${post.postId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
