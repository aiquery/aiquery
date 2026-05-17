type CrawlOptions = {
  maxPages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  allowedPaths?: string[];
  allowedUrls?: string[];
};

type CrawlCacheEntry = {
  timestamp: number;
  content: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const crawlCache = new Map<string, CrawlCacheEntry>();

const DEFAULT_OPTIONS: Required<CrawlOptions> = {
  maxPages: 30,
  maxDepth: 2,
  timeoutMs: 10000,
  allowedPaths: [],
  allowedUrls: []
};

const stripHtml = (html: string): string => {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutTags)
    .replace(/\s+/g, ' ')
    .trim();
};

const decodeEntities = (text: string): string => {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
};

const extractLinks = (html: string, baseUrl: string): string[] => {
  const links: string[] = [];
  const regex = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }
    try {
      const url = new URL(href, baseUrl);
      links.push(url.toString());
    } catch {
      continue;
    }
  }
  return links;
};

const isSameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
};

const isAllowedPath = (url: string, allowedPaths: string[]): boolean => {
  if (allowedPaths.length === 0) return true;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    return allowedPaths.some((allowed) => {
      const normalized = allowed.replace(/\/+$/, '') || '/';
      if (normalized === '/') {
        return path === '/';
      }
      return path === normalized || path.startsWith(`${normalized}/`);
    });
  } catch {
    return false;
  }
};

const isAllowedUrl = (url: string, allowedUrls: string[]): boolean => {
  if (allowedUrls.length === 0) return true;
  return allowedUrls.some((allowed) => {
    if (!allowed) return false;
    return url === allowed || url.replace(/\/+$/, '') === allowed.replace(/\/+$/, '');
  });
};

const fetchHtml = async (url: string, timeoutMs: number): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AIqueryBot/1.0 (+https://aiquery.ai)'
      }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const crawlWebsiteContent = async (
  baseUrl: string,
  options: CrawlOptions = {}
): Promise<string> => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const cached = crawlCache.get(baseUrl);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.content;
  }

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  const pageTexts: string[] = [];

  while (queue.length > 0 && visited.size < config.maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) {
      continue;
    }
    if (!isSameOrigin(current.url, baseUrl)) {
      continue;
    }
    if (!isAllowedPath(current.url, config.allowedPaths)) {
      continue;
    }
    if (!isAllowedUrl(current.url, config.allowedUrls)) {
      continue;
    }
    visited.add(current.url);

    const html = await fetchHtml(current.url, config.timeoutMs);
    if (!html) {
      continue;
    }

    const pageText = stripHtml(html);
    if (pageText) {
      pageTexts.push(`URL: ${current.url}\n${pageText}`);
    }

    if (current.depth < config.maxDepth) {
      const links = extractLinks(html, current.url);
      links.forEach(link => {
        if (!visited.has(link) && isSameOrigin(link, baseUrl) && isAllowedPath(link, config.allowedPaths)) {
          queue.push({ url: link, depth: current.depth + 1 });
        }
      });
    }
  }

  const combined = pageTexts.join('\n\n').trim();
  crawlCache.set(baseUrl, { timestamp: now, content: combined });
  return combined;
};
