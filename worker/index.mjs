import { handleRequest } from '../server/reviews.mjs';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
