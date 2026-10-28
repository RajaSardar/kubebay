import { defineCollection, z } from 'astro:content';
import { SECTIONS } from '../lib/docs';

// The usage manual at /docs (root BACKLOG #17). A page's appRoutes are the
// app's routes it documents; src/lib/docs.test.ts fails while any route of
// web/apps/shell/src/App.tsx is in none of them.
const docs = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(SECTIONS),
    order: z.number(),
    appRoutes: z.array(z.string()).default([]),
  }),
});

export const collections = { docs };
