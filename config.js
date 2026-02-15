import 'dotenv/config';

/** Reddit 설정 (인증 불필요, 공개 JSON API) */
export const REDDIT = {
  userAgent: 'Mozilla/5.0 (compatible; content-tracker/1.0; +dooosp)',
  subreddits: [
    'artificial', 'MachineLearning', 'ChatGPT', 'LocalLLaMA',
    'programming', 'webdev', 'javascript', 'node',
    'startups', 'Entrepreneur', 'SaaS',
    'investing', 'stocks', 'CryptoCurrency',
    'productivity',
  ],
  sort: 'hot',           // hot, rising, top
  maxPerSub: 10,
  requestDelay: 1500,     // ms between requests (rate limit)
};

/** Naver Open API 설정 */
export const NAVER = {
  clientId: process.env.NAVER_CLIENT_ID || '',
  clientSecret: process.env.NAVER_CLIENT_SECRET || '',
  keywords: ['AI', 'GPT', '스타트업', '투자', '프로그래밍', '자동화', '사이드프로젝트'],
  display: 15,            // results per keyword
  sort: 'sim',            // sim(정확도), date(날짜)
  requestDelay: 200,      // ms between requests
};

/** 스코어링 팩터 (합산 100점) */
export const SCORING = {
  weights: {
    viewVelocity: 25,     // 인기 속도 (upvotes/hour or rank score/day)
    engagementRate: 25,    // 참여율 (comments/score)
    growthTrend: 20,       // 성장 추세 (7d MA vs 30d MA)
    topicPerformance: 15,  // 토픽 성과 (카테고리 평균 대비)
    channelRelative: 15,   // 플랫폼 평균 대비 상대 성과
  },
  thresholds: {
    DOUBLE_DOWN: 75,
    MAINTAIN: 40,
  },
};

/** 추세 분석 MA 기간 */
export const ANALYSIS = {
  shortMA: 7,
  longMA: 30,
  snapshotDir: 'data',
};

/** 토픽 매핑 (제목 키워드 → 토픽) */
export const TOPIC_KEYWORDS = {
  'AI': ['AI', 'GPT', '인공지능', 'LLM', 'Claude', 'OpenAI', 'Machine Learning', 'Gemini', 'Llama', 'deep learning', 'neural'],
  'Programming': ['코딩', '프로그래밍', 'JavaScript', 'Python', 'React', 'Node', 'TypeScript', 'Rust', 'Go', 'programming', 'developer', 'coding'],
  'Startup': ['스타트업', '창업', '사업', 'SaaS', 'B2B', 'MVP', 'startup', 'founder', 'venture', 'YC'],
  'Finance': ['투자', '주식', '금융', 'ETF', '재테크', '경제', 'investing', 'stock', 'crypto', 'bitcoin', 'trading'],
  'Productivity': ['생산성', '자동화', 'Notion', '루틴', '습관', 'productivity', 'automation', 'workflow'],
  'Career': ['커리어', '이직', '취업', '면접', '회사', 'career', 'job', 'interview', 'salary', 'remote'],
};

export const SERVER_PORT = parseInt(process.env.CONTENT_PORT, 10) || 3950;
