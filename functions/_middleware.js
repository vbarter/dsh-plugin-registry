export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.dsplugin.app") {
    url.hostname = "dsplugin.app";
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
