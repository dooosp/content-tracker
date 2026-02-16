import { YOUTUBE } from '../config.js';

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const clampMaxResults = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 15;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
};

const toErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  return error.message || String(error);
};

const normalizeVideo = (videoId, snippet, stats = {}) => ({
  postId: String(videoId),
  title: snippet?.title || '(no title)',
  url: `https://www.youtube.com/watch?v=${videoId}`,
  source: 'youtube',
  viewCount: Number(stats.viewCount || 0),
  likeCount: Number(stats.likeCount || 0),
  commentCount: Number(stats.commentCount || 0),
  publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt).toISOString() : undefined,
  author: snippet?.channelTitle || '',
  raw: { snippet, statistics: stats },
});

const apiGet = async (baseUrl, params) => {
  const url = `${baseUrl}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }

  return await res.json();
};

export async function searchVideos(config = YOUTUBE) {
  const apiKey = config?.apiKey || '';
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY not configured');
  }

  const queries = (config?.queries || [])
    .map(v => String(v || '').trim())
    .filter(Boolean);

  if (queries.length === 0) return [];

  const maxResults = clampMaxResults(config?.maxResults);
  const snippetById = new Map();

  for (const query of queries) {
    const payload = await apiGet(SEARCH_URL, {
      key: apiKey,
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(maxResults),
    });

    for (const item of payload.items || []) {
      const videoId = item?.id?.videoId;
      if (!videoId || !item.snippet) continue;
      if (!snippetById.has(videoId)) {
        snippetById.set(videoId, item.snippet);
      }
    }
  }

  const videoIds = Array.from(snippetById.keys());
  if (videoIds.length === 0) return [];

  const statsById = new Map();
  const groups = chunk(videoIds, 50);
  for (const ids of groups) {
    const payload = await apiGet(VIDEOS_URL, {
      key: apiKey,
      part: 'statistics',
      id: ids.join(','),
    });
    for (const item of payload.items || []) {
      statsById.set(item.id, item.statistics || {});
    }
  }

  return videoIds.map(videoId =>
    normalizeVideo(videoId, snippetById.get(videoId), statsById.get(videoId))
  );
}

const youtubeClient = {
  async fetchAll(config = YOUTUBE) {
    try {
      const posts = await searchVideos(config);
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

export default youtubeClient;
