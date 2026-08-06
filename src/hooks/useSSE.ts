import { useRef, useCallback } from 'react';

interface SSEOptions {
  onToken?: (token: string) => void;
  onStatus?: (status: string, message: string) => void;
  onResult?: (data: any) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);

  const connect = useCallback((url: string, options: SSEOptions) => {
    // 取消之前的连接
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    const fullUrl = url.includes('?') ? url : url;
    let fullText = '';

    fetch(fullUrl, {
      signal: abortRef.current.signal,
      headers: { 'Accept': 'text/event-stream' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No stream reader');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              try {
                const parsed = JSON.parse(data);
                switch (currentEvent) {
                  case 'token':
                    fullText += parsed.content || '';
                    options.onToken?.(parsed.content || '');
                    break;
                  case 'status':
                    options.onStatus?.(parsed.status, parsed.message);
                    break;
                  case 'result':
                    options.onResult?.(parsed);
                    break;
                  case 'error':
                    options.onError?.(parsed.error);
                    break;
                  case 'done':
                    options.onDone?.();
                    break;
                }
              } catch {
                // 跳过解析失败的行
              }
            }
          }
        }
        options.onDone?.();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          options.onError?.(err.message || '连接失败');
        }
      });

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  return { connect, disconnect };
}
