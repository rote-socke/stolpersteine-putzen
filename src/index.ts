import data from '../public/data/locations.json';
import { createApi, type Env } from './api.ts';

const api = createApi({ locationIds: new Set(data.locations.map((l: { id: string }) => l.id)) });

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return api(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
