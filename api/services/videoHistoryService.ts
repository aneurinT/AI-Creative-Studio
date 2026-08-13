import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db/index.js';
import type { VideoHistoryRow } from './db/types.js';

export interface VideoHistoryItem {
  id: string;
  prompt: string;
  style: string;
  duration: string;
  videoUrl: string;
  createdAt: string;
}

export interface VideoHistoryResponse {
  success: boolean;
  history: VideoHistoryItem[];
}

export interface VideoDeleteResponse {
  success: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imagesDir = path.join(__dirname, '../public/images');

// ===== 行映射 =====

function fromRow(r: VideoHistoryRow): VideoHistoryItem {
  return {
    id: r.id,
    prompt: r.prompt,
    style: r.style,
    duration: r.duration,
    videoUrl: r.video_url,
    createdAt: r.created_at,
  };
}

function toRow(item: VideoHistoryItem): VideoHistoryRow {
  return {
    id: item.id,
    prompt: item.prompt,
    style: item.style,
    duration: item.duration,
    video_url: item.videoUrl,
    created_at: item.createdAt,
  };
}

/** 删除视频物理文件（业务副作用，与存储无关） */
function deleteVideoFile(videoUrl: string): void {
  if (!videoUrl) return;
  const fileName = path.basename(videoUrl);
  const videoPath = path.join(imagesDir, fileName);
  if (fs.existsSync(videoPath)) {
    try {
      fs.unlinkSync(videoPath);
    } catch (e) {
      console.error('Error deleting video file:', e);
    }
  }
}

export function getVideoHistory(): VideoHistoryResponse {
  try {
    const rows = getDb().getHistoryTable().query({ orderBy: 'created_at', desc: true });
    const history = rows.map(fromRow);
    return { success: true, history };
  } catch (error) {
    console.error('Error reading video history:', error);
    return { success: true, history: [] };
  }
}

export function addToVideoHistory(item: Omit<VideoHistoryItem, 'id' | 'createdAt'>): VideoHistoryResponse {
  try {
    const newItem: VideoHistoryItem = {
      ...item,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };

    getDb().getHistoryTable().upsert(toRow(newItem));

    // 返回最新列表（按创建时间降序）
    const rows = getDb().getHistoryTable().query({ orderBy: 'created_at', desc: true });
    const history = rows.map(fromRow);
    return { success: true, history };
  } catch (error) {
    console.error('Error adding to video history:', error);
    return { success: false, history: [] };
  }
}

export function deleteFromVideoHistory(id: string): VideoDeleteResponse {
  try {
    const table = getDb().getHistoryTable();
    const row = table.get(id);

    if (row) {
      deleteVideoFile(row.video_url);
    }

    table.delete(id);
    return { success: true };
  } catch (error) {
    console.error('Error deleting from video history:', error);
    return { success: false };
  }
}

export function clearVideoHistory(): VideoDeleteResponse {
  try {
    const table = getDb().getHistoryTable();
    const rows = table.all();

    // 删除所有视频物理文件
    for (const row of rows) {
      deleteVideoFile(row.video_url);
    }

    table.deleteWhere(() => true);
    return { success: true };
  } catch (error) {
    console.error('Error clearing video history:', error);
    return { success: false };
  }
}
