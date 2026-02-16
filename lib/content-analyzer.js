import { ANALYSIS } from '../config.js';
import { safeDate, safeDivide } from './utils.js';

/**
 * 콘텐츠 분석기
 * technical-analyzer의 MA/추세 분석 패턴 재활용
 */
const contentAnalyzer = {
  /**
   * 이동평균 계산
   */
  calculateMA(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / period;
  },

  /**
   * 인기 속도 (viewCount per hour since publish)
   * Reddit: upvotes/hour, Naver: rankScore/day
   */
  calcViewVelocity(post) {
    const published = safeDate(post.publishedAt);
    const hours = Math.max(1, (Date.now() - published) / 3600000);
    const viewCount = Number(post.viewCount || 0);

    if (post.source === 'naver') {
      // Naver: rankScore is already normalized, measure per day
      const days = Math.max(1, hours / 24);
      return Math.round(safeDivide(viewCount, days, 0));
    }

    // Reddit: upvotes per hour
    return Math.round(safeDivide(viewCount, hours, 0));
  },

  /**
   * 참여율 계산 (comments / viewCount)
   */
  calcEngagementRate(post) {
    const likes = Number(post.likeCount || 0);
    const comments = Number(post.commentCount || 0);
    const views = Number(post.viewCount || 0);
    return safeDivide(likes + comments, views, 0);
  },

  /**
   * 골든크로스/데드크로스 감지 (7d MA vs 30d MA)
   */
  detectCross(snapshots) {
    if (snapshots.length < ANALYSIS.longMA) return { cross: 'NONE', shortMA: null, longMA: null };

    const views = snapshots.map((s) => Number(s?.viewCount || 0));
    const shortMA = this.calculateMA(views, ANALYSIS.shortMA);
    const longMA = this.calculateMA(views, ANALYSIS.longMA);

    if (shortMA === null || longMA === null) return { cross: 'NONE', shortMA, longMA };

    let cross = 'NONE';
    if (views.length > ANALYSIS.longMA) {
      const prevViews = views.slice(0, views.length - 1);
      const prevShort = this.calculateMA(prevViews, ANALYSIS.shortMA);
      const prevLong = this.calculateMA(prevViews, ANALYSIS.longMA);
      if (prevShort !== null && prevLong !== null) {
        if (prevShort <= prevLong && shortMA > longMA) cross = 'GOLDEN';
        else if (prevShort >= prevLong && shortMA < longMA) cross = 'DEAD';
      }
    }

    return { cross, shortMA: Math.round(shortMA), longMA: Math.round(longMA) };
  },

  /**
   * 개별 포스트 추세 분석
   */
  analyzeTrend(post, snapshots = []) {
    const velocity = this.calcViewVelocity(post);
    const engagement = this.calcEngagementRate(post);

    let trend = { cross: 'NONE', shortMA: null, longMA: null };
    if (snapshots.length >= ANALYSIS.shortMA) {
      trend = this.detectCross(snapshots);
    }

    return {
      postId: post.postId,
      title: post.title,
      source: post.source,
      publishedAt: post.publishedAt,
      viewCount: post.viewCount,
      velocity,
      engagement: Math.round(engagement * 10000) / 100,
      trend,
    };
  },

  /**
   * 전체 포스트 추세 분석
   */
  analyzeAll(posts, snapshotMap = {}) {
    return posts.map(p => this.analyzeTrend(p, snapshotMap[p.postId] || []));
  },
};

export default contentAnalyzer;
