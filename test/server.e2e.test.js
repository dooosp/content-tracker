import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../server.js';

function createTestData() {
  return {
    sources: {
      reddit: { status: 'ok', count: 2 },
      naver: { status: 'ok', count: 1 },
      twitter: { status: 'disabled', count: 0 },
      youtube: { status: 'disabled', count: 0 },
      rss: { status: 'ok', count: 1 },
    },
    posts: [
      {
        postId: 'reddit-1',
        title: 'Reddit A',
        topic: 'AI',
        source: 'reddit',
        viewCount: 100,
        commentCount: 10,
        url: 'https://example.com/reddit-a',
        publishedAt: '2026-03-06T00:00:00.000Z',
        scoring: { total: 90, signal: 'DOUBLE_DOWN' },
      },
      {
        postId: 'reddit-2',
        title: 'Reddit B',
        topic: 'AI',
        source: 'reddit',
        viewCount: 90,
        commentCount: 9,
        url: 'https://example.com/reddit-b',
        publishedAt: '2026-03-06T00:00:00.000Z',
        scoring: { total: 80, signal: 'MAINTAIN' },
      },
      {
        postId: 'naver-1',
        title: 'Naver A',
        topic: 'Startup',
        source: 'naver',
        viewCount: 80,
        commentCount: 0,
        url: 'https://example.com/naver-a',
        publishedAt: '2026-03-06T00:00:00.000Z',
        scoring: { total: 70, signal: 'MAINTAIN' },
      },
      {
        postId: 'rss-1',
        title: 'RSS A',
        topic: 'Programming',
        source: 'rss',
        viewCount: 70,
        commentCount: 0,
        url: 'https://example.com/rss-a',
        publishedAt: '2026-03-06T00:00:00.000Z',
        scoring: { total: 60, signal: 'MAINTAIN' },
      },
    ],
    items: [
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ],
    trends: [
      { title: 'Trend A' },
      { title: 'Trend B' },
      { title: 'Trend C' },
    ],
    signals: [{ type: 'DOUBLE_DOWN', topic: 'AI' }],
    portfolio: [{ topic: 'AI', videoCount: 2, share: 50 }],
    fetchedAt: '2026-03-06T00:00:00.000Z',
  };
}

async function withServer(options, run) {
  const built = buildApp(options);
  const server = await new Promise((resolve) => {
    const instance = built.app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, built);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('GET /health returns configured source states without cache', async () => {
  const fakeService = {
    hasCachedData: () => false,
    getCachedData: () => null,
    isRefreshing: () => false,
    getData: async () => createTestData(),
    refreshAndSnapshot: async () => ({ data: createTestData(), snapshot: { snapshotId: 'snap-1', path: '/tmp/snap-1' } }),
  };

  await withServer({
    contentService: fakeService,
    configuredSourceStates: createTestData().sources,
    geminiApiKey: '',
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.sources.reddit.count, 2);
    assert.equal(body.cron.enabled, true);
  });
});

test('GET /api/content/overview and /api/content/trends apply limits', async () => {
  const data = createTestData();
  const fakeService = {
    hasCachedData: () => true,
    getCachedData: () => data,
    isRefreshing: () => false,
    getData: async () => data,
    refreshAndSnapshot: async () => ({ data, snapshot: { snapshotId: 'snap-1', path: '/tmp/snap-1' } }),
  };

  await withServer({
    contentService: fakeService,
    configuredSourceStates: data.sources,
    geminiApiKey: '',
  }, async (baseUrl) => {
    const overviewResponse = await fetch(`${baseUrl}/api/content/overview?limit=2`);
    const overviewBody = await overviewResponse.json();
    const trendsResponse = await fetch(`${baseUrl}/api/content/trends?limit=1`);
    const trendsBody = await trendsResponse.json();

    assert.equal(overviewResponse.status, 200);
    assert.equal(overviewBody.items.length, 2);
    assert.equal(overviewBody.topPosts.length, 4);
    assert.equal(trendsResponse.status, 200);
    assert.equal(trendsBody.trends.length, 1);
  });
});

test('GET /api/content/ideas returns 501 without API key and success with injected generator', async () => {
  const data = createTestData();
  const fakeService = {
    hasCachedData: () => true,
    getCachedData: () => data,
    isRefreshing: () => false,
    getData: async () => data,
    refreshAndSnapshot: async () => ({ data, snapshot: { snapshotId: 'snap-1', path: '/tmp/snap-1' } }),
  };

  await withServer({
    contentService: fakeService,
    configuredSourceStates: data.sources,
    geminiApiKey: '',
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/content/ideas`);
    const body = await response.json();

    assert.equal(response.status, 501);
    assert.equal(body.error, 'GEMINI_API_KEY not configured');
  });

  await withServer({
    contentService: fakeService,
    configuredSourceStates: data.sources,
    geminiApiKey: 'test-key',
    ideaGenerator: async () => ({
      trends: [{ title: 'AI Trend' }],
      ideas: [{ title: 'Build X' }],
      gaps: [{ topic: 'Gap Y' }],
      cached: false,
      generatedAt: '2026-03-06T00:00:00.000Z',
    }),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/content/ideas`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.trends[0].title, 'AI Trend');
    assert.equal(body.ideas[0].title, 'Build X');
  });
});

test('POST /api/content/refresh returns snapshot metadata and handles in-progress state', async () => {
  const data = createTestData();
  const fakeSnapshotStore = {
    load: async () => ({ snapshots: [{ id: 'snap-1' }, { id: 'snap-2' }] }),
  };

  await withServer({
    contentService: {
      hasCachedData: () => true,
      getCachedData: () => data,
      isRefreshing: () => false,
      getData: async () => data,
      refreshAndSnapshot: async () => ({
        data,
        snapshot: { snapshotId: 'snap-3', path: '/tmp/snap-3' },
      }),
    },
    configuredSourceStates: data.sources,
    geminiApiKey: '',
    snapshotStore: fakeSnapshotStore,
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/content/refresh`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshotCount, 2);
    assert.equal(body.snapshotId, 'snap-3');
  });

  await withServer({
    contentService: {
      hasCachedData: () => false,
      getCachedData: () => null,
      isRefreshing: () => true,
      getData: async () => data,
      refreshAndSnapshot: async () => {
        const error = new Error('already refreshing');
        error.code = 'REFRESH_IN_PROGRESS';
        throw error;
      },
    },
    configuredSourceStates: data.sources,
    geminiApiKey: '',
    snapshotStore: fakeSnapshotStore,
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/content/refresh`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error, 'already refreshing');
  });
});

