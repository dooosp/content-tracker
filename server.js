import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createServer, startServer } = require('server-base');
import cron from 'node-cron';

import {
  REDDIT,
  NAVER,
  TWITTER,
  YOUTUBE,
  RSS_FEEDS,
  GEMINI_API_KEY,
  SERVER_PORT,
  CACHE_TTL_MS,
} from './config.js';
import redditClient from './lib/reddit-client.js';
import naverClient from './lib/naver-client.js';
import twitterClient from './lib/twitter-client.js';
import youtubeClient from './lib/youtube-client.js';
import rssClient from './lib/rss-client.js';
import contentAnalyzer from './lib/content-analyzer.js';
import contentScorer from './lib/content-scorer.js';
import strategyAdvisor from './lib/strategy-advisor.js';
import snapshotStore from './lib/snapshot-store.js';
import { generateIdeas } from './lib/idea-generator.js';
import { toErrorMessage } from './lib/utils.js';

const SOURCE_NAMES = ['reddit', 'naver', 'twitter', 'youtube', 'rss'];
const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

const asBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const CRON_ENABLED = asBool(process.env.CRON_ENABLED, true);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 */4 * * *';
const CRON_TZ = process.env.CRON_TZ || 'Asia/Seoul';

const parseLimit = (value, fallback = LIMIT_DEFAULT) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.trunc(parsed)));
};

const sendError = (res, status, message) => {
  res.status(status).json({ error: message });
};

const summarizeErrors = (errors = []) => {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  return errors
    .map(err => err?.error || err?.message || String(err))
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');
};

const emptySourceStates = () => ({
  reddit: { status: 'disabled', count: 0 },
  naver: { status: 'disabled', count: 0 },
  twitter: { status: 'disabled', count: 0 },
  youtube: { status: 'disabled', count: 0 },
  rss: { status: 'disabled', count: 0 },
});

const configuredSourceStates = () => ({
  reddit: { status: REDDIT.subreddits.length > 0 ? 'ok' : 'disabled', count: 0 },
  naver: { status: (NAVER.clientId && NAVER.clientSecret && NAVER.keywords.length > 0) ? 'ok' : 'disabled', count: 0 },
  twitter: { status: (TWITTER.bearerToken && TWITTER.keywords.length > 0) ? 'ok' : 'disabled', count: 0 },
  youtube: { status: (YOUTUBE.apiKey && YOUTUBE.queries.length > 0) ? 'ok' : 'disabled', count: 0 },
  rss: { status: RSS_FEEDS.length > 0 ? 'ok' : 'disabled', count: 0 },
});

const cronState = {
  enabled: CRON_ENABLED,
  schedule: CRON_SCHEDULE,
  timezone: CRON_TZ,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
};

const app = createServer({
  name: 'content-tracker',
  jsonLimit: '1mb',
  health: (req, res) => {
    res.json({
      ok: true,
      status: 'ok',
      service: 'content-tracker',
      port: SERVER_PORT,
      uptime: process.uptime(),
      hasData: !!cache.data,
      sources: cache.data?.sources || configuredSourceStates(),
      cron: {
        ...cronState,
        isRefreshing,
      },
    });
  },
});

/** 캐시 (API rate limit 보호) */
let cache = { data: null, fetchedAt: null };
const CACHE_TTL = CACHE_TTL_MS;
let isRefreshing = false;

