/**
 * Vercel Edge Middleware — роутинг по поддомену (без Next.js).
 * app.my-3d-print.ru → index.html (Manager)
 * *.my-3d-print.ru → store.html (Store)
 *
 * Используем fetch для прокси, т.к. NextResponse.rewrite требует Next.js.
 * План: store_landing_feature_bf77f04f.plan.md, §3.1, §3.2
 */

const MANAGER_HOST = 'app.my-3d-print.ru';
const STORE_DOMAIN = 'my-3d-print.ru';

export default async function middleware(request) {
    const host = request.headers.get('host') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    // Перехватываем только корень и index.html
    const isRoot = path === '/' || path === '' || path === '/index.html';
    if (!isRoot) return;

    // app.my-3d-print.ru → Manager (index.html)
    if (host === MANAGER_HOST) {
        return fetch(new URL('/index.html', url.origin), { headers: request.headers });
    }

    // *.my-3d-print.ru (любой поддомен) → Store (store.html)
    if (host.endsWith('.' + STORE_DOMAIN) || host === STORE_DOMAIN) {
        return fetch(new URL('/store.html', url.origin), { headers: request.headers });
    }

    return;
}
