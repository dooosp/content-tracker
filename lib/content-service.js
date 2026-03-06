import { CACHE_TTL_MS } from '../config.js';
import contentAnalyzer from './content-analyzer.js';
import contentScorer from './content-scorer.js';
import snapshotStore from './snapshot-store.js';
import strategyAdvisor from './strategy-advisor.js';
import { createEmptySourceStates, createSourceTasks } from './sources.js';
import { dedupeBy, toErrorMessage } from './utils.js';

export function summarizeErrors(errors = []) {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;

  return errors
    .map((error) => error?.error || error?.message || String(error))
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ');
}

function normalizeSourcePayload(payload) {
  if (Array.isArray(payload)) {
    return { posts: payload, errors: [] };
  }

  return {
    posts: Array.isArray(payload?.posts) ? payload.posts : [],
    errors: Array.isArray(payload?.errors) ? payload.errors : [],
  };
}

function createRefreshInProgressError() {
  const error = new Error('already refreshing');
  error.code = 'REFRESH_IN_PROGRESS';
  return error;
}

function mergeSourceResults(tasks, settled) {
  const sources = createEmptySourceStates();
  const collectedPosts = [];

  tasks.forEach((task, index) => {
    if (!task.enabled) {
      sources[task.name] = { status: 'disabled', count: 0 };
      return;
    }

    const result = settled[index];
    if (result.status === 'rejected') {
      sources[task.name] = {
        status: 'error',
        count: 0,
        error: toErrorMessage(result.reason),
      };
      return;
    }

    const payload = normalizeSourcePayload(result.value);
    const errorMessage = summarizeErrors(payload.errors);

    collectedPosts.push(...payload.posts);
    sources[task.name] = {
      status: payload.posts.length === 0 && errorMessage ? 'error' : 'ok',
      count: payload.posts.length,
      ...(errorMessage ? { error: errorMessage } : {}),
    };
  });

  return { sources, posts: collectedPosts };
}

async function buildContentResult(posts, sources, store = snapshotStore) {
  const uniquePosts = dedupeBy(
    posts,
    (post) => `${post?.source || 'unknown'}:${post?.postId || post?.url || ''}`,
  );

  const snapshotData = await store.load();
  const snapshotMap = store.buildSnapshotMap(snapshotData.snapshots || []);
  const scoredPosts = contentScorer.scoreAll(uniquePosts, { snapshotMap });
  const trends = contentAnalyzer.analyzeAll(uniquePosts, snapshotMap);
  const { signals, portfolio } = strategyAdvisor.generateSignals(scoredPosts);

  return {
    sources,
    items: scoredPosts,
    posts: scoredPosts,
    trends,
    signals,
    portfolio,
    fetchedAt: new Date().toISOString(),
  };
}

export function createContentService(options = {}) {
  const store = options.snapshotStore || snapshotStore;
  const cacheTtl = Number.isFinite(options.cacheTtl) ? options.cacheTtl : CACHE_TTL_MS;

  let cache = { data: null, fetchedAtMs: 0 };
  let refreshing = false;

  return {
    getCachedData() {
      return cache.data;
    },

    hasCachedData() {
      return Boolean(cache.data);
    },

    isRefreshing() {
      return refreshing;
    },

    async getData(forceRefresh = false) {
      if (!forceRefresh && cache.data && (Date.now() - cache.fetchedAtMs) < cacheTtl) {
        return cache.data;
      }

      const tasks = createSourceTasks();
      const settled = await Promise.allSettled(tasks.map((task) => (
        task.enabled
          ? task.run()
          : Promise.resolve({ posts: [], errors: [], fetchedAt: new Date().toISOString() })
      )));

      const { sources, posts } = mergeSourceResults(tasks, settled);
      const result = await buildContentResult(posts, sources, store);

      cache = { data: result, fetchedAtMs: Date.now() };
      return result;
    },

    async refreshAndSnapshot(reason = 'manual') {
      if (refreshing) {
        throw createRefreshInProgressError();
      }

      refreshing = true;
      try {
        const data = await this.getData(true);
        const snapshot = await store.saveSnapshot(data, { reason });
        return { data, snapshot };
      } finally {
        refreshing = false;
      }
    },
  };
}

