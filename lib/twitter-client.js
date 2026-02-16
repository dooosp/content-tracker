import { TWITTER } from '../config.js';
import { toErrorMessage } from './utils.js';

const RECENT_SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';
const REQUEST_TIMEOUT_MS = 15000;

const clampMaxResults = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(10, Math.min(100, Math.trunc(parsed)));
};

const buildQuery = (keywords = []) => {
  const terms = keywords
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .map(v => `(${v})`);

  if (terms.length === 0) return '';
  return `${terms.join(' OR ')} -is:retweet`;
};

const normalizeTweet = (tweet, userMap) => {
  const metrics = tweet?.public_metrics || {};
  const user = userMap.get(tweet.author_id);
  const username = user?.username;

  return {
    postId: String(tweet.id),
    title: (tweet.text || '(no text)').replace(/\s+/g, ' ').trim().slice(0, 280),
    url: username
      ? `https://twitter.com/${username}/status/${tweet.id}`
      : `https://twitter.com/i/web/status/${tweet.id}`,
    source: 'twitter',
    viewCount: Number(metrics.impression_count ?? metrics.like_count ?? 0) || 0,
    likeCount: Number(metrics.like_count || 0),
    commentCount: Number(metrics.reply_count || 0),
    publishedAt: tweet.created_at ? new Date(tweet.created_at).toISOString() : undefined,
    author: username || user?.name || '',
    raw: tweet,
  };
};

const apiGetRecentTweets = async ({ bearerToken, query, maxResults }) => {
  const params = new URLSearchParams({
    query,
    max_results: String(maxResults),
    expansions: 'author_id',
    'tweet.fields': 'author_id,created_at,public_metrics',
    'user.fields': 'name,username',
  });

  const url = `${RECENT_SEARCH_URL}?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitter API ${res.status}: ${body.slice(0, 200)}`);
  }

  return await res.json();
};

export async function searchRecentTweets(config = TWITTER) {
  const bearerToken = config?.bearerToken || '';
  if (!bearerToken) {
    throw new Error('TWITTER_BEARER_TOKEN not configured');
  }

  const query = buildQuery(config?.keywords || []);
  if (!query) return [];

  const payload = await apiGetRecentTweets({
    bearerToken,
    query,
    maxResults: clampMaxResults(config?.maxResults),
  });

  const users = payload?.includes?.users || [];
  const userMap = new Map(users.map(u => [u.id, u]));

  const posts = (payload?.data || [])
    .map(tweet => normalizeTweet(tweet, userMap))
    .filter(post => post.postId && post.url);

  const seen = new Set();
  return posts.filter(post => {
    const key = `${post.source}:${post.postId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const twitterClient = {
  async fetchAll(config = TWITTER) {
    try {
      const posts = await searchRecentTweets(config);
      return {
        posts,
        errors: [],
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        posts: [],
        errors: [{ error: toErrorMessage(error) }],
        fetchedAt: new Date().toISOString(),
      };
    }
  },
};

export default twitterClient;
