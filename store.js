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
     * Показ состояния: загрузка / не найден / каталог / корзина
     */
    function showState(state, options) {
        const loading = document.getElementById('storeLoading');
        const notFound = document.getElementById('storeNotFound');
        const catalog = document.getElementById('storeCatalog');
        const cartPage = document.getElementById('storeCartPage');
        const loadingText = document.getElementById('storeLoadingText');
        const notFoundReason = document.getElementById('storeNotFoundReason');

        loading.classList.add('hidden');
        notFound.classList.add('hidden');
        catalog.classList.add('hidden');
        if (cartPage) cartPage.classList.add('hidden');

        if (state === 'loading') {
            loading.classList.remove('hidden');
            if (options && options.message) loadingText.textContent = options.message;
        } else if (state === 'notFound') {
            notFound.classList.remove('hidden');
            if (options && options.reason) notFoundReason.textContent = options.reason;
        } else if (state === 'catalog') {
            catalog.classList.remove('hidden');
        } else if (state === 'cart' && cartPage) {
            cartPage.classList.remove('hidden');
        }
    }

    /**
     * Роутинг по hash: '' | cart
     */
    function getRoute() {
        const hash = (location.hash || '').replace(/^#/, '').replace(/\/$/, '') || '';
        return hash === 'cart' ? 'cart' : '';
    }

    function applyRoute() {
        closeCartDrawer();
        const route = getRoute();
        if (route === 'cart' && storeOwnerUid) {
            showState('cart');
            renderCartPage();
        } else if (storeOwnerUid) {
            showState('catalog');
            renderCatalog();
        }
    }

    /**
     * Обновление шапки (из настроек магазина)
     */
    function updateHeader(title, description) {
        const titleEl = document.getElementById('storeTitle');
        const descEl = document.getElementById('storeDescription');
        const logoLink = document.getElementById('storeLogoLink');
        if (titleEl) titleEl.textContent = title || 'Магазин';
        if (descEl) descEl.textContent = description || '';
        if (logoLink) logoLink.href = storeOwnerUid ? '#' : '#';
    }

    // Загруженные данные магазина (ownerUid, store config, storeProducts)
    let storeOwnerUid = null;
    let storeConfig = null;
    let storeProductsData = null;
    let storeSubdomain = null;

    /**
     * Корзина — ключ localStorage по поддомену
     */
    function getCartStorageKey() {
        return storeSubdomain ? 'store_cart_' + storeSubdomain : 'store_cart';
    }

    function getCart() {
        try {
            const raw = localStorage.getItem(getCartStorageKey());
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function setCart(items) {
        const key = getCartStorageKey();
        localStorage.setItem(key, JSON.stringify(items));
        updateCartUI();
    }

    function addToCart(productIndex, qty) {
        const p = storeProductsData[productIndex];
        if (!p || p.inCatalog === false) return;
        const items = getCart();
        const idx = items.findIndex(x => x.productIndex === productIndex);
        const addQty = qty || 1;
        if (idx >= 0) {
            items[idx].qty += addQty;
        } else {
            items.push({
                productIndex,
                name: p.name || 'Товар',
                price: parseFloat(p.price) || 0,
                productId: p.productId || null,
                qty: addQty
            });
        }
        setCart(items);
    }

    function updateCartQty(productIndex, delta) {
        const items = getCart();
        const idx = items.findIndex(x => x.productIndex === productIndex);
        if (idx < 0) return;
        items[idx].qty += delta;
        if (items[idx].qty <= 0) items.splice(idx, 1);
        setCart(items);
    }

    function removeFromCart(productIndex) {
        const items = getCart().filter(x => x.productIndex !== productIndex);
        setCart(items);
    }

    function getCartTotal() {
        return getCart().reduce((s, x) => s + x.price * x.qty, 0);
    }

    function clearCart() {
        setCart([]);
    }

    /**
     * Обновление UI корзины: иконка, drawer, страница
     */
    function updateCartUI() {
        const items = getCart();
        const total = getCartTotal();
        const count = items.reduce((s, x) => s + x.qty, 0);

        const btn = document.getElementById('storeCartBtn');
        const countEl = document.getElementById('storeCartCount');
        if (btn) {
            btn.classList.toggle('hidden', !storeOwnerUid);
            btn.classList.toggle('store-cart-btn--has-items', count > 0);
        }
        if (countEl) countEl.textContent = count;

        // Drawer
        const drawerList = document.getElementById('storeCartDrawerList');
        const drawerEmpty = document.getElementById('storeCartDrawerEmpty');
        const drawerFooter = document.getElementById('storeCartDrawerFooter');
        const drawerTotalVal = document.getElementById('storeCartDrawerTotalVal');
        if (drawerList) drawerList.innerHTML = renderCartItemsHtml(items, true);
        if (drawerEmpty) drawerEmpty.classList.toggle('hidden', items.length > 0);
        if (drawerFooter) drawerFooter.classList.toggle('hidden', items.length === 0);
        if (drawerTotalVal) drawerTotalVal.textContent = total.toFixed(0);

        // Страница /cart
        if (getRoute() === 'cart') renderCartPage();
    }

    function renderCartItemsHtml(items, isDrawer) {
        return items.map(x => {
            const pid = 'cart-' + x.productIndex;
            const sub = isDrawer ? 'storeCartDrawer' : 'storeCartPage';
            return `
                <div class="store-cart-item" data-product-index="${x.productIndex}">
                    <div class="store-cart-item-name">${escapeStoreHtml(x.name)}</div>
                    <div class="store-cart-item-price">${(x.price).toFixed(0)} ₽</div>
                    <div class="store-cart-item-qty">
                        <button type="button" class="store-cart-qty-btn" data-action="minus" data-index="${x.productIndex}" aria-label="Уменьшить">−</button>
                        <span>${x.qty}</span>
                        <button type="button" class="store-cart-qty-btn" data-action="plus" data-index="${x.productIndex}" aria-label="Увеличить">+</button>
                    </div>
                    <div class="store-cart-item-sum">${(x.price * x.qty).toFixed(0)} ₽</div>
                    <button type="button" class="store-cart-item-remove" data-index="${x.productIndex}" aria-label="Удалить">&times;</button>
                </div>`;
        }).join('');
    }

    function escapeStoreHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    /**
     * Рендер каталога
     */
    function renderCatalog() {
        const catalog = document.getElementById('storeCatalog');
        if (!catalog) return;

        const all = storeProductsData || [];
        const products = all.map((p, idx) => ({ ...p, _origIdx: idx })).filter(p => p.inCatalog !== false);
        if (products.length === 0) {
            catalog.innerHTML = '<p class="store-catalog-empty">В каталоге пока нет товаров</p>';
            return;
        }

        catalog.innerHTML = products.map((p) => {
            const idx = p._origIdx;
            const imgUrl = p.imageUrl || '';
            const imgHtml = imgUrl
                ? `<img src="${escapeStoreHtml(imgUrl)}" alt="" class="store-card-img">`
                : '<div class="store-card-placeholder">📦</div>';
            return `
                <article class="store-card" data-product-index="${idx}">
                    <div class="store-card-media">${imgHtml}</div>
                    <div class="store-card-body">
                        <h3 class="store-card-title">${escapeStoreHtml(p.name || 'Товар')}</h3>
                        <div class="store-card-price">${(parseFloat(p.price) || 0).toFixed(0)} ₽</div>
                        <button type="button" class="btn-primary store-card-add" data-index="${idx}">Добавить в корзину</button>
                    </div>
                </article>`;
        }).join('');

        catalog.querySelectorAll('.store-card-add').forEach(btn => {
            btn.addEventListener('click', () => {
                addToCart(parseInt(btn.dataset.index));
            });
        });
    }

    /**
     * Рендер страницы корзины /cart
     */
    function renderCartPage() {
        const list = document.getElementById('storeCartList');
        const empty = document.getElementById('storeCartEmpty');
        const footer = document.getElementById('storeCartFooter');
        const totalVal = document.getElementById('storeCartTotalVal');
        const checkoutBtn = document.getElementById('storeCheckoutBtn');
        if (!list) return;

        const items = getCart();
        const total = getCartTotal();

        list.innerHTML = renderCartItemsHtml(items, false);
        if (empty) empty.classList.toggle('hidden', items.length > 0);
        if (footer) footer.classList.toggle('hidden', items.length === 0);
        if (totalVal) totalVal.textContent = total.toFixed(0);

        if (checkoutBtn) checkoutBtn.onclick = openCheckoutModal;

        // Делегирование: qty, remove
        list.querySelectorAll('.store-cart-qty-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const idx = parseInt(btn.dataset.index);
                updateCartQty(idx, action === 'plus' ? 1 : -1);
            });
        });
        list.querySelectorAll('.store-cart-item-remove').forEach(btn => {
            btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.index)));
        });
    }

    /**
     * Drawer: открыть/закрыть
     */
    function openCartDrawer() {
        const drawer = document.getElementById('storeCartDrawer');
        if (drawer) {
            drawer.classList.add('store-cart-drawer--open');
            drawer.setAttribute('aria-hidden', 'false');
        }
    }

    function closeCartDrawer() {
        const drawer = document.getElementById('storeCartDrawer');
        if (drawer) {
            drawer.classList.remove('store-cart-drawer--open');
            drawer.setAttribute('aria-hidden', 'true');
        }
    }

    /**
     * Форма оформления заказа
     */
    function openCheckoutModal() {
        const total = getCartTotal();
        const minAmount = storeConfig && storeConfig.minOrderAmount != null ? parseFloat(storeConfig.minOrderAmount) : null;
        if (minAmount != null && total < minAmount) {
            alert(`Минимальная сумма заказа: ${minAmount.toFixed(0)} ₽. Ваша сумма: ${total.toFixed(0)} ₽.`);
            return;
        }
        document.getElementById('storeCheckoutModal').classList.remove('hidden');
    }

    function closeCheckoutModal() {
        document.getElementById('storeCheckoutModal').classList.add('hidden');
    }

    async function submitOrder() {
        const name = (document.getElementById('storeBuyerName') && document.getElementById('storeBuyerName').value || '').trim();
        const email = (document.getElementById('storeBuyerEmail') && document.getElementById('storeBuyerEmail').value || '').trim();
        const phone = (document.getElementById('storeBuyerPhone') && document.getElementById('storeBuyerPhone').value || '').trim();
        const comment = (document.getElementById('storeBuyerComment') && document.getElementById('storeBuyerComment').value || '').trim();

        if (!name || !email) {
            alert('Заполните имя и email');
            return;
        }

        const items = getCart();
        if (items.length === 0) {
            alert('Корзина пуста');
            return;
        }

        const total = getCartTotal();
        const orderData = {
            ownerUid: storeOwnerUid,
            subdomain: storeSubdomain,
            items: items.map(x => ({ name: x.name, price: x.price, qty: x.qty, productId: x.productId })),
            total: Math.round(total * 100) / 100,
            buyerName: name,
            buyerEmail: email,
            buyerPhone: phone || '',
            comment: comment || '',
            createdAt: new Date().toISOString(),
            status: 'new'
        };

        const db = firebase.database();
        const ordersRef = db.ref('storeOrders');
        try {
            document.getElementById('storeCheckoutSubmitBtn').disabled = true;
            await ordersRef.push(orderData);
            clearCart();
            closeCheckoutModal();
            document.getElementById('storeCheckoutForm').reset();
            document.getElementById('storeOrderSuccess').classList.remove('hidden');
            setTimeout(() => document.getElementById('storeOrderSuccess').classList.add('hidden'), 2500);
            if (getRoute() === 'cart') location.hash = '';
            applyRoute();
        } catch (e) {
            console.error('[Store] submitOrder error:', e);
            alert('Ошибка отправки заказа. Попробуйте позже.');
        } finally {
            document.getElementById('storeCheckoutSubmitBtn').disabled = false;
        }
    }

    /**
     * Привязка событий
     */
    function bindStoreEvents() {
        const cartBtn = document.getElementById('storeCartBtn');
        const drawer = document.getElementById('storeCartDrawer');
        const drawerClose = drawer && drawer.querySelector('.store-cart-drawer-close');
        const drawerBackdrop = drawer && drawer.querySelector('.store-cart-drawer-backdrop');
        const drawerPanel = drawer && drawer.querySelector('.store-cart-drawer-panel');
        const form = document.getElementById('storeCheckoutForm');
        const backdrop = document.querySelector('.store-checkout-backdrop');

        if (cartBtn) cartBtn.addEventListener('click', openCartDrawer);
        if (drawerClose) drawerClose.addEventListener('click', closeCartDrawer);
        if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeCartDrawer);
        if (drawerPanel) {
            drawerPanel.addEventListener('click', (e) => {
                const btn = e.target.closest('.store-cart-qty-btn');
                if (btn) {
                    const action = btn.dataset.action;
                    const idx = parseInt(btn.dataset.index);
                    updateCartQty(idx, action === 'plus' ? 1 : -1);
                    e.preventDefault();
                }
                const remove = e.target.closest('.store-cart-item-remove');
                if (remove) {
                    removeFromCart(parseInt(remove.dataset.index));
                    e.preventDefault();
                }
            });
        }
        if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitOrder(); });
        if (backdrop) backdrop.addEventListener('click', closeCheckoutModal);

        const backLink = document.getElementById('storeBackToCatalog');
        if (backLink) backLink.addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
    }

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
            storeSubdomain = subdomainKey;

            const storeProductsSnap = await db.ref('users/' + uid + '/storeProducts').once('value');
            const raw = storeProductsSnap.val();
            storeProductsData = raw && typeof raw === 'object' ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];

            updateHeader(store.title || 'Магазин', store.description || '');
            bindStoreEvents();
            window.addEventListener('hashchange', applyRoute);
            applyRoute();
            updateCartUI();
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
