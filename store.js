/**
 * Store SPA — публичный лайт-магазин на поддомене.
 * Документ плана: store_landing_feature_bf77f04f.plan.md
 *
 * Резолв поддомена:
 * location.hostname.split('.')[0] → storesBySubdomain/{subdomain} → ownerUid → store, storeProducts
 */

(function() {
    'use strict';

    // === КОНФИГУРАЦИЯ (тот же проект Firebase, что и Manager) ===
    const firebaseConfig = {
        apiKey: "AIzaSyAC1jhjIEncoLZyoVkPVPs9J1s-cVQeOV4",
        authDomain: "d-print-app-3655b.firebaseapp.com",
        projectId: "d-print-app-3655b",
        storageBucket: "d-print-app-3655b.firebasestorage.app",
        messagingSenderId: "691529808811",
        appId: "1:691529808811:web:a6aec2a47d85d55f41f0ee",
        measurementId: "G-FF384D3F8F",
        databaseURL: "https://d-print-app-3655b-default-rtdb.europe-west1.firebasedatabase.app"
    };

    // Поддомены, зарезервированные для приложения (план §5.5)
    const RESERVED_SUBDOMAINS = ['app', 'www', 'api', 'mail', 'admin', 'store'];

    /**
     * Определяет поддомен по hostname.
     * app.my-3d-print.ru → Manager (не Store)
     * test-shop.my-3d-print.ru → "test-shop"
     * localhost / 127.0.0.1 → для dev-режима поддержка ?store=subdomain
     */
    function getSubdomain() {
        const hostname = window.location.hostname;
        const params = new URLSearchParams(window.location.search);

        // Dev: ?store=test-shop или #store=test-shop (hash переживает редирект 301)
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            const fromQuery = params.get('store');
            if (fromQuery) return fromQuery;
            const hash = location.hash.replace(/^#/, '');
            const hashParams = new URLSearchParams(hash);
            return hashParams.get('store') || null;
        }

        const parts = hostname.split('.');
        // Нужно минимум 3 части: subdomain.domain.tld
        if (parts.length < 3) return null;

        const sub = parts[0].toLowerCase();
        if (!sub || RESERVED_SUBDOMAINS.includes(sub)) return null;
        return sub;
    }

    /**
     * Проверка: текущий host — Store (поддомен) или Manager (app)?
     */
    function isStoreHost() {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return !!new URLSearchParams(window.location.search).get('store');
        }
        const parts = hostname.split('.');
        if (parts.length < 3) return false;
        return !RESERVED_SUBDOMAINS.includes(parts[0].toLowerCase());
    }

    /**
     * Показ состояния: загрузка / не найден / каталог
     */
    function showState(state, options) {
        const loading = document.getElementById('storeLoading');
        const notFound = document.getElementById('storeNotFound');
        const catalog = document.getElementById('storeCatalog');
        const loadingText = document.getElementById('storeLoadingText');
        const notFoundReason = document.getElementById('storeNotFoundReason');

        loading.classList.add('hidden');
        notFound.classList.add('hidden');
        catalog.classList.add('hidden');

        if (state === 'loading') {
            loading.classList.remove('hidden');
            if (options && options.message) loadingText.textContent = options.message;
        } else if (state === 'notFound') {
            notFound.classList.remove('hidden');
            if (options && options.reason) notFoundReason.textContent = options.reason;
        } else if (state === 'catalog') {
            catalog.classList.remove('hidden');
        }
    }

    /**
     * Обновление шапки (из настроек магазина)
     */
    function updateHeader(title, description) {
        const titleEl = document.getElementById('storeTitle');
        const descEl = document.getElementById('storeDescription');
        if (titleEl) titleEl.textContent = title || 'Магазин';
        if (descEl) descEl.textContent = description || '';
    }

    // Для Фазы 4: загруженные данные магазина (ownerUid, store config, storeProducts)
    let storeOwnerUid = null;
    let storeConfig = null;
    let storeProductsData = null;

    /**
     * Детальный лог для диагностики (откройте консоль браузера: F12 → Console).
     */
    function debugLog() {
        const info = {
            href: location.href,
            hostname: location.hostname,
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            subdomain: getSubdomain()
        };
        console.log('[Store] Debug:', JSON.stringify(info, null, 2));
        return info;
    }
    window.STORE_DEBUG = debugLog;

    /**
     * Инициализация Store SPA.
     * Резолв поддомена: storesBySubdomain/{subdomain} → ownerUid → store, storeProducts.
     */
    async function init() {
        debugLog();
        const subdomain = getSubdomain();

        if (!subdomain) {
            showState('notFound', {
                reason: 'Откройте страницу по адресу вида: {subdomain}.my-3d-print.ru (например, test-shop.my-3d-print.ru). ' +
                    'В режиме разработки: store.html?store=test-shop'
            });
            updateHeader('Магазин', 'Поддомен не указан');
            return;
        }

        // Инициализация Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        const db = firebase.database();

        showState('loading', { message: 'Загрузка магазина...' });
        updateHeader('Магазин: ' + subdomain, '');

        try {
            const subdomainKey = subdomain.toLowerCase();
            const subdomainSnap = await db.ref('storesBySubdomain/' + subdomainKey).once('value');
            const subdomainData = subdomainSnap.val();

            if (!subdomainData || !subdomainData.ownerUid) {
                showState('notFound', { reason: 'Магазин не зарегистрирован.' });
                updateHeader('Магазин: ' + subdomain, 'Магазин не найден');
                return;
            }

            const uid = subdomainData.ownerUid;
            const storeSnap = await db.ref('users/' + uid + '/store').once('value');
            const store = storeSnap.val();

            if (!store || store.enabled === false) {
                showState('notFound', { reason: 'Магазин не найден или отключён.' });
                updateHeader('Магазин: ' + subdomain, '');
                return;
            }

            storeOwnerUid = uid;
            storeConfig = store;

            const storeProductsSnap = await db.ref('users/' + uid + '/storeProducts').once('value');
            const raw = storeProductsSnap.val();
            storeProductsData = raw && typeof raw === 'object' ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];

            updateHeader(store.title || 'Магазин', store.description || '');
            showState('catalog');
        } catch (e) {
            console.error('[Store] Firebase error:', e);
            showState('notFound', { reason: 'Ошибка загрузки. Проверьте подключение к интернету.' });
            updateHeader('Магазин: ' + subdomain, '');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
