import { TOPIC_KEYWORDS } from '../config.js';
import contentScorer from './content-scorer.js';

/**
 * 콘텐츠 전략 어드바이저
 * market-analyzer 섹터/포트폴리오 분석 패턴 재활용
 */
const strategyAdvisor = {
  /**
   * 토픽 포트폴리오 분석
   * 토픽 = 섹터, 비디오 = 종목
   */
  analyzePortfolio(scoredVideos) {
    const topics = {};

    for (const v of scoredVideos) {
      const topic = v.topic || contentScorer.detectTopic(v.title);
      if (!topics[topic]) {
        topics[topic] = { videos: [], totalViews: 0, totalScore: 0 };
      }
      topics[topic].videos.push(v);
      topics[topic].totalViews += v.viewCount || 0;
      topics[topic].totalScore += v.scoring?.total || 0;
    }

    const totalVideos = scoredVideos.length || 1;
    const analysis = [];

    for (const [topic, data] of Object.entries(topics)) {
      const count = data.videos.length;
      const avgScore = count > 0 ? Math.round(data.totalScore / count * 100) / 100 : 0;
      const share = Math.round(count / totalVideos * 100);

      analysis.push({
        topic,
        videoCount: count,
        share, // 비디오 수 비중 (%)
        totalViews: data.totalViews,
        avgScore,
        avgViews: Math.round(data.totalViews / count),
      });
    }

    // 성과순 정렬
    analysis.sort((a, b) => b.avgScore - a.avgScore);

    return analysis;
  },

  /**
   * 전략 시그널 생성
   */
  generateSignals(scoredVideos) {
    const portfolio = this.analyzePortfolio(scoredVideos);
    const signals = [];

    // 1. 과대 성과 토픽 → DOUBLE_DOWN 권고
    const top = portfolio.filter(t => t.avgScore >= 60);
    for (const t of top) {
      signals.push({
        type: 'DOUBLE_DOWN',
        topic: t.topic,
        reason: `평균 점수 ${t.avgScore}점 (상위 성과)`,
        avgScore: t.avgScore,
        videoCount: t.videoCount,
      });
    }

    // 2. 과소 성과 토픽 → PIVOT_AWAY 권고
    const bottom = portfolio.filter(t => t.avgScore < 30 && t.videoCount >= 2);
    for (const t of bottom) {
      signals.push({
        type: 'PIVOT_AWAY',
        topic: t.topic,
        reason: `평균 점수 ${t.avgScore}점 (하위 성과)`,
        avgScore: t.avgScore,
        videoCount: t.videoCount,
      });
    }

    // 3. 집중도 경고 (한 토픽이 50%+ 비중)
    const concentrated = portfolio.filter(t => t.share >= 50);
    for (const t of concentrated) {
      signals.push({
        type: 'CONCENTRATION_WARNING',
        topic: t.topic,
        reason: `비중 ${t.share}% — 다각화 권장`,
        share: t.share,
      });
    }

    // 4. 미개척 토픽 (정의된 토픽 중 비디오 0건)
    const existingTopics = new Set(portfolio.map(p => p.topic));
    for (const topic of Object.keys(TOPIC_KEYWORDS)) {
      if (!existingTopics.has(topic)) {
        signals.push({
          type: 'UNEXPLORED',
          topic,
          reason: '아직 콘텐츠 없음 — 탐색 기회',
        });
      }
    }

    return { signals, portfolio };
  },
};

export default strategyAdvisor;
