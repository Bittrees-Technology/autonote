# AutoNote SEO review — September 28, 2026

## Improvements

- Descriptive search title and description explain private meeting notes and on-device audio transcription without claiming automatic bot attendance.
- Server-rendered canonical URLs for the homepage and privacy page, including query-string variants of the homepage.
- Separate privacy-page search and social metadata.
- Open Graph and Twitter large-card metadata using a static 1200×630 PNG (about 71 KB). Design follows the existing waveform icon and green palette; source SVG and generator are included.
- Existing SVG icon retained; added multi-size ICO favicon and 180×180 Apple touch icon.
- Public sitemap includes only homepage and privacy page. No misleading build-time last-modified dates.
- Robots rules exclude API and connection routes, while explicit noindex headers and private-page metadata prevent authorization pages appearing in search. These are crawler instructions, not access controls.
- Preview builds receive noindex metadata and disallow crawling.
- Homepage includes WebSite and SoftwareApplication structured data with no fabricated reviews, ratings, or ranking guarantees.
- Legacy production alias redirect is permanent; canonical production host remains autonote.bittrees.org.

## Validation

Production build passed. HTTP checks against the built application verified the initial HTML contains landing content, correct canonicals, social image references, icons, valid structured data, two public sitemap URLs, and private-page noindex. Image dimensions and content types verified. Social card visually inspected; adjusted waveform spacing to keep the label clear. Existing application logic moved unchanged into a client component so the homepage can own server metadata.

## Follow-up

Submit https://autonote.bittrees.org/sitemap.xml to the verified Search Console property when its signed-in session is available. Monitor indexing and actual search queries before adding new public content. Google decides when to recrawl and which titles/snippets to show; no immediate ranking claim is made. Social platforms may cache older previews.

References:
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
