// The full catalog is committed at data/plugins.json for discover, ingest, and
// GitHub raw consumers. It is over Cloudflare Pages' 25 MiB per-file asset
// limit, so the Pages upload omits it. This route keeps the public URL working.
// GitHub raw sends Access-Control-Allow-Origin: *, so fetch() can follow.
export const RAW_CATALOG =
  "https://raw.githubusercontent.com/vbarter/dsh-plugin-registry/main/data/plugins.json";

export function onRequest() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: RAW_CATALOG,
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
