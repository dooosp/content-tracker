import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createLLMClient } = require('llm-client');

import { GEMINI_API_KEY, IDEA_PIPELINE } from '../config.js';
import { sanitizeTitle, toErrorMessage } from './utils.js';

let llm = null;
const ideaCache = new Map();

function getLLM() {
  if (!llm) {
    llm = createLLMClient({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-2.0-flash',
      timeout: IDEA_PIPELINE.llmTimeout,
      maxRetries: IDEA_PIPELINE.llmRetries,
    });
  }
  return llm;
}

function normalizeIdeaPayload(payload) {
  return {
    trends: Array.isArray(payload?.trends) ? payload.trends : [],
    ideas: Array.isArray(payload?.ideas) ? payload.ideas : [],
    gaps: Array.isArray(payload?.gaps) ? payload.gaps : [],
  };
}

function toCacheKey(fetchedAt) {
  const key = typeof fetchedAt === 'string' ? fetchedAt.trim() : '';
  return `ideas:${key || 'na'}`;
}

/**
 * Generate content ideas from top posts using LLM
 * @param {Array} topPosts - scored posts (title, source, score, topic)
 * @param {Object} portfolio - topic distribution { topic: { count, pct } }
 * @param {string} fetchedAt - getData() 기준 fetch timestamp
 * @returns {Promise<{ trends, ideas, gaps, generatedAt, cached }>}
 */
export async function generateIdeas(topPosts = [], portfolio = {}, fetchedAt = 'na') {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const cacheKey = toCacheKey(fetchedAt);
  const cached = ideaCache.get(cacheKey);
  if (cached && (Date.now() - cached.cachedAt) < IDEA_PIPELINE.cacheTTL) {
    return { ...cached.data, cached: true };
  }

  const top20 = topPosts.slice(0, 20).map((post, index) => ({
    rank: index + 1,
    title: sanitizeTitle(post?.title || '(no title)'),
    source: post?.source || 'unknown',
    score: post?.scoring?.total ?? post?.score ?? 0,
    topic: post?.topic || 'Unknown',
  }));

  const portfolioSummary = Object.entries(portfolio || {})
    .map(([topic, info]) => `${topic}: ${info.count || 0}posts (${info.pct || 0}%)`)
    .join(', ');

  const prompt = `You are a content strategist analyzing trending posts.

## Top 20 Posts (ranked by engagement score)
${top20.map(post => `${post.rank}. [${post.source}] ${post.title} (score: ${post.score}, topic: ${post.topic})`).join('\n')}

## Current Portfolio Distribution
${portfolioSummary || 'No portfolio data'}

## Task
Analyze the above posts and provide:
1. **trends**: 3 key trends you see across these posts. Each with title, summary (1-2 sentences), and evidence (which posts support this).
2. **ideas**: 3 actionable content/project ideas. Each with title, description (2-3 sentences), type (one of: content, project, business), and why (why now, based on the data).
3. **gaps**: 2 topics or angles that nobody is covering but should be. Each with topic and observation.

Respond in Korean. Return ONLY valid JSON:
{
  "trends": [{ "title": "...", "summary": "...", "evidence": "..." }],
  "ideas": [{ "title": "...", "description": "...", "type": "...", "why": "..." }],
  "gaps": [{ "topic": "...", "observation": "..." }]
}`;

  let response;
  try {
    response = await getLLM().chatJSON(prompt, { label: 'idea-generator' });
  } catch (error) {
    console.error('[idea-generator] chatJSON failed', toErrorMessage(error));
    response = null;
  }

  const normalized = normalizeIdeaPayload(response);
  const output = {
    trends: normalized.trends,
    ideas: normalized.ideas,
    gaps: normalized.gaps,
    generatedAt: new Date().toISOString(),
  };

  ideaCache.set(cacheKey, { data: output, cachedAt: Date.now() });
  return { ...output, cached: false };
}

export default { generateIdeas };
