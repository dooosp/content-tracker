import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createServer, startServer } = require('server-base');
import cron from 'node-cron';

import { GEMINI_API_KEY, SERVER_PORT } from './config.js';
import { createContentService } from './lib/content-service.js';
import { generateIdeas } from './lib/idea-generator.js';
import { buildBalancedTopPosts, parseLimit, sendError } from './lib/response-builders.js';
import snapshotStore from './lib/snapshot-store.js';
import { createConfiguredSourceStates } from './lib/sources.js';
import { toErrorMessage } from './lib/utils.js';

const LIMIT_DEFAULT = 50;

function asBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function createCronConfig(env = process.env) {
  return {
    enabled: asBool(env.CRON_ENABLED, true),
    schedule: env.CRON_SCHEDULE || '0 */4 * * *',
    timezone: env.CRON_TZ || 'Asia/Seoul',
  };
}

function createCronState(cronConfig) {
  return {
    enabled: cronConfig.enabled,
    schedule: cronConfig.schedule,
    timezone: cronConfig.timezone,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
}

export function buildApp(options = {}) {
  const contentService = options.contentService || createContentService();
  const configuredSourceStates = options.configuredSourceStates || createConfiguredSourceStates();
  const cronConfig = options.cronConfig || createCronConfig();
  const cronState = options.cronState || createCronState(cronConfig);
  const ideaGenerator = options.ideaGenerator || generateIdeas;
  const ideaApiKey = options.geminiApiKey ?? GEMINI_API_KEY;
  const snapshotStoreImpl = options.snapshotStore || snapshotStore;

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
        hasData: contentService.hasCachedData(),
        sources: contentService.getCachedData()?.sources || configuredSourceStates,
        cron: {
          ...cronState,
          isRefreshing: contentService.isRefreshing(),
        },
      });
    },
  });

  app.get('/api/content/overview', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit, LIMIT_DEFAULT);
      const data = await contentService.getData();

      res.json({
        sources: data.sources,
        topPosts: buildBalancedTopPosts(data.posts, data.sources),
        items: data.items.slice(0, limit),
        totalPosts: data.posts.length,
        fetchedAt: data.fetchedAt,
      });
    } catch (error) {
      sendError(res, 500, toErrorMessage(error));
    }
  });

  app.get('/api/content/signals', async (req, res) => {
    try {
      const data = await contentService.getData();
      res.json({
        signals: data.signals,
        portfolio: data.portfolio,
      });
    } catch (error) {
      sendError(res, 500, toErrorMessage(error));
    }
  });

  app.get('/api/content/trends', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit, LIMIT_DEFAULT);
      const data = await contentService.getData();
      res.json({
        trends: data.trends.slice(0, limit),
        totalPosts: data.trends.length,
      });
    } catch (error) {
      sendError(res, 500, toErrorMessage(error));
    }
  });

  app.get('/api/content/ideas', async (req, res) => {
    if (!ideaApiKey) {
      return sendError(res, 501, 'GEMINI_API_KEY not configured');
    }

    try {
      const data = await contentService.getData();
      const result = await ideaGenerator(data.posts, data.portfolio, data.fetchedAt);
      res.json(result);
    } catch (error) {
      if (error?.code === 'NO_API_KEY') {
        return sendError(res, 501, toErrorMessage(error));
      }
      sendError(res, 500, toErrorMessage(error));
    }
  });

  app.post('/api/content/refresh', async (req, res) => {
    try {
      const { data, snapshot } = await contentService.refreshAndSnapshot('manual');
      const store = await snapshotStoreImpl.load();

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

  return { app, contentService, configuredSourceStates, cronConfig, cronState };
}

export async function startContentTrackerServer(options = {}) {
  const built = buildApp(options);

  async function runCronRefresh() {
    if (built.contentService.isRefreshing()) {
      console.log('[content-tracker][cron] skipped: already refreshing');
      return;
    }

    built.cronState.lastRunAt = new Date().toISOString();

    try {
      const { data, snapshot } = await built.contentService.refreshAndSnapshot('cron');
      built.cronState.lastSuccessAt = new Date().toISOString();
      built.cronState.lastError = null;
      console.log(`[content-tracker][cron] refreshed ${data.posts.length} posts, snapshot=${snapshot.snapshotId}`);
    } catch (error) {
      built.cronState.lastError = toErrorMessage(error);
      console.error(`[content-tracker][cron] failed: ${built.cronState.lastError}`);
    }
  }

  const server = await startServer(built.app, SERVER_PORT, {
    name: 'content-tracker',
  });

  console.log(`[content-tracker] Sources configured: ${JSON.stringify(built.configuredSourceStates)}`);

  if (built.cronConfig.enabled) {
    cron.schedule(built.cronConfig.schedule, () => {
      runCronRefresh().catch((error) => {
        built.cronState.lastError = toErrorMessage(error);
        console.error(`[content-tracker][cron] unhandled error: ${built.cronState.lastError}`);
      });
    }, { timezone: built.cronConfig.timezone });

    console.log(`[content-tracker][cron] enabled: schedule=${built.cronConfig.schedule} tz=${built.cronConfig.timezone}`);
  } else {
    console.log('[content-tracker][cron] disabled');
  }

  return { ...built, server };
}

