import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createServer, startServer } = require('server-base');

import { REDDIT, NAVER, SERVER_PORT } from './config.js';
import redditClient from './lib/reddit-client.js';
import naverClient from './lib/naver-client.js';
import contentAnalyzer from './lib/content-analyzer.js';
import contentScorer from './lib/content-scorer.js';
import strategyAdvisor from './lib/strategy-advisor.js';
import snapshotStore from './lib/snapshot-store.js';

const app = createServer({
  name: 'content-tracker',
  jsonLimit: '1mb',
  health: (req, res) => {
    res.json({
      status: 'ok',
      service: 'content-tracker',
      port: SERVER_PORT,
      uptime: process.uptime(),
      hasData: !!cache.data,
      sources: {
        reddit: `${REDDIT.subreddits.length} subs`,
        naver: NAVER.clientId ? `${NAVER.keywords.length} keywords` : 'no_api_key',
      },
    });
  },
});

/** 캐시 (API rate limit 보호) */
let cache = { data: null, fetchedAt: null };
const CACHE_TTL = 15 * 60 * 1000; // 15분

async function getData(forceRefresh = false) {
  if (!forceRefresh && cache.data && (Date.now() - cache.fetchedAt) < CACHE_TTL) {
    return cache.data;
  }

  // Reddit + Naver 병렬 수집
  const [reddit, naver] = await Promise.allSettled([
    redditClient.fetchAll(),
    naverClient.fetchAll(),
  ]);

  const allPosts = [];
  const sources = { reddit: 0, naver: 0, errors: [] };

  if (reddit.status === 'fulfilled') {
    allPosts.push(...reddit.value.posts);
    sources.reddit = reddit.value.posts.length;
    sources.errors.push(...(reddit.value.errors || []));
  } else {
    sources.errors.push({ source: 'reddit', error: reddit.reason?.message });
  }

  if (naver.status === 'fulfilled') {
    allPosts.push(...naver.value.posts);
    sources.naver = naver.value.posts.length;
    sources.errors.push(...(naver.value.errors || []));
  } else {
    sources.errors.push({ source: 'naver', error: naver.reason?.message });
  }

  if (allPosts.length === 0) {
    throw new Error('No data from any source');
  }

  const store = await snapshotStore.load();
  const snapshotMap = snapshotStore.buildSnapshotMap(store.snapshots || []);

  const scored = contentScorer.scoreAll(allPosts, { snapshotMap });
  const trends = contentAnalyzer.analyzeAll(allPosts, snapshotMap);
  const { signals, portfolio } = strategyAdvisor.generateSignals(scored);

  const result = {
    sources,
    posts: scored,
    trends,
    signals,
    portfolio,
    fetchedAt: new Date().toISOString(),
  };

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}

// GET /api/content/overview — 소스별 요약 + 상위 포스트
app.get('/api/content/overview', async (req, res) => {
  try {
    const data = await getData();
    const top10 = data.posts.slice(0, 10).map(p => ({
      title: p.title,
      topic: p.topic,
      source: p.source,
      viewCount: p.viewCount,
      commentCount: p.commentCount,
      score: p.scoring.total,
      signal: p.scoring.signal,
      url: p.url,
      publishedAt: p.publishedAt,
    }));

    res.json({
      sources: data.sources,
      topPosts: top10,
      totalPosts: data.posts.length,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/signals — 전략 시그널 + 토픽 포트폴리오
app.get('/api/content/signals', async (req, res) => {
  try {
    const data = await getData();
    res.json({
      signals: data.signals,
      portfolio: data.portfolio,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/content/trends — 포스트별 추세 분석
app.get('/api/content/trends', async (req, res) => {
  try {
    const data = await getData();
    res.json({
      trends: data.trends,
      totalPosts: data.trends.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/content/refresh — 수동 데이터 갱신 + 스냅샷 저장
app.post('/api/content/refresh', async (req, res) => {
  try {
    const data = await getData(true);

    // 스냅샷 저장
    const store = await snapshotStore.load();
    const today = new Date().toISOString().slice(0, 10);
    const existing = (store.snapshots || []).filter(s => s.date !== today);

    existing.push({
      date: today,
      posts: data.posts.map(p => ({
        postId: p.postId,
        viewCount: p.viewCount,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
      })),
    });

    // 최근 90일만 유지
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const filtered = existing.filter(s => s.date >= cutoff);

    await snapshotStore.save({ snapshots: filtered, lastFetch: data.fetchedAt });

    res.json({
      message: 'Data refreshed',
      sources: data.sources,
      postCount: data.posts.length,
      snapshotCount: filtered.length,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

startServer(app, SERVER_PORT, {
  name: 'content-tracker',
}).then(() => {
  console.log(`[content-tracker] Reddit: ${REDDIT.subreddits.length} subs | Naver: ${NAVER.clientId ? NAVER.keywords.length + ' keywords' : 'no keys'}`);
});
