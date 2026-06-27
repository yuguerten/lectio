export function createAnnotationStore(adapter) {
  return {
    async load(articleId) {
      const value = await adapter.get(keyFor(articleId));
      return Array.isArray(value?.annotations) ? value.annotations : [];
    },

    async save(articleId, annotations) {
      await adapter.set(keyFor(articleId), { annotations });
      return annotations;
    },

    async delete(articleId) {
      await adapter.remove(keyFor(articleId));
    }
  };
}


export function createRemoteAnnotationStore({ endpoint, getToken, fetchImpl = globalThis.fetch }) {
  if (!endpoint) throw new Error("Remote annotation endpoint is required.");
  if (!fetchImpl) throw new Error("Fetch is unavailable.");

  return {
    async load(articleId) {
      const response = await fetchImpl(`${endpoint}?articleId=${encodeURIComponent(articleId)}`, {
        headers: authHeaders(getToken)
      });
      const payload = await parseJsonResponse(response);
      return Array.isArray(payload.notes) ? payload.notes : [];
    },

    async save(articleId, annotations) {
      const response = await fetchImpl(`${endpoint}?articleId=${encodeURIComponent(articleId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders(getToken) },
        body: JSON.stringify({ notes: annotations })
      });
      const payload = await parseJsonResponse(response);
      return Array.isArray(payload.notes) ? payload.notes : annotations;
    },

    async delete(articleId) {
      await this.save(articleId, []);
    }
  };
}

export function createDrawingStore(adapter) {
  return {
    async load(articleId) {
      const value = await adapter.get(drawingKeyFor(articleId));
      return Array.isArray(value?.strokes) ? value.strokes : [];
    },

    async save(articleId, strokes) {
      await adapter.set(drawingKeyFor(articleId), { strokes });
      return strokes;
    },

    async delete(articleId) {
      await adapter.remove(drawingKeyFor(articleId));
    }
  };
}


export function createSmartOutlineStore(adapter) {
  return {
    async load(articleId, signature) {
      const value = await adapter.get(smartOutlineKeyFor(articleId));
      if (!value || value.signature !== signature || !Array.isArray(value.sections)) return null;
      return value;
    },

    async save(articleId, outline) {
      await adapter.set(smartOutlineKeyFor(articleId), outline);
      return outline;
    },

    async delete(articleId) {
      await adapter.remove(smartOutlineKeyFor(articleId));
    }
  };
}

export function createBookmarkStore(adapter) {
  return {
    async list() {
      const value = await adapter.get(bookmarkIndexKey());
      return Array.isArray(value?.bookmarks) ? value.bookmarks : [];
    },

    async load(articleId) {
      const value = await adapter.get(bookmarkArticleKeyFor(articleId));
      return value?.article || null;
    },

    async save(article) {
      if (!article?.id) throw new Error("Cannot bookmark an article without an id.");

      const savedAt = new Date().toISOString();
      const bookmark = {
        id: article.id,
        title: article.title || "Untitled article",
        url: article.url || article.id,
        pageUrl: article.pageUrl || article.url || article.id,
        canonicalUrl: article.canonicalUrl || "",
        excerpt: article.excerpt || "",
        byline: article.byline || "",
        siteName: article.siteName || "",
        savedAt
      };
      const bookmarks = await this.list();
      const nextBookmarks = [bookmark, ...bookmarks.filter((item) => item.id !== article.id)];

      await Promise.all([
        adapter.set(bookmarkIndexKey(), { bookmarks: nextBookmarks }),
        adapter.set(bookmarkArticleKeyFor(article.id), { article: { ...article, bookmarkedAt: savedAt } })
      ]);

      return bookmark;
    },

    async delete(articleId) {
      const bookmarks = await this.list();
      await Promise.all([
        adapter.set(bookmarkIndexKey(), { bookmarks: bookmarks.filter((item) => item.id !== articleId) }),
        adapter.remove(bookmarkArticleKeyFor(articleId))
      ]);
    }
  };
}

export function createChromeStorageAdapter(area = globalThis.chrome?.storage?.local) {
  if (!area) {
    throw new Error("Chrome storage is unavailable.");
  }

  return {
    get(key) {
      return area.get(key).then((result) => result[key]);
    },
    set(key, value) {
      return area.set({ [key]: value });
    },
    remove(key) {
      return area.remove(key);
    }
  };
}

export function createMemoryStorageAdapter(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    }
  };
}

function keyFor(articleId) {
  return `openread:annotations:${articleId}`;
}

function drawingKeyFor(articleId) {
  return `openread:drawings:${articleId}`;
}

function smartOutlineKeyFor(articleId) {
  return `openread:smartOutline:${articleId}`;
}

function bookmarkIndexKey() {
  return "openread:bookmarks";
}

function bookmarkArticleKeyFor(articleId) {
  return `openread:bookmark:${articleId}`;
}


function authHeaders(getToken) {
  const token = getToken?.();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}
