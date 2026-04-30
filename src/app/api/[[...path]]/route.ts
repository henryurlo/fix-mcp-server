import type { NextRequest } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

async function handler(request: NextRequest) {
  // pathname is /api/status, /api/orders, etc.
  // Pass through to backend as-is
  const url = `${BACKEND}${request.nextUrl.pathname}${request.nextUrl.search}`;

  try {
    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    const accept = request.headers.get('accept');
    if (contentType) headers.set('Content-Type', contentType);
    if (accept) headers.set('Accept', accept);

    const res = await fetch(url, {
      method: request.method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : null,
      cache: 'no-store',
    });

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', res.headers.get('content-type') || 'application/json');
    responseHeaders.set('Cache-Control', res.headers.get('cache-control') || 'no-store');
    if (res.headers.get('connection')) {
      responseHeaders.set('Connection', res.headers.get('connection') as string);
    }

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
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
