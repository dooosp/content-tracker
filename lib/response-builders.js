import { SOURCE_NAMES } from './sources.js';

const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 500;
const TOP_POST_LIMIT = 10;
const MIN_TOP_POSTS_PER_SOURCE = 2;

export function parseLimit(value, fallback = LIMIT_DEFAULT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.trunc(parsed)));
}

export function toTopPostSummary(post) {
  return {
    title: post.title,
    topic: post.topic,
    source: post.source,
    viewCount: post.viewCount,
    commentCount: post.commentCount,
    score: post.scoring.total,
    signal: post.scoring.signal,
    url: post.url,
    publishedAt: post.publishedAt,
  };
}

export function buildBalancedTopPosts(posts, sources) {
  const picked = new Set();
  const topPosts = [];
  const activeSources = SOURCE_NAMES.filter((source) => sources[source]?.count > 0);

  for (const source of activeSources) {
    const sourcePosts = posts.filter((post) => post.source === source);
    for (const post of sourcePosts.slice(0, MIN_TOP_POSTS_PER_SOURCE)) {
      if (topPosts.length >= TOP_POST_LIMIT) return topPosts;
      picked.add(post.postId);
      topPosts.push(toTopPostSummary(post));
    }
  }

  for (const post of posts) {
    if (topPosts.length >= TOP_POST_LIMIT) break;
    if (picked.has(post.postId)) continue;
    topPosts.push(toTopPostSummary(post));
  }

  return topPosts;
}

export function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

