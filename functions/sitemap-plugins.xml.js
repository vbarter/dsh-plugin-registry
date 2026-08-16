export function onRequest() {
  return new Response("Gone. Use /sitemap.xml.\n", {
    status: 410,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