async function getData(forceRefresh = false) {
  if (!forceRefresh && cache.data && (Date.now() - cache.fetchedAt) < CACHE_TTL) {
    return cache.data;
  }

  const tasks = [
    {
      name: 'reddit',
      enabled: REDDIT.subreddits.length > 0,
      run: () => redditClient.fetchAll(),
    },
    {
      name: 'naver',
      enabled: Boolean(NAVER.clientId && NAVER.clientSecret && NAVER.keywords.length > 0),
      run: () => naverClient.fetchAll(),
    },
    {
      name: 'twitter',
      enabled: Boolean(TWITTER.bearerToken && TWITTER.keywords.length > 0),
      run: () => twitterClient.fetchAll(TWITTER),
    },
    {
      name: 'youtube',
      enabled: Boolean(YOUTUBE.apiKey && YOUTUBE.queries.length > 0),
      run: () => youtubeClient.fetchAll(YOUTUBE),
    },
    {
      name: 'rss',
      enabled: RSS_FEEDS.length > 0,
      run: () => rssClient.fetchAll({ feeds: RSS_FEEDS, maxItemsPerFeed: 10 }),
    },
  ];

  const settled = await Promise.allSettled(tasks.map(task => (
    task.enabled
      ? task.run()
      : Promise.resolve({ posts: [], errors: [], fetchedAt: new Date().toISOString() })
  )));

  const sources = emptySourceStates();
  const allPosts = [];

  tasks.forEach((task, idx) => {
    if (!SOURCE_NAMES.includes(task.name)) return;

    if (!task.enabled) {
      sources[task.name] = { status: 'disabled', count: 0 };
      return;
    }

    const result = settled[idx];
    if (result.status === 'fulfilled') {
      const payload = result.value || {};
      const posts = Array.isArray(payload) ? payload : (payload.posts || []);
      const errors = payload.errors || [];
      const errorMessage = summarizeErrors(errors);

      allPosts.push(...posts);
      sources[task.name] = {
        status: (posts.length === 0 && errorMessage) ? 'error' : 'ok',
        count: posts.length,
        ...(errorMessage ? { error: errorMessage } : {}),
      };
      return;
    }

    sources[task.name] = {
      status: 'error',
      count: 0,
      error: toErrorMessage(result.reason),
    };
  });

  const seen = new Set();
  const uniquePosts = allPosts.filter((post) => {
    const key = `${post?.source || 'unknown'}:${post?.postId || post?.url || ''}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const store = await snapshotStore.load();
  const snapshotMap = snapshotStore.buildSnapshotMap(store.snapshots || []);

  const scored = contentScorer.scoreAll(uniquePosts, { snapshotMap });
  const trends = contentAnalyzer.analyzeAll(uniquePosts, snapshotMap);
  const { signals, portfolio } = strategyAdvisor.generateSignals(scored);

  const result = {
    sources,
    items: scored,
    posts: scored,
    trends,
    signals,
    portfolio,
    fetchedAt: new Date().toISOString(),
  };

  cache = { data: result, fetchedAt: Date.now() };
  return result;
}

/**
 * 데이터 갱신 + 스냅샷 저장 (manual/cron 공용)
 */
async function refreshAndSnapshot(reason = 'manual') {
  if (isRefreshing) {
    const err = new Error('already refreshing');
    err.code = 'REFRESH_IN_PROGRESS';
    throw err;
  }

  isRefreshing = true;
  try {
    const data = await getData(true);
    const snapshot = await snapshotStore.saveSnapshot(data, { reason });
    return { data, snapshot };
  } finally {
    isRefreshing = false;
  }
}

async function runCronRefresh() {
  if (isRefreshing) {
    console.log('[content-tracker][cron] skipped: already refreshing');
    return;
  }

  cronState.lastRunAt = new Date().toISOString();

  try {
    const { data, snapshot } = await refreshAndSnapshot('cron');
    cronState.lastSuccessAt = new Date().toISOString();
    cronState.lastError = null;
    console.log(`[content-tracker][cron] refreshed ${data.posts.length} posts, snapshot=${snapshot.snapshotId}`);
  } catch (error) {
    cronState.lastError = toErrorMessage(error);
    console.error(`[content-tracker][cron] failed: ${cronState.lastError}`);
  }
}

// GET /api/content/overview — 소스별 요약 + 상위 포스트 (소스 밸런싱)
app.get('/api/content/overview', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, LIMIT_DEFAULT);
    const data = await getData();

    const toPostSummary = (post) => ({
      title: post.title,
      topic: post.topic,
      source: post.source,
      viewCount: post.viewCount,
      commentCount: post.commentCount,
      score: post.scoring.total,
      signal: post.scoring.signal,
      url: post.url,
      publishedAt: post.publishedAt,
    });

    // 소스별 최소 2개 보장 후 나머지 score 순 채움 (총 10개)
    const MAX_TOP = 10;
    const MIN_PER_SOURCE = 2;
    const picked = new Set();
    const topPosts = [];

    const activeSources = SOURCE_NAMES.filter(source => data.sources[source]?.count > 0);
    for (const source of activeSources) {
      const sourcePosts = data.posts.filter(post => post.source === source);
      for (const post of sourcePosts.slice(0, MIN_PER_SOURCE)) {
        if (topPosts.length >= MAX_TOP) break;
        picked.add(post.postId);
        topPosts.push(toPostSummary(post));
      }
    }

    for (const post of data.posts) {
      if (topPosts.length >= MAX_TOP) break;
      if (picked.has(post.postId)) continue;
      topPosts.push(toPostSummary(post));
    }

    res.json({
      sources: data.sources,
      topPosts,
      items: data.items.slice(0, limit),
      totalPosts: data.posts.length,
      fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    sendError(res, 500, toErrorMessage(error));
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
  } catch (error) {
    sendError(res, 500, toErrorMessage(error));
  }
});

// GET /api/content/trends — 포스트별 추세 분석
app.get('/api/content/trends', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, LIMIT_DEFAULT);
    const data = await getData();
    res.json({
      trends: data.trends.slice(0, limit),
      totalPosts: data.trends.length,
    });
  } catch (error) {
    sendError(res, 500, toErrorMessage(error));
  }
});

// GET /api/content/ideas — LLM 기반 트렌드 요약 + 아이디어 제안 + 틈새 분석
app.get('/api/content/ideas', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return sendError(res, 501, 'GEMINI_API_KEY not configured');
  }

  try {
    const data = await getData();
    const result = await generateIdeas(data.posts, data.portfolio, data.fetchedAt);
    res.json(result);
  } catch (error) {
    if (error?.code === 'NO_API_KEY') {
      return sendError(res, 501, toErrorMessage(error));
    }
    sendError(res, 500, toErrorMessage(error));
  }
});

// POST /api/content/refresh — 수동 데이터 갱신 + 스냅샷 저장
app.post('/api/content/refresh', async (req, res) => {
  try {
    const { data, snapshot } = await refreshAndSnapshot('manual');
    const store = await snapshotStore.load();

    res.json({
      message: 'Data refreshed',
      sources: data.sources,
      postCount: data.posts.length,
      snapshotCount: (store.snapshots || []).length,
      snapshotId: snapshot.snapshotId,
      snapshotPath: snapshot.path,
      fetchedAt: data.fetchedAt,
    });
  } catch (error) {
    if (error?.code === 'REFRESH_IN_PROGRESS') {
      return sendError(res, 409, 'already refreshing');
    }
    sendError(res, 500, toErrorMessage(error));
  }
});

startServer(app, SERVER_PORT, {
  name: 'content-tracker',
}).then(() => {
  const sourceConfig = configuredSourceStates();
  console.log(`[content-tracker] Sources configured: ${JSON.stringify(sourceConfig)}`);
  if (CRON_ENABLED) {
    cron.schedule(CRON_SCHEDULE, () => {
      runCronRefresh().catch((error) => {
        cronState.lastError = toErrorMessage(error);
        console.error(`[content-tracker][cron] unhandled error: ${cronState.lastError}`);
      });
    }, { timezone: CRON_TZ });
    console.log(`[content-tracker][cron] enabled: schedule=${CRON_SCHEDULE} tz=${CRON_TZ}`);
  } else {
    console.log('[content-tracker][cron] disabled');
  }
});
