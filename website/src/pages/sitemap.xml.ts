import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { sitemapXml } from '../lib/docs';

// Every page of the site, the docs included as they're added.
export const GET: APIRoute = async ({ site }) => {
  const docs = await getCollection('docs', (d) => d.slug !== 'index');
  const paths = ['/', '/docs/', ...docs.map((d) => `/docs/${d.slug}/`)];
  return new Response(sitemapXml(site?.href ?? 'https://kubebay.sardar.dev', paths), {
    headers: { 'Content-Type': 'application/xml' },
  });
};
