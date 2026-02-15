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
    const channelAvg = posts.length > 0
      ? posts.reduce((s, v) => s + v.viewCount, 0) / posts.length
      : 0;

    const topicAvg = this.calcTopicAverages(posts);

    return posts
      .map(p => ({
        ...p,
        topic: this.detectTopic(p.title),
        scoring: this.score(p, {
          channelAvg,
          topicAvg,
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
};

export default contentScorer;
