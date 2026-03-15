import { REDDIT, NAVER, TWITTER, YOUTUBE, RSS_FEEDS } from '../config.js';
import redditSource from './sources/reddit-source.js';
import naverSource from './sources/naver-source.js';
import twitterSource from './sources/twitter-source.js';
import youtubeSource from './sources/youtube-source.js';
import rssSource from './sources/rss-source.js';

export const SOURCE_NAMES = ['reddit', 'naver', 'twitter', 'youtube', 'rss'];

function toSourceState(name, enabled) {
  return { [name]: { status: enabled ? 'ok' : 'disabled', count: 0 } };
}

export function createSourceTasks() {
  return [
    {
      name: 'reddit',
      enabled: REDDIT.subreddits.length > 0,
      run: () => redditSource.fetchAll(),
    },
    {
      name: 'naver',
      enabled: Boolean(NAVER.clientId && NAVER.clientSecret && NAVER.keywords.length > 0),
      run: () => naverSource.fetchAll(),
    },
    {
      name: 'twitter',
      enabled: Boolean(TWITTER.bearerToken && TWITTER.keywords.length > 0),
      run: () => twitterSource.fetchAll(TWITTER),
    },
    {
      name: 'youtube',
      enabled: Boolean(YOUTUBE.apiKey && YOUTUBE.queries.length > 0),
      run: () => youtubeSource.fetchAll(YOUTUBE),
    },
    {
      name: 'rss',
      enabled: RSS_FEEDS.length > 0,
      run: () => rssSource.fetchAll({ feeds: RSS_FEEDS, maxItemsPerFeed: 10 }),
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
