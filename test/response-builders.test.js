import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBalancedTopPosts, parseLimit } from '../lib/response-builders.js';

test('parseLimit clamps invalid and out-of-range values', () => {
  assert.equal(parseLimit(undefined, 50), 50);
  assert.equal(parseLimit('0', 50), 1);
  assert.equal(parseLimit('999', 50), 500);
  assert.equal(parseLimit('12.8', 50), 12);
});

test('buildBalancedTopPosts reserves slots across active sources before filling remainder', () => {
  const sources = {
    reddit: { status: 'ok', count: 3 },
    naver: { status: 'ok', count: 2 },
    twitter: { status: 'disabled', count: 0 },
    youtube: { status: 'ok', count: 1 },
    rss: { status: 'ok', count: 2 },
  };

  const posts = [
    { postId: 'r1', title: 'r1', topic: 'AI', source: 'reddit', viewCount: 100, commentCount: 10, scoring: { total: 90, signal: 'DOUBLE_DOWN' }, url: 'r1', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'r2', title: 'r2', topic: 'AI', source: 'reddit', viewCount: 90, commentCount: 9, scoring: { total: 89, signal: 'DOUBLE_DOWN' }, url: 'r2', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'r3', title: 'r3', topic: 'AI', source: 'reddit', viewCount: 80, commentCount: 8, scoring: { total: 88, signal: 'DOUBLE_DOWN' }, url: 'r3', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'n1', title: 'n1', topic: 'Startup', source: 'naver', viewCount: 70, commentCount: 0, scoring: { total: 87, signal: 'DOUBLE_DOWN' }, url: 'n1', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'n2', title: 'n2', topic: 'Startup', source: 'naver', viewCount: 60, commentCount: 0, scoring: { total: 86, signal: 'DOUBLE_DOWN' }, url: 'n2', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'y1', title: 'y1', topic: 'Programming', source: 'youtube', viewCount: 50, commentCount: 5, scoring: { total: 85, signal: 'MAINTAIN' }, url: 'y1', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'rss1', title: 'rss1', topic: 'Programming', source: 'rss', viewCount: 40, commentCount: 0, scoring: { total: 84, signal: 'MAINTAIN' }, url: 'rss1', publishedAt: '2026-03-06T00:00:00Z' },
    { postId: 'rss2', title: 'rss2', topic: 'Programming', source: 'rss', viewCount: 30, commentCount: 0, scoring: { total: 83, signal: 'MAINTAIN' }, url: 'rss2', publishedAt: '2026-03-06T00:00:00Z' },
  ];

  const topPosts = buildBalancedTopPosts(posts, sources);
  const pickedIds = topPosts.map((post) => post.url);

  assert.deepEqual(pickedIds, ['r1', 'r2', 'n1', 'n2', 'y1', 'rss1', 'rss2', 'r3']);
});

