import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const videoHistoryFilePath = path.join(__dirname, '../data/videoHistory.json');

function ensureVideoHistoryFile(): void {
  const dataDir = path.dirname(videoHistoryFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  if (!fs.existsSync(videoHistoryFilePath)) {
    fs.writeFileSync(videoHistoryFilePath, JSON.stringify([]));
  }
}

export function getVideoHistory(): VideoHistoryResponse {
  ensureVideoHistoryFile();
  
  try {
    const data = fs.readFileSync(videoHistoryFilePath, 'utf-8');
    const history = JSON.parse(data) as VideoHistoryItem[];
    history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return {
      success: true,
      history,
    };
  } catch (error) {
    console.error('Error reading video history:', error);
    return {
      success: true,
      history: [],
    };
  }
}

export function addToVideoHistory(item: Omit<VideoHistoryItem, 'id' | 'createdAt'>): VideoHistoryResponse {
  ensureVideoHistoryFile();
  
  try {
    const data = fs.readFileSync(videoHistoryFilePath, 'utf-8');
    const history = JSON.parse(data) as VideoHistoryItem[];
    
    const newItem: VideoHistoryItem = {
      ...item,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    
    history.unshift(newItem);
    
    fs.writeFileSync(videoHistoryFilePath, JSON.stringify(history, null, 2));
    
    return {
      success: true,
      history,
    };
  } catch (error) {
    console.error('Error adding to video history:', error);
    return {
      success: false,
      history: [],
    };
  }
}

export function deleteFromVideoHistory(id: string): VideoDeleteResponse {
  ensureVideoHistoryFile();
  
  try {
    const data = fs.readFileSync(videoHistoryFilePath, 'utf-8');
    const history = JSON.parse(data) as VideoHistoryItem[];
    
    const itemToDelete = history.find(item => item.id === id);
    const filteredHistory = history.filter((item) => item.id !== id);
    
    if (itemToDelete?.videoUrl) {
      const fileName = path.basename(itemToDelete.videoUrl);
      const videoPath = path.join(__dirname, '../public/images', fileName);
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
    }
    
    fs.writeFileSync(videoHistoryFilePath, JSON.stringify(filteredHistory, null, 2));
    
    return {
      success: true,
    };
  } catch (error) {
    console.error('Error deleting from video history:', error);
    return {
      success: false,
    };
  }
}

export function clearVideoHistory(): VideoDeleteResponse {
  ensureVideoHistoryFile();
  
  try {
    const data = fs.readFileSync(videoHistoryFilePath, 'utf-8');
    const history = JSON.parse(data) as VideoHistoryItem[];
    
    for (const item of history) {
      if (item.videoUrl) {
        const fileName = path.basename(item.videoUrl);
        const videoPath = path.join(__dirname, '../public/images', fileName);
        if (fs.existsSync(videoPath)) {
          try {
            fs.unlinkSync(videoPath);
          } catch (e) {
            console.error('Error deleting video file:', e);
          }
        }
      }
    }
    
    fs.writeFileSync(videoHistoryFilePath, JSON.stringify([]));
    return {
      success: true,
    };
  } catch (error) {
    console.error('Error clearing video history:', error);
    return {
      success: false,
    };
  }
}
