import { Marked } from 'marked';
import { getCache, setCache } from './cache';
import { fetchWithRetry } from './fetch';

const GITLAB = 'https://repo.getmonero.org';
const PROJECT_PATH = 'monero-project/ccs-proposals';
const MR_IID = 709;

export const CCS_MR_URL = `${GITLAB}/${PROJECT_PATH}/-/merge_requests/${MR_IID}`;
const API_MR_URL = `${GITLAB}/api/v4/projects/${encodeURIComponent(PROJECT_PATH)}/merge_requests/${MR_IID}`;

export interface TocEntry {
  id: string;
  depth: number;
  html: string;
}

export interface CcsProposal {
  title: string;
  authors: string;
  amount: number | null;
  state: 'opened' | 'merged' | 'closed' | string;
  createdAt: string;
  html: string;
  toc: TocEntry[];
}

export interface CcsComment {
  id: string;
  url: string;
  createdAt: string;
  html: string;
  isProposalAuthor: boolean;
  author: { name: string; username: string; url: string };
}

export interface CcsThread {
  id: string;
  comments: CcsComment[];
}

export interface CcsData {
  proposal: CcsProposal | null;
  threads: CcsThread[] | null;
}

interface RawCcsData {
  mr: any | null;
  proposalFile: string | null;
  discussions: any[] | null;
}

async function fetchJson(url: string): Promise<{ data: any; headers: Headers }> {
  const response = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} responded with status ${response.status}`);
  }
  return { data: await response.json(), headers: response.headers };
}

/** The merge request and the proposal file it adds, read from the commit it points at. */
async function fetchProposal(): Promise<{ mr: any; proposalFile: string }> {
  const [{ data: mr }, { data: changes }] = await Promise.all([
    fetchJson(API_MR_URL),
    fetchJson(`${API_MR_URL}/changes`),
  ]);

  const file = changes.changes?.find(
    (change: any) => !change.deleted_file && change.new_path.endsWith('.md')
  );
  if (!file) {
    throw new Error('The merge request does not contain a proposal file');
  }

  const rawUrl =
    `${GITLAB}/api/v4/projects/${mr.source_project_id}/repository/files/` +
    `${encodeURIComponent(file.new_path)}/raw?ref=${mr.sha}`;
  const response = await fetchWithRetry(rawUrl);
  if (!response.ok) {
    throw new Error(`${rawUrl} responded with status ${response.status}`);
  }
  return { mr, proposalFile: await response.text() };
}

/**
 * The notes API needs a login, so this reads the JSON that the merge request
 * page itself loads. It is paginated with a cursor header.
 */
async function fetchDiscussions(): Promise<any[]> {
  const discussions: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const url: string =
      `${CCS_MR_URL}/discussions.json?per_page=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const { data, headers } = await fetchJson(url);
    discussions.push(...data);
    cursor = headers.get('x-next-page-cursor');
    if (!cursor) break;
  }
  return discussions;
}

