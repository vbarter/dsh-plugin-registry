export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.dsplugin.app") {
    url.hostname = "dsplugin.app";
    return Response.redirect(url.toString(), 301);
  }
  const res = await context.next();
  if (!url.searchParams.has("lang")) return res;
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, follow");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
