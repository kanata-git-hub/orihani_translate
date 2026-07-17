import localforage from 'localforage';

export interface TranslationSession {
  id: string;
  title: string;
  totalPages: number;
  createdAt: number;
}

export interface TranslationPage {
  id: string;
  sessionId: string;
  pageIndex: number;
  originalImageBase64: string;
  translatedImageBase64: string;
  blocks: any[];
}

const sessionsStore = localforage.createInstance({
  name: 'ais-translator',
  storeName: 'sessions'
});

const pagesStore = localforage.createInstance({
  name: 'ais-translator',
  storeName: 'pages'
});

export const db = {
  async createSession(title: string, totalPages: number): Promise<TranslationSession> {
    const session: TranslationSession = {
      id: Date.now().toString(),
      title,
      totalPages,
      createdAt: Date.now()
    };
    await sessionsStore.setItem(session.id, session);
    return session;
  },
  
  async savePage(page: TranslationPage): Promise<void> {
    await pagesStore.setItem(page.id, page);
  },

  async getSession(id: string): Promise<TranslationSession | null> {
    return await sessionsStore.getItem(id);
  },

  async getSessionPages(sessionId: string): Promise<TranslationPage[]> {
    const pages: TranslationPage[] = [];
    await pagesStore.iterate((value: TranslationPage) => {
      if (value.sessionId === sessionId) {
        pages.push(value);
      }
    });
    return pages.sort((a, b) => a.pageIndex - b.pageIndex);
  },

  async getAllSessions(): Promise<TranslationSession[]> {
    const sessions: TranslationSession[] = [];
    await sessionsStore.iterate((value: TranslationSession) => {
      sessions.push(value);
    });
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }
};
