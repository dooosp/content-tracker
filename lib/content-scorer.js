import { SCORING, TOPIC_KEYWORDS } from '../config.js';
import contentAnalyzer from './content-analyzer.js';

/**
 * 콘텐츠 스코어링 엔진
 * Confluence 스코어링 패턴 재활용 (Reddit + Naver)
 */
const contentScorer = {
  /**
   * 단일 포스트 스코어 계산
   */
  score(post, context = {}) {
    const w = SCORING.weights;
    const factors = {};

    // 1. View Velocity (인기 속도)
    const velocity = contentAnalyzer.calcViewVelocity(post);
    factors.viewVelocity = this.normalizeVelocity(velocity, post.source) * w.viewVelocity;

    // 2. Engagement Rate
    const engagement = contentAnalyzer.calcEngagementRate(post);
    factors.engagementRate = this.normalizeEngagement(engagement, post.source) * w.engagementRate;

    // 3. Growth Trend (7d MA vs 30d MA)
    factors.growthTrend = this.calcGrowthScore(post, context.snapshots) * w.growthTrend;

    // 4. Topic Performance (카테고리 평균 대비)
    factors.topicPerformance = this.calcTopicScore(post, context.topicAvg) * w.topicPerformance;

    // 5. Platform Relative (플랫폼 평균 대비)
    factors.channelRelative = this.calcChannelRelative(post, context.channelAvg) * w.channelRelative;

    const total = Math.round(Object.values(factors).reduce((s, v) => s + v, 0) * 100) / 100;
    const signal = this.getSignal(total);

    return { total, signal, factors };
  },

  /** 다수 포스트 일괄 스코어링 */
  scoreAll(posts, context = {}) {
    const channelAvgBySource = this.calcSourceAverages(posts);
    const topicAvgBySource = this.calcTopicAveragesBySource(posts);

    return posts
      .map(p => ({
        ...p,
        topic: this.detectTopic(p.title),
        scoring: this.score(p, {
          channelAvg: channelAvgBySource[p.source] || 0,
          topicAvg: topicAvgBySource[p.source] || {},
          snapshots: context.snapshotMap?.[p.postId] || [],
        }),
      }))
      .sort((a, b) => b.scoring.total - a.scoring.total);
  },

  /** Velocity 정규화 — 플랫폼별 스케일 조정 */
  normalizeVelocity(velocity, source) {
    if (source === 'naver') {
      // Naver: rankScore/day (max ~1000)
      if (velocity >= 800) return 1.0;
      if (velocity >= 500) return 0.8;
      if (velocity >= 200) return 0.6;
      if (velocity >= 50) return 0.4;
      return 0.2;
    }
    if (source === 'youtube') {
      // YouTube: views/hour
      if (velocity >= 500) return 1.0;
      if (velocity >= 200) return 0.8;
      if (velocity >= 50) return 0.6;
      if (velocity >= 10) return 0.4;
      return 0.2;
    }
    if (source === 'twitter') {
      // Twitter: impressions/hour
      if (velocity >= 200) return 1.0;
      if (velocity >= 100) return 0.8;
      if (velocity >= 30) return 0.6;
      if (velocity >= 5) return 0.4;
      return 0.2;
    }
    if (source === 'rss') {
      // RSS: 발행일 기준 신선도 (24h 이내 = 최고)
      if (velocity >= 1) return 0.8;   // 오늘 발행
      if (velocity >= 0.5) return 0.6; // 1-2일 전
      return 0.4;
    }
    // Reddit: upvotes/hour
    if (velocity >= 100) return 1.0;
    if (velocity >= 50) return 0.8;
    if (velocity >= 20) return 0.6;
    if (velocity >= 5) return 0.4;
    return 0.2;
  },

  /** Engagement 정규화 — 플랫폼별 */
  normalizeEngagement(rate, source) {
    if (source === 'naver') {
      // Naver: richness proxy, lower engagement signals
      if (rate >= 0.15) return 1.0;
      if (rate >= 0.08) return 0.7;
      if (rate >= 0.03) return 0.4;
      return 0.2;
    }
    if (source === 'youtube') {
      // YouTube: (likes + comments) / views
      if (rate >= 0.05) return 1.0;
      if (rate >= 0.03) return 0.8;
      if (rate >= 0.01) return 0.6;
      if (rate >= 0.005) return 0.4;
      return 0.2;
    }
    if (source === 'twitter') {
      // Twitter: (likes + replies) / impressions
      if (rate >= 0.1) return 1.0;
      if (rate >= 0.05) return 0.8;
      if (rate >= 0.02) return 0.6;
      if (rate >= 0.005) return 0.4;
      return 0.2;
    }
    if (source === 'rss') {
      // RSS: engagement 데이터 없음 — 중립
      return 0.5;
    }
    // Reddit: (likes + comments) / upvotes
    if (rate >= 1.5) return 1.0;
    if (rate >= 1.0) return 0.8;
    if (rate >= 0.5) return 0.6;
    if (rate >= 0.2) return 0.4;
    return 0.2;
  },

  /** Growth Score (MA 크로스 기반) */
  calcGrowthScore(post, snapshots = []) {
    const trend = contentAnalyzer.detectCross(snapshots);
    if (trend.cross === 'GOLDEN') return 1.0;
    if (trend.shortMA && trend.longMA && trend.shortMA > trend.longMA) return 0.7;
    if (trend.cross === 'DEAD') return 0.2;
    return 0.5;
  },

  /** Topic 성과 (토픽 평균 대비) */
  calcTopicScore(post, topicAvg = {}) {
    const topic = this.detectTopic(post.title);
    const avg = topicAvg[topic];
    if (!avg || avg === 0) return 0.5;

    const ratio = post.viewCount / avg;
    if (ratio >= 2.0) return 1.0;
    if (ratio >= 1.5) return 0.8;
    if (ratio >= 1.0) return 0.6;
    if (ratio >= 0.5) return 0.3;
    return 0.1;
  },

  /** Platform Relative (전체 평균 대비) */
  calcChannelRelative(post, channelAvg = 0) {
    if (channelAvg === 0) return 0.5;
    const ratio = post.viewCount / channelAvg;
    if (ratio >= 3.0) return 1.0;
    if (ratio >= 2.0) return 0.8;
    if (ratio >= 1.0) return 0.6;
    if (ratio >= 0.5) return 0.3;
    return 0.1;
  },

  /** 시그널 판정 */
  getSignal(total) {
    if (total >= SCORING.thresholds.DOUBLE_DOWN) return 'DOUBLE_DOWN';
    if (total >= SCORING.thresholds.MAINTAIN) return 'MAINTAIN';
    return 'PIVOT_AWAY';
  },

  /** 제목에서 토픽 감지 */
  detectTopic(title) {
    if (!title) return 'Other';
    const upper = title.toUpperCase();
    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      for (const kw of keywords) {
        if (upper.includes(kw.toUpperCase())) return topic;
      }
    }
    return 'Other';
  },

  /** 토픽별 평균 계산 */
  calcTopicAverages(posts) {
    const groups = {};
    for (const p of posts) {
      const topic = this.detectTopic(p.title);
      if (!groups[topic]) groups[topic] = [];
      groups[topic].push(p.viewCount);
    }
    const avgs = {};
    for (const [topic, views] of Object.entries(groups)) {
      avgs[topic] = views.reduce((s, v) => s + v, 0) / views.length;
    }
    return avgs;
  },

  /** 소스별 viewCount 평균 */
  calcSourceAverages(posts) {
    const groups = {};
    for (const p of posts) {
      const src = p.source || 'unknown';
      if (!groups[src]) groups[src] = [];
      groups[src].push(p.viewCount || 0);
    }
    const avgs = {};
    for (const [src, views] of Object.entries(groups)) {
      avgs[src] = views.length > 0 ? views.reduce((s, v) => s + v, 0) / views.length : 0;
    }
    return avgs;
  },

  /** 소스별 + 토픽별 viewCount 평균 */
  calcTopicAveragesBySource(posts) {
    const groups = {};
    for (const p of posts) {
      const src = p.source || 'unknown';
      const topic = this.detectTopic(p.title);
      if (!groups[src]) groups[src] = {};
      if (!groups[src][topic]) groups[src][topic] = [];
      groups[src][topic].push(p.viewCount || 0);
    }
    const avgs = {};
    for (const [src, topics] of Object.entries(groups)) {
      avgs[src] = {};
      for (const [topic, views] of Object.entries(topics)) {
        avgs[src][topic] = views.reduce((s, v) => s + v, 0) / views.length;
      }
    }
    return avgs;
  },
};

export default contentScorer;
