import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { ANALYSIS } from '../config.js';

const dataDir = ANALYSIS.snapshotDir;

const snapshotStore = {
  async ensureDir() {
    await mkdir(dataDir, { recursive: true });
  },

  async load() {
    try {
      const raw = await readFile(join(dataDir, 'snapshots.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { snapshots: [], lastFetch: null };
    }
  },

  async save(data) {
    await this.ensureDir();
    await writeFile(join(dataDir, 'snapshots.json'), JSON.stringify(data, null, 2));
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

export default snapshotStore;
