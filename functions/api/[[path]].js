// Cloudflare Pages runs this for every request to /api/*. The API itself is in server/app.js.
import { handle } from '../../server/app.js';

export function onRequest(context) {
  return handle(context.request, context.env);
}
