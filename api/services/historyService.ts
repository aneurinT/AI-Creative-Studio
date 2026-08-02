import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface HistoryItem {
  id: string;
  prompt: string;
  style: string;
  imageUrl: string;
  createdAt: string;
}

export interface HistoryResponse {
  success: boolean;
  history: HistoryItem[];
}

export interface DeleteResponse {
  success: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyFilePath = path.join(__dirname, '../data/history.json');

function ensureHistoryFile(): void {
  const dataDir = path.dirname(historyFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  if (!fs.existsSync(historyFilePath)) {
    fs.writeFileSync(historyFilePath, JSON.stringify([]));
  }
}

export function getHistory(): HistoryResponse {
  ensureHistoryFile();
  
  try {
    const data = fs.readFileSync(historyFilePath, 'utf-8');
    const history = JSON.parse(data) as HistoryItem[];
    return {
      success: true,
      history,
    };
  } catch (error) {
    console.error('Error reading history:', error);
    return {
      success: true,
      history: [],
    };
  }
}

export function addToHistory(item: Omit<HistoryItem, 'id' | 'createdAt'>): HistoryResponse {
  ensureHistoryFile();
  
  try {
    const data = fs.readFileSync(historyFilePath, 'utf-8');
    const history = JSON.parse(data) as HistoryItem[];
    
    const newItem: HistoryItem = {
      ...item,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    };
    
    history.unshift(newItem);
    
    fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2));
    
    return {
      success: true,
      history,
    };
  } catch (error) {
    console.error('Error adding to history:', error);
    return {
      success: false,
      history: [],
    };
  }
}

export function deleteFromHistory(id: string): DeleteResponse {
  ensureHistoryFile();
  
  try {
    const data = fs.readFileSync(historyFilePath, 'utf-8');
    const history = JSON.parse(data) as HistoryItem[];
    
    const filteredHistory = history.filter((item) => item.id !== id);
    
    fs.writeFileSync(historyFilePath, JSON.stringify(filteredHistory, null, 2));
    
    return {
      success: true,
    };
  } catch (error) {
    console.error('Error deleting from history:', error);
    return {
      success: false,
    };
  }
}

export function clearHistory(): DeleteResponse {
  ensureHistoryFile();
  
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify([]));
    return {
      success: true,
    };
  } catch (error) {
    console.error('Error clearing history:', error);
    return {
      success: false,
    };
  }
}