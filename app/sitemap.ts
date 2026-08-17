import type { MetadataRoute } from 'next';

const BASE = 'https://maily.cfd';

// Blog posts with their real publish dates (kept in sync with each post's
// openGraph.publishedTime).
const BLOG_POSTS: Array<{ slug: string; published: string }> = [
  { slug: 'ai-email-agent-vs-assistant', published: '2026-05-21' },
  { slug: 'ai-inbox-triage-reclaim-calendar', published: '2026-05-20' },
  { slug: 'ai-learns-your-writing-style', published: '2026-05-22' },
  { slug: 'founders-lose-deals-inbox', published: '2026-05-24' },
  { slug: 'zero-knowledge-encryption-email-privacy', published: '2026-05-23' },
  { slug: 'what-is-an-ai-email-employee', published: '2026-07-02' },
  { slug: 'maily-vs-superhuman', published: '2026-07-02' },
  { slug: 'maily-vs-fyxer', published: '2026-07-02' },
  { slug: 'best-ai-email-assistant-solo-founders', published: '2026-07-02' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const pages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/product/boult`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/product/sift`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/product/drafts`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/blogs`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/auth/signup`, lastModified: now, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${BASE}/privacy-policy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/terms-of-service`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const blogs: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${BASE}/blogs/${p.slug}`,
    lastModified: new Date(p.published),
    changeFrequency: 'yearly',
    priority: 0.6,
  }));

  return [...pages, ...blogs];
}
