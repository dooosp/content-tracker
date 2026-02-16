import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createLLMClient } = require('llm-client');

import { GEMINI_API_KEY, IDEA_PIPELINE } from '../config.js';

let llm = null;
let ideaCache = { data: null, cachedAt: 0 };

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

/**
 * Generate content ideas from top posts using LLM
 * @param {Array} topPosts - scored posts (title, source, score, topic)
 * @param {Object} portfolio - topic distribution { topic: { count, pct } }
 * @returns {Promise<{ trends, ideas, gaps, generatedAt, cached }>}
 */
export async function generateIdeas(topPosts, portfolio) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }

  // Check cache
  if (ideaCache.data && (Date.now() - ideaCache.cachedAt) < IDEA_PIPELINE.cacheTTL) {
    return { ...ideaCache.data, cached: true };
  }

  const top20 = topPosts.slice(0, 20).map((p, i) => ({
    rank: i + 1,
    title: p.title,
    source: p.source,
    score: p.scoring?.total ?? p.score ?? 0,
    topic: p.topic || 'Unknown',
  }));

  const portfolioSummary = Object.entries(portfolio || {})
    .map(([topic, info]) => `${topic}: ${info.count || 0}posts (${info.pct || 0}%)`)
    .join(', ');

  const prompt = `You are a content strategist analyzing trending posts.

## Top 20 Posts (ranked by engagement score)
${top20.map(p => `${p.rank}. [${p.source}] ${p.title} (score: ${p.score}, topic: ${p.topic})`).join('\n')}

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

  const result = await getLLM().chatJSON(prompt, { label: 'idea-generator' });

  const output = {
    trends: result.trends || [],
    ideas: result.ideas || [],
    gaps: result.gaps || [],
    generatedAt: new Date().toISOString(),
  };

  ideaCache = { data: output, cachedAt: Date.now() };
  return { ...output, cached: false };
}

export default { generateIdeas };
