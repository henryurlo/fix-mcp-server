import type { NextRequest } from 'next/server';

const BACKEND = 'http://127.0.0.1:8000';

async function handler(request: NextRequest) {
  // pathname is /api/status, /api/orders, etc.
  // Pass through to backend as-is
  const url = `${BACKEND}${request.nextUrl.pathname}${request.nextUrl.search}`;

  try {
    const res = await fetch(url, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : null,
    });

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('Proxy error:', err);
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export { handler as GET, handler as POST };
export const dynamic = 'force-dynamic';
