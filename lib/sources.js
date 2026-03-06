import { REDDIT, NAVER, TWITTER, YOUTUBE, RSS_FEEDS } from '../config.js';
import redditClient from './reddit-client.js';
import naverClient from './naver-client.js';
import twitterClient from './twitter-client.js';
import youtubeClient from './youtube-client.js';
import rssClient from './rss-client.js';

export const SOURCE_NAMES = ['reddit', 'naver', 'twitter', 'youtube', 'rss'];

function toSourceState(name, enabled) {
  return { [name]: { status: enabled ? 'ok' : 'disabled', count: 0 } };
}

export function createSourceTasks() {
  return [
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
}

export function createConfiguredSourceStates() {
  return createSourceTasks().reduce((acc, task) => ({
    ...acc,
    ...toSourceState(task.name, task.enabled),
  }), {});
}

export function createEmptySourceStates() {
  return SOURCE_NAMES.reduce((acc, name) => ({
    ...acc,
    [name]: { status: 'disabled', count: 0 },
  }), {});
}