async function fetchRaw(): Promise<RawCcsData> {
  const cacheKey = `ccs-mr-${MR_IID}`;
  const cached = getCache<RawCcsData>(cacheKey);
  if (cached) return cached;

  const [proposal, discussions] = await Promise.allSettled([fetchProposal(), fetchDiscussions()]);
  if (proposal.status === 'rejected') console.warn('Failed to fetch the CCS proposal:', proposal.reason);
  if (discussions.status === 'rejected') console.warn('Failed to fetch the CCS discussion:', discussions.reason);

  const raw: RawCcsData = {
    mr: proposal.status === 'fulfilled' ? proposal.value.mr : null,
    proposalFile: proposal.status === 'fulfilled' ? proposal.value.proposalFile : null,
    discussions: discussions.status === 'fulfilled' ? discussions.value : null,
  };
  if (raw.mr && raw.discussions) setCache(cacheKey, raw);
  return raw;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Returns an absolute http(s)/mailto URL, an in-page `#anchor`, or null for anything else. */
function safeUrl(href: string, allowAnchors: boolean): string | null {
  if (href.startsWith('#')) return allowAnchors ? href : `${CCS_MR_URL}${href}`;
  try {
    const url = new URL(href, `${CCS_MR_URL}/`);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Renders GitLab markdown. The proposal is our own document, so it is `trusted`:
 * raw HTML and images pass through. Comments come from anyone with a GitLab
 * account, so there raw HTML is escaped and images become plain links.
 */
function renderMarkdown(markdown: string, trusted: boolean): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const usedIds = new Set<string>();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        // Comments get one flat heading level below the page's own headings.
        if (!trusted) return `<h4>${inner}</h4>\n`;

        const label = inner.replace(/<[^>]+>/g, '');
        const base = label.toLowerCase().replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
        let id = base;
        for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
        usedIds.add(id);
        toc.push({ id, depth, html: label });
        // CCS proposals start at `###`. The page title is the h1, so move them up one level.
        const level = Math.min(6, Math.max(2, depth - 1));
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      html({ text }) {
        return trusted ? text : escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = safeUrl(href, trusted);
        if (!url) return inner;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        if (url.startsWith('#')) return `<a href="${escapeHtml(url)}"${titleAttr}>${inner}</a>`;
        return `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
      },
      image({ href, text }) {
        const url = safeUrl(href, false);
        if (!url) return escapeHtml(text);
        if (!trusted) {
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(text || 'image')}</a>`;
        }
        const caption = text ? `<figcaption>${escapeHtml(text)}</figcaption>` : '';
        return (
          `<figure><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
          `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}" loading="lazy" /></a>${caption}</figure>`
        );
      },
      text(token) {
        if ('tokens' in token && token.tokens) return this.parser.parseInline(token.tokens);
        const html = 'escaped' in token && token.escaped ? token.text : escapeHtml(token.text);
        if (trusted) return html;
        // Link @mentions to the GitLab profile.
        return html.replace(
          /(^|[^\w/@.])@([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)/g,
          (_match, before, username) =>
            `${before}<a href="${GITLAB}/${username}" target="_blank" rel="noopener noreferrer nofollow">@${username}</a>`
        );
      },
    },
  });

  const html = (marked.parse(markdown, { async: false }) as string)
    // A paragraph that holds only figures is not a paragraph.
    .replace(/<p>((?:<figure>.*?<\/figure>\s*)+)<\/p>/gs, '$1')
    .replace(/<table>/g, '<div class="ccs-table"><table>')
    .replace(/<\/table>/g, '</table></div>');

  return { html, toc };
}

/** Reads the few front matter fields of a CCS proposal file that the page shows. */
function parseProposalFile(file: string) {
  const match = file.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontMatter = match ? match[1] : '';
  const body = match ? file.slice(match[0].length) : file;

  const field = (name: string): string | null => {
    const line = frontMatter.match(new RegExp(`^${name}:[ \\t]*(.+)$`, 'm'));
    return line ? line[1].trim().replace(/^(["'])(.*)\1$/, '$2') : null;
  };

  const amount = parseFloat(field('amount') ?? '');
  return {
    title: field('title'),
    authors: field('author'),
    amount: Number.isFinite(amount) ? amount : null,
    body,
  };
}

export async function getCcsData(): Promise<CcsData> {
  const raw = await fetchRaw();

  let proposal: CcsProposal | null = null;
  if (raw.mr && raw.proposalFile) {
    const parsed = parseProposalFile(raw.proposalFile);
    const { html, toc } = renderMarkdown(parsed.body, true);
    proposal = {
      title: parsed.title ?? raw.mr.title,
      authors: parsed.authors ?? raw.mr.author.name,
      amount: parsed.amount,
      state: raw.mr.state,
      createdAt: raw.mr.created_at,
      html,
      toc,
    };
  }

  let threads: CcsThread[] | null = null;
  if (raw.discussions) {
    threads = raw.discussions
      .map((discussion: any) => ({
        id: String(discussion.id),
        comments: discussion.notes
          .filter((note: any) => !note.system)
          .map(
            (note: any): CcsComment => ({
              id: String(note.id),
              url: `${CCS_MR_URL}#note_${note.id}`,
              createdAt: note.created_at,
              html: renderMarkdown(note.note ?? '', false).html,
              isProposalAuthor: Boolean(note.is_noteable_author),
              author: {
                name: note.author.name,
                username: note.author.username,
                url: `${GITLAB}/${note.author.username}`,
              },
            })
          ),
      }))
      .filter((thread: CcsThread) => thread.comments.length > 0);
  }

  return { proposal, threads };
}
