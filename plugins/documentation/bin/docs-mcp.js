#!/usr/bin/env node
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const INTERNAL_PLUGIN_ID = 'documentation';
export const TOOL_PREFIX = 'documentation';
export const ENV_PREFIX = 'RELAY_DOCUMENTATION_MCP';
export const SERVER_NAME = INTERNAL_PLUGIN_ID;
export const SERVER_VERSION = '0.1.0';
export const DEFAULT_DOCS_BASE_URL = 'https://docs.relay.md';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const TOOL_NAMES = Object.freeze({
  search: `${TOOL_PREFIX}_search`,
  read: `${TOOL_PREFIX}_read`,
  status: `${TOOL_PREFIX}_status`,
});

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for',
  'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'the',
  'to', 'with', 'what', 'when', 'where', 'why',
]);

const TOOLS = [
  {
    name: TOOL_NAMES.search,
    title: 'Search public Relay docs',
    description: 'Search public Relay documentation and return source-linked excerpts. Use only these returned sources for answers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Relay setup, feature, pricing, or troubleshooting question.',
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          description: 'Maximum result count. Defaults to 5.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: TOOL_NAMES.read,
    title: 'Read public Relay docs page',
    description: 'Read a public Relay documentation page from the cached docs corpus by URL, path, or title.',
    inputSchema: {
      type: 'object',
      properties: {
        pathOrUrl: {
          type: 'string',
          minLength: 1,
          description: 'docs.relay.md URL, path, title, or page id from search results.',
        },
        maxChars: {
          type: 'integer',
          minimum: 500,
          maximum: 20000,
          description: 'Maximum characters to return. Defaults to 8000.',
        },
      },
      required: ['pathOrUrl'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: TOOL_NAMES.status,
    title: 'Show Relay docs corpus status',
    description: 'Show public docs corpus source, freshness, cache state, and fallback status.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

export function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT
    ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function pluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA
    ? path.resolve(process.env.CLAUDE_PLUGIN_DATA)
    : path.join(os.homedir(), '.cache', 'relay', INTERNAL_PLUGIN_ID);
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeDocsBaseUrl(value = process.env[`${ENV_PREFIX}_BASE_URL`] ?? DEFAULT_DOCS_BASE_URL) {
  return String(value || DEFAULT_DOCS_BASE_URL).replace(/\/+$/, '');
}

function snapshotPaths(root = pluginRoot()) {
  const snapshots = path.join(root, 'snapshots');
  return {
    llms: path.join(snapshots, 'llms.txt'),
    llmsFull: path.join(snapshots, 'llms-full.txt'),
    manifest: path.join(snapshots, 'corpus-manifest.json'),
    metadata: path.join(snapshots, 'llms-metadata.json'),
  };
}

function cachePath(dataDir = pluginDataDir()) {
  return path.join(dataDir, 'corpus-cache.json');
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readSnapshot(root = pluginRoot()) {
  const paths = snapshotPaths(root);
  const [llms, llmsFull, manifest, metadata] = await Promise.all([
    fsp.readFile(paths.llms, 'utf8'),
    fsp.readFile(paths.llmsFull, 'utf8'),
    readJsonIfExists(paths.manifest),
    readJsonIfExists(paths.metadata),
  ]);
  const generatedAt = typeof metadata?.generated_at === 'string'
    ? metadata.generated_at
    : manifest?.generatedAt ?? null;
  const llmsFullSha = sha256Hex(llmsFull);
  const metadataLlmsFullSha = metadataSha(metadata, 'llms-full.txt');
  return {
    source: 'bundle',
    sourceUrl: null,
    metadataUrl: null,
    llms,
    llmsFull,
    fetchedAt: generatedAt,
    generatedAt,
    sha256: metadataLlmsFullSha ?? llmsFullSha,
    computedSha256: llmsFullSha,
    manifest: metadata ?? manifest,
    metadataError: null,
    refreshError: null,
  };
}

async function readCache(dataDir = pluginDataDir()) {
  const cached = await readJsonIfExists(cachePath(dataDir));
  if (!cached || typeof cached.llmsFull !== 'string' || typeof cached.llms !== 'string') {
    return null;
  }
  return {
    source: 'cache',
    sourceUrl: cached.sourceUrl ?? null,
    metadataUrl: cached.metadataUrl ?? null,
    llms: cached.llms,
    llmsFull: cached.llmsFull,
    fetchedAt: cached.fetchedAt ?? null,
    generatedAt: cached.generatedAt ?? cached.fetchedAt ?? null,
    sha256: cached.sha256 ?? sha256Hex(cached.llmsFull),
    computedSha256: cached.computedSha256 ?? sha256Hex(cached.llmsFull),
    manifest: cached.manifest ?? null,
    metadataError: cached.metadataError ?? null,
    refreshError: null,
  };
}

function isFresh(corpus, now = Date.now()) {
  if (!corpus?.fetchedAt) return false;
  const fetchedAt = Date.parse(corpus.fetchedAt);
  return Number.isFinite(fetchedAt) && now - fetchedAt < CACHE_TTL_MS;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': `relay.${INTERNAL_PLUGIN_ID}/${SERVER_VERSION}` },
    });
    if (!res.ok) {
      throw new Error(`${url} returned HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonIfAvailable(url, timeoutMs) {
  try {
    const text = await fetchText(url, timeoutMs);
    return JSON.parse(text);
  } catch (err) {
    return {
      unavailable: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function metadataSha(metadata, fileName) {
  const entry = metadata?.files?.[fileName] ?? metadata?.files?.[fileName.replace('-', '_')];
  return typeof entry?.sha256 === 'string' && entry.sha256 ? entry.sha256 : null;
}

function persistentCacheEnabled(opts = {}) {
  return opts.writeCache === true || process.env[`${ENV_PREFIX}_WRITE_CACHE`] === '1';
}

async function refreshCorpus(opts = {}) {
  const baseUrl = normalizeDocsBaseUrl(opts.baseUrl);
  const timeoutMs = opts.timeoutMs ?? Number(process.env[`${ENV_PREFIX}_FETCH_TIMEOUT_MS`] || 2500);
  const [llms, llmsFull, metadata] = await Promise.all([
    fetchText(`${baseUrl}/llms.txt`, timeoutMs),
    fetchText(`${baseUrl}/llms-full.txt`, timeoutMs),
    fetchJsonIfAvailable(`${baseUrl}/llms-metadata.json`, timeoutMs),
  ]);
  const fetchedAt = new Date().toISOString();
  const llmsFullSha = sha256Hex(llmsFull);
  const metadataLlmsFullSha = metadataSha(metadata, 'llms-full.txt');
  const corpus = {
    source: 'remote',
    sourceUrl: `${baseUrl}/llms-full.txt`,
    metadataUrl: metadata?.unavailable ? null : `${baseUrl}/llms-metadata.json`,
    llms,
    llmsFull,
    fetchedAt,
    generatedAt: typeof metadata?.generated_at === 'string' ? metadata.generated_at : fetchedAt,
    sha256: metadataLlmsFullSha ?? llmsFullSha,
    computedSha256: llmsFullSha,
    manifest: metadata?.unavailable ? null : metadata,
    metadataError: metadata?.unavailable ? metadata.error : null,
    refreshError: null,
  };
  if (persistentCacheEnabled(opts)) {
    const dataDir = opts.dataDir ?? pluginDataDir();
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(cachePath(dataDir), JSON.stringify({
      sourceUrl: corpus.sourceUrl,
      llms,
      llmsFull,
      fetchedAt,
      generatedAt: corpus.generatedAt,
      sha256: corpus.sha256,
      computedSha256: corpus.computedSha256,
      metadataUrl: corpus.metadataUrl,
      metadataError: corpus.metadataError,
      manifest: corpus.manifest,
    }, null, 2), { mode: 0o600 });
  }
  return corpus;
}

export async function loadCorpus(opts = {}) {
  const dataDir = opts.dataDir ?? pluginDataDir();
  const root = opts.root ?? pluginRoot();
  const [snapshot, cache] = await Promise.all([
    readSnapshot(root),
    readCache(dataDir),
  ]);
  const bestLocal = cache ?? snapshot;
  if (process.env[`${ENV_PREFIX}_DISABLE_REFRESH`] === '1' || opts.disableRefresh) {
    return attachPages(bestLocal);
  }
  if (cache && isFresh(cache, opts.nowMs)) {
    return attachPages(cache);
  }
  try {
    return attachPages(await refreshCorpus({
      baseUrl: opts.baseUrl,
      dataDir,
      timeoutMs: opts.timeoutMs,
      writeCache: opts.writeCache,
    }));
  } catch (err) {
    return attachPages({
      ...bestLocal,
      refreshError: err instanceof Error ? err.message : String(err),
    });
  }
}

function attachPages(corpus) {
  const pages = parseLlmsFull(corpus.llmsFull);
  return {
    ...corpus,
    pages,
    pageCount: pages.length,
  };
}

export function parseLlmsFull(text) {
  const pages = [];
  const pattern = /(?:^|\n)## ([^\n]+)\n\nURL: ([^\n]+)\n\n([\s\S]*?)(?=\n## |\s*$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const title = decodeHtmlEntities(match[1].trim());
    const url = match[2].trim();
    const body = cleanupPageText(match[3]);
    if (!title || !url || !body) continue;
    pages.push({
      id: pageIdFromUrl(url),
      title,
      url,
      text: body,
    });
  }
  return pages;
}

function cleanupPageText(value) {
  return decodeHtmlEntities(value)
    .replace(/\(function \(\) \{ var btn = document\.getElementById\('theme-toggle'\);[\s\S]*?syncLabel\(\); \}\)\(\);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function pageIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+|\/+$/g, '') || 'home';
  } catch {
    return String(url).replace(/^\/+|\/+$/g, '') || 'home';
  }
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^https?:\/\/docs\.relay\.md\/?/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function tokenize(query) {
  return Array.from(new Set(
    String(query || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((word) => word.length > 1 && !STOP_WORDS.has(word)) ?? [],
  ));
}

export function searchPages(pages, query, maxResults = 5) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const phrase = String(query || '').trim().toLowerCase();
  return pages
    .map((page) => {
      const score = scorePage(page, tokens, phrase);
      return score > 0 ? {
        id: page.id,
        title: page.title,
        url: page.url,
        score,
        excerpt: bestExcerpt(page.text, tokens),
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, clampInteger(maxResults, 1, 10, 5));
}

function scorePage(page, tokens, phrase) {
  const title = page.title.toLowerCase();
  const url = page.url.toLowerCase();
  const text = page.text.toLowerCase();
  let score = phrase && text.includes(phrase) ? 25 : 0;
  for (const token of tokens) {
    score += countOccurrences(title, token) * 12;
    score += countOccurrences(url, token) * 4;
    score += Math.min(countOccurrences(text, token), 20);
  }
  return score;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function bestExcerpt(text, tokens, maxChars = 520) {
  const lower = text.toLowerCase();
  let best = -1;
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  const center = best === -1 ? 0 : best;
  const start = Math.max(0, center - Math.floor(maxChars / 3));
  const end = Math.min(text.length, start + maxChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export function findPage(pages, pathOrUrl) {
  const wanted = normalizeKey(pathOrUrl);
  return pages.find((page) => normalizeKey(page.url) === wanted)
    ?? pages.find((page) => normalizeKey(page.id) === wanted)
    ?? pages.find((page) => normalizeKey(page.title) === wanted)
    ?? pages.find((page) => normalizeKey(page.title).includes(wanted))
    ?? null;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function freshness(corpus) {
  const fetchedMs = corpus.fetchedAt ? Date.parse(corpus.fetchedAt) : NaN;
  const ageSeconds = Number.isFinite(fetchedMs)
    ? Math.max(0, Math.round((Date.now() - fetchedMs) / 1000))
    : null;
  return {
    source: corpus.source,
    sourceUrl: corpus.sourceUrl,
    fetchedAt: corpus.fetchedAt,
    generatedAt: corpus.generatedAt,
    cacheAgeSeconds: ageSeconds,
    sha256: corpus.sha256,
    computedSha256: corpus.computedSha256 ?? null,
    metadataUrl: corpus.metadataUrl ?? null,
    metadataError: corpus.metadataError ?? null,
    refreshError: corpus.refreshError,
  };
}

export async function callRelayDocsTool(name, args = {}, opts = {}) {
  const corpus = await loadCorpus(opts);
  switch (name) {
    case TOOL_NAMES.status:
      return {
        ok: true,
        command: name,
        docsBaseUrl: normalizeDocsBaseUrl(opts.baseUrl),
        pageCount: corpus.pageCount,
        freshness: freshness(corpus),
        nextAction: corpus.refreshError
          ? 'Using cached or bundled docs. Check network access to docs.relay.md if current docs are required.'
          : null,
        boundaries: [
          'Public Relay documentation only.',
          'No Relay account, workspace, Obsidian vault, Relay API, or Relay Comms access.',
        ],
      };
    case TOOL_NAMES.search: {
      const query = requiredString(args.query, 'query');
      const results = searchPages(corpus.pages, query, args.maxResults);
      return {
        ok: true,
        command: name,
        query,
        resultCount: results.length,
        results,
        freshness: freshness(corpus),
        instruction: 'Answer only from these results and cite the returned docs.relay.md URLs.',
      };
    }
    case TOOL_NAMES.read: {
      const pathOrUrl = requiredString(args.pathOrUrl, 'pathOrUrl');
      const page = findPage(corpus.pages, pathOrUrl);
      if (!page) {
      throw new RelayDocsMcpError('page_not_found', `No Relay docs page matched "${pathOrUrl}". Search first, then read one of the returned URLs.`);
      }
      const maxChars = clampInteger(args.maxChars, 500, 20000, 8000);
      const text = page.text.slice(0, maxChars);
      return {
        ok: true,
        command: name,
        id: page.id,
        title: page.title,
        url: page.url,
        text,
        totalChars: page.text.length,
        truncated: text.length < page.text.length,
        freshness: freshness(corpus),
        instruction: 'Answer only from this page text and cite the URL.',
      };
    }
    default:
      throw new RelayDocsMcpError('unknown_tool', `Unknown Relay docs MCP tool: ${name}`);
  }
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RelayDocsMcpError('bad_request', `Relay docs MCP input "${fieldName}" is required.`);
  }
  return value.trim();
}

class RelayDocsMcpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toolResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function toolError(err) {
  const payload = {
    ok: false,
    error: {
      code: err?.code ?? 'documentation_mcp_failed',
      message: err instanceof Error ? err.message : String(err),
    },
  };
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export async function handleJsonRpcMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message;
  if (id === undefined || id === null) return null;
  try {
    switch (method) {
      case 'initialize':
        return response(id, {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
      case 'tools/list':
        return response(id, { tools: TOOLS });
      case 'tools/call':
        return response(id, await callToolForRpc(params));
      case 'resources/list':
        return response(id, { resources: [] });
      case 'prompts/list':
        return response(id, { prompts: [] });
      case 'ping':
        return response(id, {});
      default:
        return errorResponse(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return errorResponse(id, -32000, err instanceof Error ? err.message : String(err));
  }
}

async function callToolForRpc(params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  try {
    return toolResult(await callRelayDocsTool(name, args));
  } catch (err) {
    return toolError(err);
  }
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function startMcpServer({ stdin = process.stdin, stdout = process.stdout } = {}) {
  let buffer = '';
  let processing = Promise.resolve();
  let writing = Promise.resolve();

  async function writeNdjson(message) {
    writing = writing.then(() => new Promise((resolve) => {
      stdout.write(`${JSON.stringify(message)}\n`, resolve);
    }));
    await writing;
  }

  async function processLine(rawLine) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) return;
    try {
      const reply = await handleJsonRpcMessage(JSON.parse(line));
      if (reply) await writeNdjson(reply);
    } catch (err) {
      await writeNdjson(errorResponse(null, -32700, err instanceof Error ? err.message : String(err)));
    }
  }

  stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processing = processing.then(() => processLine(line));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startMcpServer();
}
