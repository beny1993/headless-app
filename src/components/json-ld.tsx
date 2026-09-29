import { jsonLdHtml, type StructuredData } from '@/lib/seo';

/**
 * Structured data for search engines, in the server-rendered HTML where a
 * crawler reads it. `jsonLdHtml` escapes it, so the admin-entered text inside
 * cannot close the tag.
 */
export function JsonLd({ data }: { data: StructuredData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }}
    />
  );
}
