import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { ANALYSIS, SNAPSHOT_RETENTION_DAYS } from '../config.js';
import { toErrorMessage } from './utils.js';

const dataDir = ANALYSIS.snapshotDir;
const SNAPSHOT_FILE = 'snapshots.json';
const SNAPSHOT_ARCHIVE_DIR = 'snapshots';
let saveQueue = Promise.resolve();

function queuedSave(fn) {
  const task = saveQueue.then(fn);
  saveQueue = task.catch(() => undefined);
  return task;
}

const toSnapshotId = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');
const toDateMs = (value) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
};

const toSnapshotPost = (post) => ({
  postId: post?.postId || '',
  viewCount: Number(post?.viewCount || 0),
  likeCount: Number(post?.likeCount || 0),
  commentCount: Number(post?.commentCount || 0),
});

const snapshotStore = {
  async ensureDir() {
    await mkdir(dataDir, { recursive: true });
  },

  async load() {
    let raw;
    try {
      raw = await readFile(join(dataDir, SNAPSHOT_FILE), 'utf-8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('[snapshot-store] read snapshots.json failed', toErrorMessage(error));
      }
      return { snapshots: [], lastFetch: null };
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('[snapshot-store] corrupted snapshots.json', toErrorMessage(error));
      return { snapshots: [], lastFetch: null };
    }
  },

  async save(data) {
    await this.ensureDir();
    await writeFile(join(dataDir, SNAPSHOT_FILE), JSON.stringify(data, null, 2));
  },

  async saveSnapshot(data, meta = {}) {
    return saveSnapshot(data, meta);
  },

  /** 스냅샷 맵 생성 (postId → [{date, viewCount}]) */
  buildSnapshotMap(snapshots) {
    const map = {};
    for (const snap of snapshots) {
      for (const p of snap.posts || []) {
        if (!map[p.postId]) map[p.postId] = [];
        map[p.postId].push({ date: snap.date, viewCount: p.viewCount });
      }
    }
    return map;
  },
};

/**
 * 공용 스냅샷 저장 함수 (manual + cron 공유)
 */
export async function saveSnapshot(data, meta = {}) {
  return queuedSave(async () => {
    const now = new Date();
    const snapshotId = toSnapshotId(now);
    const reason = meta?.reason === 'cron' ? 'cron' : 'manual';
    const snapshotDate = now.toISOString();
    const posts = (data?.posts || data?.items || []).map(toSnapshotPost).filter(p => p.postId);

    const store = await snapshotStore.load();
    const existing = Array.isArray(store?.snapshots) ? store.snapshots : [];
    const retentionDays = Math.max(1, Number(SNAPSHOT_RETENTION_DAYS || 90));
    const cutoff = Date.now() - (retentionDays * 86400000);

    const recentSnapshots = existing.filter((snap) => {
      const ms = toDateMs(snap?.date);
      if (ms === null) return true;
      return ms >= cutoff;
    });

    const entry = {
      id: snapshotId,
      date: snapshotDate,
      reason,
      posts,
    };

    const nextStore = {
      snapshots: [...recentSnapshots, entry],
      lastFetch: data?.fetchedAt || snapshotDate,
    };

    const snapshotPath = join(dataDir, SNAPSHOT_ARCHIVE_DIR, `${snapshotId}.json`);

    try {
      await snapshotStore.save(nextStore);
      await mkdir(join(dataDir, SNAPSHOT_ARCHIVE_DIR), { recursive: true });
      await writeFile(snapshotPath, JSON.stringify({
        snapshotId,
        reason,
        savedAt: snapshotDate,
        fetchedAt: data?.fetchedAt || snapshotDate,
        sources: data?.sources || {},
        postCount: posts.length,
        posts,
      }, null, 2));
      return { snapshotId, path: snapshotPath };
    } catch (error) {
      console.error('[snapshot-store] write failed', toErrorMessage(error));
      return { snapshotId, path: null, error: toErrorMessage(error) };
    }
  });
}

export default snapshotStore;
