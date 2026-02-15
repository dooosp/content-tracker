import { NAVER } from '../config.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Naver Open API 클라이언트
 * Blog + News 검색
 */
const naverClient = {
  /**
   * Naver API 호출
   */
  async apiGet(endpoint, params = {}) {
    if (!NAVER.clientId || !NAVER.clientSecret) {
      throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not configured');
    }

    const qs = new URLSearchParams(params).toString();
    const url = `https://openapi.naver.com/v1/search/${endpoint}?${qs}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        headers: {
          'X-Naver-Client-Id': NAVER.clientId,
          'X-Naver-Client-Secret': NAVER.clientSecret,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Naver API ${res.status}: ${body.slice(0, 200)}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * 블로그 검색
   */
  async searchBlog(keyword, display = NAVER.display) {
    const data = await this.apiGet('blog.json', {
      query: keyword,
      display,
      sort: NAVER.sort,
    });

    return (data.items || []).map((item, idx) =>
      this.normalize(item, keyword, 'blog', idx, display)
    );
  },

  /**
   * 뉴스 검색
   */
  async searchNews(keyword, display = NAVER.display) {
    const data = await this.apiGet('news.json', {
      query: keyword,
      display,
      sort: NAVER.sort,
    });

    return (data.items || []).map((item, idx) =>
      this.normalize(item, keyword, 'news', idx, display)
    );
  },

  /**
   * Naver 데이터 → 공통 형식 정규화
   * viewCount는 검색 순위 기반 추정 (상위 = 높은 점수)
   */
  normalize(item, keyword, type, rankIndex, total) {
    const title = (item.title || '').replace(/<\/?b>/g, '');
    const desc = (item.description || '').replace(/<\/?b>/g, '');

    // 순위 기반 인기도 추정 (1위=1000, 마지막=100)
    const rankScore = Math.round(1000 - (rankIndex / total) * 900);

    // 설명 길이를 참여도 프록시로 활용
    const richness = Math.min(desc.length / 10, 50);

    const dateStr = item.postdate
      ? `${item.postdate.slice(0, 4)}-${item.postdate.slice(4, 6)}-${item.postdate.slice(6, 8)}`
      : item.pubDate
        ? new Date(item.pubDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    return {
      postId: `naver_${type}_${Buffer.from(item.link || '').toString('base64url').slice(0, 16)}`,
      title,
      url: item.link || item.originallink || '',
      source: 'naver',
      naverType: type,
      keyword,
      author: item.bloggername || item.source || '',
      // 스코어링용 정규화 필드
      viewCount: rankScore,
      likeCount: Math.round(richness),
      commentCount: 0,
      publishedAt: `${dateStr}T00:00:00Z`,
      // 메타데이터
      description: desc.slice(0, 200),
    };
  },

  /**
   * 전체 키워드 데이터 수집 (blog + news)
   */
  async fetchAll() {
    if (!NAVER.clientId) {
      return { posts: [], keywords: NAVER.keywords, errors: [{ error: 'API keys not configured' }], fetchedAt: new Date().toISOString() };
    }

    const allPosts = [];
    const errors = [];

    for (const keyword of NAVER.keywords) {
      try {
        const blogs = await this.searchBlog(keyword);
        allPosts.push(...blogs);
        await delay(NAVER.requestDelay);

        const news = await this.searchNews(keyword);
        allPosts.push(...news);
        await delay(NAVER.requestDelay);
      } catch (err) {
        errors.push({ keyword, error: err.message });
      }
    }

    // 중복 URL 제거
    const seen = new Set();
    const unique = allPosts.filter(p => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });

    return {
      posts: unique,
      keywords: NAVER.keywords,
      errors,
      fetchedAt: new Date().toISOString(),
    };
  },
};

export default naverClient;
