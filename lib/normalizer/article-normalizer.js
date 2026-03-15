const toISODate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

const buildFallbackId = (parts = []) => Buffer
  .from(parts.join(':'))
  .toString('base64url')
  .slice(0, 40);

export function normalizeRssItem(item, feedUrl) {
  const fallbackId = buildFallbackId([feedUrl, item.title || '', item.link || '']);

  return {
    postId: String(item.guid || item.id || item.link || `rss_${fallbackId}`),
    title: (item.title || '(no title)').trim(),
    url: item.link || item.guid || feedUrl,
    source: 'rss',
    publishedAt: toISODate(item.isoDate || item.pubDate),
    author: item.creator || item.author || '',
    raw: item,
  };
}

export { toISODate };
