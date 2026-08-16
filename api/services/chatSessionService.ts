import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionType?: 'image' | 'video' | 'remove-bg' | 'compose' | 'modify-video' | 'modify-image';
  params?: Record<string, any>;
  timestamp: number;
  generatedImage?: string;
  generatedVideo?: string;
  isGenerating?: boolean;
  progress?: number;
  agentThoughts?: AgentThought[];
  sessionId?: string;
}

export interface AgentThought {
  agentName: string;
  role: string;
  step: number;
  thought: string;
  action?: string;
  output?: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionResponse {
  success: boolean;
  session: ChatSession;
}

export interface GetSessionsResponse {
  success: boolean;
  sessions: ChatSession[];
}

export interface GetSessionResponse {
  success: boolean;
  session?: ChatSession;
}

export interface UpdateSessionResponse {
  success: boolean;
  session: ChatSession;
}

export interface DeleteSessionResponse {
  success: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionsDir = path.join(__dirname, '../../data/sessions');

function ensureSessionsDir(): void {
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function createSession(userId: string, title?: string): CreateSessionResponse {
  ensureSessionsDir();

  const session: ChatSession = {
    id: generateId(),
    userId,
    title: title || '新会话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const filePath = path.join(sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return { success: true, session };
  } catch (error) {
    console.error('Error creating session:', error);
    return { success: false, session };
  }
}

export function getAllSessions(userId?: string): GetSessionsResponse {
  ensureSessionsDir();

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const sessions: ChatSession[] = [];

    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(sessionsDir, file), 'utf-8');
        const session = JSON.parse(data) as ChatSession;
        // 按 userId 过滤：不传 userId 返回全部（兼容旧数据），传入则只返回该用户的
        if (!userId || session.userId === userId || !session.userId) {
          sessions.push(session);
        }
      } catch {
        continue;
      }
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return { success: true, sessions };
  } catch (error) {
    console.error('Error getting sessions:', error);
    return { success: true, sessions: [] };
  }
}

export function getSession(id: string): GetSessionResponse {
  ensureSessionsDir();

  try {
    const filePath = path.join(sessionsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return { success: false };
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const session = JSON.parse(data) as ChatSession;
    return { success: true, session };
  } catch (error) {
    console.error('Error getting session:', error);
    return { success: false };
  }
}

export function updateSession(id: string, updates: Partial<ChatSession>): UpdateSessionResponse {
  ensureSessionsDir();

  try {
    const filePath = path.join(sessionsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return { success: false, session: { id, userId: '', title: '', messages: [], createdAt: Date.now(), updatedAt: Date.now() } };
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    let session = JSON.parse(data) as ChatSession;

    session = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return { success: true, session };
  } catch (error) {
    console.error('Error updating session:', error);
    return { success: false, session: { id, userId: '', title: '', messages: [], createdAt: Date.now(), updatedAt: Date.now() } };
  }
}

export function addMessageToSession(id: string, message: ChatMessage): UpdateSessionResponse {
  ensureSessionsDir();

  try {
    const filePath = path.join(sessionsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return { success: false, session: { id, userId: '', title: '', messages: [], createdAt: Date.now(), updatedAt: Date.now() } };
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    let session = JSON.parse(data) as ChatSession;

    session.messages.push(message);
    session.updatedAt = Date.now();

    if (!session.title || session.title === '新会话') {
      const firstUserMessage = session.messages.find(m => m.role === 'user');
      if (firstUserMessage) {
        session.title = firstUserMessage.content.substring(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '');
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return { success: true, session };
  } catch (error) {
    console.error('Error adding message:', error);
    return { success: false, session: { id, userId: '', title: '', messages: [], createdAt: Date.now(), updatedAt: Date.now() } };
  }
}

export function deleteSession(id: string): DeleteSessionResponse {
  ensureSessionsDir();

  try {
    const filePath = path.join(sessionsDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (error) {
    console.error('Error deleting session:', error);
    return { success: false };
  }
}

export function clearAllSessions(userId?: string): DeleteSessionResponse {
  ensureSessionsDir();

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = fs.readFileSync(path.join(sessionsDir, file), 'utf-8');
        const session = JSON.parse(data) as ChatSession;
        // 只清理当前用户的会话
        if (!userId || session.userId === userId || !session.userId) {
          fs.unlinkSync(path.join(sessionsDir, file));
        }
      } catch {
        fs.unlinkSync(path.join(sessionsDir, file));
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Error clearing sessions:', error);
    return { success: false };
  }
}