import { REDDIT } from '../config.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Reddit 공개 JSON API 클라이언트
 * 인증 불필요, .json suffix로 접근
 */
const redditClient = {
  /**
   * 서브레딧 인기 게시글 조회
   */
  async getSubredditPosts(subreddit, sort = REDDIT.sort, limit = REDDIT.maxPerSub) {
    const url = `https://old.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': REDDIT.userAgent,
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      console.warn(`[reddit] Rate limited on r/${subreddit}, skipping`);
      return [];
    }
    if (!res.ok) {
      throw new Error(`Reddit r/${subreddit} HTTP ${res.status}`);
    }

    const data = await res.json();
    const posts = data?.data?.children || [];

    return posts
      .filter(p => p.kind === 't3' && !p.data.stickied)
      .map(p => this.normalize(p.data, subreddit));
  },

  /**
   * Reddit 데이터 → 공통 형식 정규화
   */
  normalize(post, subreddit) {
    return {
      postId: `reddit_${post.id}`,
      title: post.title,
      url: `https://reddit.com${post.permalink}`,
      source: 'reddit',
      subreddit: post.subreddit || subreddit,
      author: post.author,
      // 스코어링용 정규화 필드
      viewCount: post.score || 0,          // upvotes as popularity proxy
      likeCount: post.ups || 0,
      commentCount: post.num_comments || 0,
      upvoteRatio: post.upvote_ratio || 0,
      publishedAt: new Date(post.created_utc * 1000).toISOString(),
      // 원본 메타데이터
      selftext: (post.selftext || '').slice(0, 200),
      isVideo: post.is_video || false,
      thumbnail: post.thumbnail,
      awards: post.total_awards_received || 0,
    };
  },

  /**
   * 전체 서브레딧 데이터 수집
   */
  async fetchAll() {
    const allPosts = [];
    const errors = [];

    for (const sub of REDDIT.subreddits) {
      try {
        const posts = await this.getSubredditPosts(sub);
        allPosts.push(...posts);
      } catch (err) {
        errors.push({ subreddit: sub, error: err.message });
      }
      await delay(REDDIT.requestDelay);
    }

    // 중복 제거 (crosspost)
    const seen = new Set();
    const unique = allPosts.filter(p => {
      if (seen.has(p.postId)) return false;
      seen.add(p.postId);
      return true;
    });

    return {
      posts: unique,
      totalSubs: REDDIT.subreddits.length,
      errors,
      fetchedAt: new Date().toISOString(),
    };
  },
};

export default redditClient;
