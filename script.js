// Показывает дату, когда файл был сохранен (если сервер отдает Last-Modified header)
console.log("Version: 5.6 (2026-02-17 09-20-59)");

// ==================== КОНФИГУРАЦИЯ ====================

/** Единая конфигурация приложения: лимиты, таймауты. */
const APP_CONFIG = {
    limits: { 
        maxStorageBytes: 1024 * 1024 * 1024, 
        maxFileSizeBytes: 5 * 1024 * 1024, 
        maxCloudFiles: 1000 },
    toast: { 
        errorDurationMs: 6000, 
        successDurationMs: 7000 },
    search: { 
        debounceMs: 300 },
    trialDays: 30
};

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

// Конфигурация для Cloudinary
const cloudinaryConfig = {
  cloudName: "dw4gdz64b",     
  uploadPreset: "hcvbf9f9"
};

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
const USER_LIMITS = {
    maxStorage: APP_CONFIG.limits.maxStorageBytes,
    maxCloudFiles: APP_CONFIG.limits.maxCloudFiles
};

// Текущая статистика пользователя
let userStats = {
    storageUsed: 0,
    filesCount: 0
};

const db = {
    filaments: [], products: [], writeoffs: [], 
    // Исправлены дефолтные значения по скриншотам
    brands: ['eSUN', 'Creality', 'Creality Ender', 'Creality Soleyin'],
	serviceExpenses: [],
    components: [],
	serviceNames: [],
	colors: [ { id: 1, name: 'Белый', hex: '#ffffff' }, { id: 2, name: 'Чёрный', hex: '#000000' }, { id: 3, name: 'Красный', hex: '#ff0000' }, { id: 4, name: 'Синий', hex: '#0000ff' }, { id: 5, name: 'Зелёный', hex: '#00ff00' } ],
    plasticTypes: ['PLA - Basic', 'PLA - Silk', 'PLA - Matte', 'PLA +'],
    filamentStatuses: ['В наличии', 'Израсходовано'],
    printers: [ { id: 1, model: 'Creality K2 Pro', power: 1.3 } ],
    electricityCosts: [
        { id: 1, date: '2025-01-01', cost: 6 },
        { id: 2, date: '2026-01-01', cost: 7 }
    ]
};

let productSnapshotForDirtyCheck = '';
let currentProductImage = null; 
let currentProductFiles = [];   
let dbRef;
let activePreviewProductId = null;
let writeoffSectionCount = 0; // Для списаний
let isModalOpen = false; // Флаг, блокирующий авто-обновление UI при открытых модальных окнах

/** Подтверждение выхода при несохранённых изменениях (открыта модалка с формой). */
window.addEventListener('beforeunload', (e) => {
    if (isModalOpen) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ==================== ИНИЦИАЛИЗАЦИЯ И МНОГОПОЛЬЗОВАТЕЛЬСКАЯ ЛОГИКА ====================

/** Toast-уведомления (ошибки и др.). type: 'error' | 'success' | 'warning' | 'info'. Вынесено сюда, чтобы быть доступным при ошибке инициализации Firebase. */
function showToast(message, type) {
    type = type || 'error';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.textContent = message == null ? '' : String(message);
    container.appendChild(el);
    const ms = type === 'error' ? APP_CONFIG.toast.errorDurationMs : APP_CONFIG.toast.successDurationMs;
    setTimeout(() => { if (el.parentNode) el.remove(); }, ms);
}

// Глобальная переменная для текущего пользователя
let currentUser = null;

try {
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const auth = firebase.auth();
    // dbRef теперь не устанавливается здесь жестко!
} catch (e) {
    console.error("Firebase init error:", e);
    showToast("Ошибка подключения к сервисам Google!", "error");
}

// Управление формами
window.showAuthForm = function(type) {
    ['loginForm', 'registerForm', 'resetForm'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('authMessage').style.display = 'none';
    
    if (type === 'login') document.getElementById('loginForm').classList.remove('hidden');
    if (type === 'register') document.getElementById('registerForm').classList.remove('hidden');
    if (type === 'reset') document.getElementById('resetForm').classList.remove('hidden');
}

// 1. ЛОГИН
document.getElementById('loginBtn')?.addEventListener('click', () => {
    const email = document.getElementById('emailInput').value;
    const pass = document.getElementById('passwordInput').value;
    const msg = document.getElementById('authMessage');
    const btn = document.getElementById('loginBtn');

    if(!email || !pass) return;

    btn.textContent = "Вход...";
    btn.disabled = true;
    msg.style.display = 'none';

    firebase.auth().signInWithEmailAndPassword(email, pass)
        .catch((error) => {
            btn.textContent = "Войти";
            btn.disabled = false;
            msg.textContent = "Ошибка: " + error.message;
            msg.style.display = 'block';
        });
});

// 2. РЕГИСТРАЦИЯ
document.getElementById('regBtn')?.addEventListener('click', () => {
    const email = document.getElementById('regEmailInput').value;
    const pass = document.getElementById('regPasswordInput').value;
    const msg = document.getElementById('authMessage');
    const btn = document.getElementById('regBtn');

    if(!email || !pass) return;

    btn.textContent = "Создание аккаунта...";
    btn.disabled = true;
    msg.style.display = 'none';

    firebase.auth().createUserWithEmailAndPassword(email, pass)
		.then((userCredential) => {
            const uid = userCredential.user.uid;
            
            // === НОВАЯ ЛОГИКА: УСТАНОВКА ПРОБНОГО ПЕРИОДА (30 ДНЕЙ) ===
            const now = new Date();
            const trialEnd = new Date();
            trialEnd.setDate(now.getDate() + APP_CONFIG.trialDays);
            
            const initData = {
                subscription: {
                    status: 'trial',
                    startDate: now.toISOString(),
                    expiryDate: trialEnd.toISOString()
                },
                // Пустые структуры данных
                data: { filaments: [], products: [], writeoffs: [] }
            };

            // Сохраняем начальные данные подписки
            firebase.database().ref('users/' + uid).set(initData).then(() => {
                // Отправка письма
                userCredential.user.sendEmailVerification().then(() => {
                    showToast("Аккаунт создан! Вам предоставлен пробный период. Проверьте почту для подтверждения.", "success");
                });
            });
        })
        .catch((error) => {
            btn.textContent = "Зарегистрироваться";
            btn.disabled = false;
            let text = "Ошибка регистрации";
            if(error.code === 'auth/email-already-in-use') text = "Этот email уже используется.";
            if(error.code === 'auth/weak-password') text = "Пароль слишком простой (мин. 6 символов).";
            msg.textContent = text;
            msg.style.display = 'block';
        });
});

// 3. СБРОС ПАРОЛЯ
document.getElementById('resetBtn')?.addEventListener('click', () => {
    const email = document.getElementById('resetEmailInput').value;
    const msg = document.getElementById('authMessage');
    const btn = document.getElementById('resetBtn');

    if(!email) {
        msg.textContent = "Введите email";
        msg.style.display = 'block';
        return;
    }

    btn.textContent = "Отправка...";
    btn.disabled = true;
    msg.style.display = 'none';

    firebase.auth().sendPasswordResetEmail(email)
        .then(() => {
            msg.style.color = 'green';
            msg.textContent = "Ссылка для сброса отправлена на почту!";
            msg.style.display = 'block';
            btn.textContent = "Отправлено";
        })
        .catch((error) => {
            btn.textContent = "Отправить ссылку";
            btn.disabled = false;
            msg.style.color = '#dc2626';
            msg.textContent = "Ошибка: " + error.message;
            msg.style.display = 'block';
        });
});

// Повторная отправка подтверждения
window.resendVerification = function() {
    const user = firebase.auth().currentUser;
    if(user) {
        const btn = document.getElementById('resendBtn');
        btn.disabled = true;
        btn.textContent = "Отправка...";
        user.sendEmailVerification().then(() => {
            showToast('Письмо отправлено повторно!', 'success');
            btn.textContent = "Отправлено";
        }).catch(e => showToast(e.message, "error"));
    }
}



// === ГЛАВНЫЙ СЛУШАТЕЛЬ АВТОРИЗАЦИИ (ИСПРАВЛЕННЫЙ) ===
window.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async (user) => {
        const overlay = document.getElementById('loginOverlay');
        const authContainer = document.getElementById('authContainer');
        const verifyContainer = document.getElementById('verificationWait');
        
        if (dbRef) dbRef.off();

        if (user) {
            currentUser = user;
            if (!user.emailVerified) {
                authContainer.style.display = 'none';
                verifyContainer.style.display = 'block';
                document.getElementById('verifyEmailSpan').textContent = user.email;
                return;
            }

            if(overlay) overlay.style.display = 'none'; 
            
            // 1. REF ДЛЯ ЗАПИСИ (Оставляем старый путь .../data)
            dbRef = firebase.database().ref('users/' + user.uid + '/data');
            
            // 2. REF ДЛЯ ЧТЕНИЯ (Корень пользователя)
            const userRootRef = firebase.database().ref('users/' + user.uid);
            
            const subRef = firebase.database().ref('users/' + user.uid + '/subscription');
            subRef.on('value', (snapshot) => {
                const subData = snapshot.val();
                if (!subData) {
                    const now = new Date();
                    const end = new Date(); end.setDate(now.getDate() + 30);
                    subRef.set({ status: 'trial', startDate: now.toISOString(), expiryDate: end.toISOString() });
                } else {
                    checkSubscription(subData);
                }
            });

            setupUserSidebar(user);
            showToast(`Добро пожаловать, ${user.email}!`, 'info');
            
            // Превращает значение из Firebase (массив или объект с числовыми ключами) в массив. Избегает ошибки .filter is not a function.
            function toArray(v) {
                if (v == null) return [];
                if (Array.isArray(v)) return v.filter(x => x);
                if (typeof v === 'object') return Object.values(v).filter(x => x);
                return [];
            }
            function toArrayOrDefault(v, defaultArr) {
                const arr = toArray(v);
                return arr.length ? arr : defaultArr;
            }

            // === ИСПРАВЛЕННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ ===
            window.updateAppFromSnapshot = function(snapshot) {
                console.log('Updating UI from Firebase snapshot...');
                const val = snapshot.val(); 
                
                let loadedData = null;
                
                if (val && typeof val === 'object') {
                    if ('data' in val || 'stats' in val || 'subscription' in val) {
                        loadedData = val.data || null;
                        if (val.stats) userStats = val.stats;
                        if (val.settings && val.settings.personalStorageLimit) {
                            USER_LIMITS.maxStorage = val.settings.personalStorageLimit;
                        }
                    }
                    else if (val.products || val.filaments || val.writeoffs) {
                        loadedData = val;
                    }
                    else {
                        if (Object.keys(val).length === 0) loadedData = null;
                        else loadedData = val.data ? val.data : val; 
                    }
                } else {
                    loadedData = null;
                }

                if (userStats.storageUsed === 0 && userStats.filesCount === 0 && loadedData) {
                     recalculateInitialStats(loadedData);
                }

                if (loadedData) {
                    // Нормализуем в массив (Firebase иногда отдаёт объект с ключами 0,1,2)
                    db.filaments = toArray(loadedData.filaments);
                    db.products = toArray(loadedData.products);
                    db.writeoffs = toArray(loadedData.writeoffs);
                    db.serviceExpenses = toArray(loadedData.serviceExpenses);
                    
                    db.brands = toArrayOrDefault(loadedData.brands, db.brands);
                    db.colors = toArrayOrDefault(loadedData.colors, db.colors);
                    db.plasticTypes = toArrayOrDefault(loadedData.plasticTypes, db.plasticTypes);
                    db.filamentStatuses = toArrayOrDefault(loadedData.filamentStatuses, db.filamentStatuses);
                    db.printers = toArrayOrDefault(loadedData.printers, db.printers);
                    db.electricityCosts = toArrayOrDefault(loadedData.electricityCosts, db.electricityCosts);
                    
                    db.components = toArray(loadedData.components);
                    db.serviceNames = toArray(loadedData.serviceNames);
                } else {
                    // Если данных нет вообще (новый юзер), оставляем db как есть (с дефолтами из кода)
					// Но очищаем транзакционные массивы
					db.filaments = []; 
					db.products = []; 
					db.writeoffs = []; 
					db.serviceExpenses = []; 
                    // Справочники НЕ очищаем, они берутся из const db
				}


                recalculateAllProductCosts();
                recalculateAllProductStock();
                updateAllSelects();
                
                try { updateFilamentsTable(); } catch(e) { console.error('Filament update failed', e); }
                try { updateProductsTable(); } catch(e) { console.error('Products update failed', e); }
                try { updateWriteoffTable(); } catch(e) { console.error('Writeoff update failed', e); }
                try { updateReports(); } catch(e) { console.error('Reports update failed', e); }
				try { updateServiceTable(); } catch(e) { console.error('Service update failed', e); } 
                try { updateDashboard(); } catch(e) { console.error('Dashboard update failed', e); }
            };


            // Слушаем корень (setTimeout(0) — откладываем тяжёлую работу, чтобы избежать Violation)
            userRootRef.on('value', (snapshot) => {
                if (isModalOpen) return;
                setTimeout(() => window.updateAppFromSnapshot(snapshot), 0);
            });
            
            loadShowChildren();
            updateAllDates();
            setupEventListeners();

            // АВТОЗАПУСК ТУРА ДЛЯ НОВИЧКОВ (Через БД)
            // Ждем первое обновление данных, чтобы проверить настройки
            userRootRef.child('settings').once('value').then((snap) => {
                const settings = snap.val() || {};
                // Если флаг tourCompleted НЕ стоит — запускаем тур
                if (!settings.tourCompleted) {
                    setTimeout(() => {
                        startOnboardingTour();
                    }, 1500); 
                }
            });
  

        } else { 
            currentUser = null;
            if(overlay) overlay.style.display = 'flex';
            authContainer.style.display = 'block';
            verifyContainer.style.display = 'none';
            db.filaments = []; db.products = []; db.writeoffs = [];
        }
    });
});




function recalculateInitialStats(data) {
    console.log("Первичный подсчет статистики использования...");
    let size = 0;
    let count = 0;
    
    // Cloudinary не отдает размер файла через URL, поэтому мы будем считать 
    // средний размер 300КБ за фото, если точных данных нет в базе.
    // В будущем мы будем сохранять точный size при загрузке.
    
    if (data && data.products) {
        data.products.forEach(p => {
            if (p.imageUrl && p.imageUrl.includes('cloudinary')) {
                count++;
                size += (p.imageSize || 300 * 1024); // Если есть размер - берем, иначе 300кб
            }
            if (p.fileUrls) {
                p.fileUrls.forEach(f => {
                    if (f.url && f.url.includes('cloudinary')) {
                        count++;
                        size += (f.fileSize || 500 * 1024); // Файлы считаем по 500кб
                    }
                });
            }
        });
    }
    
    userStats = { storageUsed: size, filesCount: count };
    // Сохраняем в Firebase
    firebase.database().ref('users/' + firebase.auth().currentUser.uid + '/stats').set(userStats);
}


function setupUserSidebar(user) {
    // Если меню уже построено, не дублируем
    if (document.getElementById('logoutBtn')) return; 

    const controlsContainer = document.getElementById('sidebarControls');
    const userContainer = document.getElementById('sidebarUserInfo');

    // === ГРУППА 1: Инструкции и Выход ===
    
    // 1. Инструкция
    const helpBtn = document.createElement('button');
    helpBtn.className = 'menu-item';
    helpBtn.innerHTML = `
        <span class="menu-icon" style="color: #60a5fa; font-weight: bold; font-size: 16px;">?</span>
        <span class="menu-text">Инструкция</span>
    `;
    helpBtn.onclick = () => document.getElementById('helpModal').classList.add('active');
    controlsContainer.appendChild(helpBtn);

    // 2. Выход
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'menu-item';
    logoutBtn.id = 'logoutBtn';
    logoutBtn.innerHTML = `<span class="menu-icon">🚪</span><span class="menu-text">Выйти</span>`;
    logoutBtn.onclick = () => { if(confirm('Выйти из аккаунта?')) firebase.auth().signOut().then(() => window.location.reload()); };
    controlsContainer.appendChild(logoutBtn);


    // === ГРУППА 2: Профиль (Прижато к низу) ===

    // 3. Email
    const userDiv = document.createElement('div');
    userDiv.className = 'user-profile-info menu-item';
    userDiv.style.borderTop = 'none'; // Убираем старую границу
    userDiv.style.marginTop = '0';
    userDiv.style.paddingTop = '8px';
    userDiv.style.cursor = 'default';
    userDiv.title = user.email;
    userDiv.innerHTML = `
        <span class="user-profile-icon menu-icon">👤</span>
        <span class="menu-text" style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(user.email)}</span>
    `;
    userContainer.appendChild(userDiv);

    // 4. ID
    const uidDiv = document.createElement('div');
    uidDiv.className = 'menu-item';
    uidDiv.style.fontSize = '11px';
    uidDiv.style.color = '#64748b';
    uidDiv.title = 'Нажмите, чтобы скопировать ID';
    const shortUid = user.uid.substring(0, 8) + '...';
    
    uidDiv.innerHTML = `
        <span class="menu-icon" style="font-size:14px">🆔</span>
        <span class="menu-text">ID: <span style="font-family:monospace;">${shortUid}</span></span>
    `;
    uidDiv.onclick = function() {
        navigator.clipboard.writeText(user.uid).then(() => {
            const textSpan = uidDiv.querySelector('.menu-text');
            if(textSpan) {
                const oldText = textSpan.innerHTML;
                textSpan.textContent = 'Скопировано!';
                setTimeout(() => textSpan.innerHTML = oldText, 1500);
            }
        });
    };
    userContainer.appendChild(uidDiv);

    // 5. Статус подписки
    const subDiv = document.createElement('div');
    subDiv.id = 'sidebarSubStatus';
    subDiv.className = 'menu-item';
    subDiv.style.fontSize = '11px';
    subDiv.innerHTML = `
        <span class="menu-icon">⏳</span>
        <span class="menu-text">Загрузка...</span>
    `;
    userContainer.appendChild(subDiv);

    // 6. Разделитель
    const divider = document.createElement('div');
    divider.className = 'sidebar-divider';
    userContainer.appendChild(divider);

    // 7. Поддержка (Последний пункт)
    const supportDiv = document.createElement('div');
    supportDiv.className = 'menu-item';
    supportDiv.innerHTML = `
        <span class="menu-icon">💬</span>
        <a href="https://t.me/Artem_Kiyashko" target="_blank" class="menu-text" style="color: #94a3b8; text-decoration: none;">Связаться</a>
    `;
    const link = supportDiv.querySelector('a');
    supportDiv.addEventListener('mouseenter', () => { if(link) link.style.color = '#fff'; });
    supportDiv.addEventListener('mouseleave', () => { if(link) link.style.color = '#94a3b8'; });
    userContainer.appendChild(supportDiv);
}


// ==================== CLOUD & DATA ====================
// Загрузка файлов выполняется через Cloudinary (см. uploadFileToCloud ниже).

async function uploadFileToCloud(file) {
    if (!file) return null;

    // --- ПРОВЕРКА ЛИМИТОВ ---
    if (userStats.storageUsed + file.size > USER_LIMITS.maxStorage) {
        showToast(`Превышен лимит хранилища (${(USER_LIMITS.maxStorage/1024/1024).toFixed(0)} МБ). Удалите старые фото или свяжитесь с администратором.`, "error");
        return null;
    }
    
    // --- ПРОВЕРКА РАЗМЕРА ФАЙЛА (Client side check) ---
    if (file.size > APP_CONFIG.limits.maxFileSizeBytes) {
        showToast(`Файл слишком большой! Максимум ${APP_CONFIG.limits.maxFileSizeBytes / 1024 / 1024} МБ.`, "error");
        return null;
    }

	// Cloudinary может загружать любые типы файлов, так что проверка на 'image/' больше не нужна.
    // Это позволит загружать, например, STL-модели
    const url = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/upload`;
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", cloudinaryConfig.uploadPreset);

        const response = await fetch(url, { method: "POST", body: formData });
        const data = await response.json();

        if (data.secure_url) {
            console.log('Uploaded:', data.bytes, 'bytes');
            
            // --- ОБНОВЛЕНИЕ СТАТИСТИКИ (ЛОКАЛЬНО + БД) ---
            // Важно: мы не обновляем UI сразу, так как это просто загрузка файла.
            // Статистику сохраним "на будущее", но окончательная запись в БД будет при сохранении Изделия.
            // Но чтобы предотвратить параллельные загрузки, обновляем локальный счетчик сразу.
            
            // Возвращаем объект, а не просто URL, чтобы передать размер
            return { 
                url: data.secure_url, 
                size: data.bytes, 
                public_id: data.public_id 
            }; 
        } else {
            throw new Error(data.error?.message || 'Unknown error');
        }
    } catch (error) {
        showToast("Ошибка загрузки: " + error.message, "error");
        return null;
    }
}



// --- ФУНКЦИИ РАБОТЫ С CLOUDINARY ---

// Заглушка: Мы не удаляем файлы из облака автоматически ради безопасности.
// Чтобы удалять файлы, нужны секретные ключи, которые опасно хранить в открытом коде.
// "Мусорные" файлы можно чистить иначе через сайт Cloudinary.
async function deleteFileFromCloud(url) {
    console.log("Soft delete: Ссылка удалена из базы, файл остался в облаке (безопасный режим).", url);
    return Promise.resolve();
}

// Функции генерации подписи больше не нужны, их можно удалить или оставить пустыми
async function generateSignature(paramsString, secret) { return ""; }

function getCloudinaryInfo(url) { return null; }


/**
 * Сохраняет db в Firebase (users/{uid}/data). Использует dbRef.update.
 * Вызывается после изменений в filaments, products, writeoffs, справочниках.
 */
async function saveData() {
    if (!dbRef) return;
    const dataToSave = JSON.parse(JSON.stringify(db));
    // Очищаем блобы перед отправкой в БД, так как они не сериализуются
    if(dataToSave.products) {
        dataToSave.products.forEach(p => { delete p.imageBlob; delete p.attachedFiles; });
    }
    try {
        await dbRef.set(dataToSave);
        const header = document.querySelector('.header-info');
        if(header) {
            const original = header.textContent;
            header.textContent = "☁️ Сохранено!";
            setTimeout(() => header.textContent = original, 2000);
        }
    } catch (err) { showToast('Ошибка синхронизации!', 'error'); }
}

// Алиас для совместимости с кодом из v3.7
function saveToLocalStorage() { saveData(); }



// ==================== HELPERS ====================

function checkSubscription(subData) {
    if (!subData) return;

    const now = new Date();
    const expiry = new Date(subData.expiryDate);
    const diffTime = expiry - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

    // === Обновляем инфо в сайдбаре (Адаптировано под гамбургер) ===
    const sidebarStatus = document.getElementById('sidebarSubStatus');
    if (sidebarStatus) {
        const dateStr = expiry.toLocaleDateString('ru-RU');
        let color = '#4ade80'; // Зеленый
        let text = `Активно до: ${dateStr}`;
        let iconChar = '●';
        
        if (diffDays <= 5) { color = '#fb923c'; iconChar = '⚠️'; } // Оранжевый
        if (diffDays <= 0) { color = '#f87171'; text = 'Истекла'; iconChar = '⛔'; } // Красный
        
        // Важно: Сохраняем структуру классов menu-icon и menu-text
        sidebarStatus.innerHTML = `
            <span class="menu-icon" style="color:${color}; font-size:12px;">${iconChar}</span>
            <span class="menu-text" style="color:${color === '#4ade80' ? '#64748b' : color}">${text}</span>
        `;
        
        if(diffDays <= 0) sidebarStatus.style.cursor = 'pointer';
        sidebarStatus.onclick = (diffDays <= 0) ? () => document.getElementById('contactModal').classList.add('active') : null;
    }
    // ==================================

    const overlay = document.getElementById('subscriptionBlockOverlay');
    const warning = document.getElementById('subscriptionWarning');
    const warningText = document.getElementById('subWarningText');
    const uidDisplay = document.getElementById('blockUserUid');
    const modalUid = document.getElementById('contactModalUid');

    if(firebase.auth().currentUser) {
        const uid = firebase.auth().currentUser.uid;
        if(uidDisplay) uidDisplay.textContent = uid;
        if(modalUid) modalUid.textContent = uid;
    }

    // 1. БЛОКИРОВКА
    if (diffDays <= 0) {
        if(overlay) overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden'; 
        if(warning) warning.style.display = 'none';
        return; 
    } else {
        if(overlay) overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // 2. ПРЕДУПРЕЖДЕНИЕ (<= 5 дней)
    if (diffDays <= 5) {
        const typeText = subData.status === 'trial' ? 'Пробный период' : 'Подписка';
        if(warningText) warningText.textContent = `Внимание: ${typeText} истекает через ${diffDays} дн.`;
        if(warning) warning.style.display = 'flex';
    } else {
        if(warning) warning.style.display = 'none';
    }
}

/** Открывает почтовый клиент для связи с администратором (продление подписки). Безопасно проверяет currentUser. */
window.openContactEmail = function(subject, bodyPrefix) {
    const user = firebase.auth().currentUser;
    const uid = user ? user.uid : '';
    const subj = subject != null ? subject : 'Продление подписки 3D Manager';
    const prefix = bodyPrefix != null ? bodyPrefix : 'Мой ID: ';
    const url = 'mailto:Artemiy50@gmail.com?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(prefix + uid);
    window.open(url);
};

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function toggleClearButton(input) {
    const clearBtn = input.nextElementSibling;
    if (clearBtn) clearBtn.style.display = input.value ? 'inline' : 'none';
}

function clearSearch(inputId, filterFunctionName) {
    const input = document.getElementById(inputId);
    input.value = '';
    toggleClearButton(input);
    saveFiltersToStorage();
    if(typeof window[filterFunctionName] === 'function') window[filterFunctionName]();
}

/** Debounce: откладывает вызов fn до тех пор, пока не пройдёт ms мс без новых вызовов. */
function debounce(fn, ms) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/** Ключ localStorage для фильтров и сортировки. */
const FILTER_STORAGE_KEY = '3d_print_filters';

/** Сохраняет значения фильтров и сортировки в localStorage. */
function saveFiltersToStorage() {
    try {
        const data = {
            filamentSearch: document.getElementById('filamentSearch')?.value || '',
            filamentStatusFilter: document.getElementById('filamentStatusFilter')?.value || '',
            filamentSortBy: document.getElementById('filamentSortBy')?.value || 'date-desc',
            productSearch: document.getElementById('productSearch')?.value || '',
            productAvailabilityFilter: document.getElementById('productAvailabilityFilter')?.value || '',
            productSortBy: document.getElementById('productSortBy')?.value || 'systemId-desc',
            productShowChildren: document.getElementById('showProductChildren')?.checked ?? true,
            writeoffSearch: document.getElementById('writeoffSearch')?.value || '',
            writeoffTypeFilter: document.getElementById('writeoffTypeFilter')?.value || '',
            writeoffSortBy: document.getElementById('writeoffSortBy')?.value || 'systemId-desc'
        };
        localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* ignore */ }
}

/** Восстанавливает значения фильтров и сортировки из localStorage. */
function loadFiltersFromStorage() {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
        const setCheck = (id, val) => { const el = document.getElementById(id); if (el && typeof val === 'boolean') el.checked = val; };
        set('filamentSearch', data.filamentSearch);
        set('filamentStatusFilter', data.filamentStatusFilter);
        set('filamentSortBy', data.filamentSortBy);
        set('productSearch', data.productSearch);
        set('productAvailabilityFilter', data.productAvailabilityFilter);
        set('productSortBy', data.productSortBy);
        setCheck('showProductChildren', data.productShowChildren);
        set('writeoffSearch', data.writeoffSearch);
        set('writeoffTypeFilter', data.writeoffTypeFilter);
        set('writeoffSortBy', data.writeoffSortBy);
        ['filamentSearch', 'productSearch', 'writeoffSearch'].forEach(id => {
            const inp = document.getElementById(id);
            if (inp) toggleClearButton(inp);
        });
    } catch (e) { /* ignore */ }
}

function getCostPerKwForDate(productDateStr) {
    if (!db.electricityCosts || db.electricityCosts.length === 0) return 6;
    if (!productDateStr) productDateStr = '2020-01-01';
    const productDate = new Date(productDateStr);
    const applicableTariffs = db.electricityCosts
        .filter(tariff => new Date(tariff.date) <= productDate)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (applicableTariffs.length > 0) return applicableTariffs[0].cost;
    return db.electricityCosts.sort((a, b) => new Date(a.date) - new Date(b.date))[0].cost;
}

function recalculateAllProductCosts() {
    if (!db.products) return;
    // Pass 1: Простые изделия
    db.products.forEach(p => {
        if (p.type !== 'Составное') {
            const printer = p.printer;
            const filament = (p.filament && db.filaments) ? db.filaments.find(f => f && f.id === p.filament.id) : null;
            let energy = 0;
            if (printer && printer.power) {
                const costPerKw = getCostPerKwForDate(p.date);
                energy = (p.printTime / 60) * printer.power * costPerKw;
            }
            if (filament) {
                const acW = p.weight * (filament.actualCostPerGram || 0);
                const acL = p.length * (filament.actualCostPerMeter || 0);
                p.costActualPrice = Math.max(acW, acL) + energy;
                const mkW = p.weight * (filament.avgCostPerGram || 0);
                const mkL = p.length * (filament.avgCostPerMeter || 0);
                p.costMarketPrice = Math.max(mkW, mkL) + energy;
            } else { p.costActualPrice = energy; p.costMarketPrice = energy; }
            p.costPer1Actual = (p.quantity > 0) ? p.costActualPrice / p.quantity : 0;
            p.costPer1Market = (p.quantity > 0) ? p.costMarketPrice / p.quantity : 0;
        }
    });
    // Pass 2: Составные изделия
    db.products.forEach(p => {
        if (p.type === 'Составное') {
            const children = db.products.filter(child => child.parentId == p.id);
            p.costActualPrice = children.reduce((sum, child) => sum + (child.costActualPrice || 0), 0);
            p.costPer1Actual = (p.quantity > 0) ? p.costActualPrice / p.quantity : 0;
            p.costMarketPrice = children.reduce((sum, child) => sum + (child.costMarketPrice || 0), 0);
            p.costPer1Market = (p.quantity > 0) ? p.costMarketPrice / p.quantity : 0;
        }
    });
}


function updateAllDates() {
    const today = new Date().toISOString().split('T')[0];
    // [FIX] Добавлен 'serviceDate' для автоматического заполнения
    ['filamentDate','productDate','writeoffDate','serviceDate'].forEach(id => {
        const el = document.getElementById(id); 
        if(el) el.value = today;
    });
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('ru-RU');
    document.getElementById('copyrightYear').textContent = new Date().getFullYear();
}



function showPage(id) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.sidebar .menu-item').forEach(btn => {
        if(btn.dataset.page === id) btn.classList.add('active');
    });
}

function loadShowChildren() {
    const s = localStorage.getItem('showProductChildren');
    if(s!==null && document.getElementById('showProductChildren')) document.getElementById('showProductChildren').checked = (s==='true');
}

// Функция проверяет, используется ли данный URL в других изделиях
// url - ссылка, которую хотим удалить
// excludeId - ID изделия, из которого мы удаляем (его мы не должны учитывать в проверке)
function isResourceUsedByOthers(url, excludeId) {
    if (!url) return false;
    
    return db.products.some(p => {
        // Пропускаем само изделие, которое мы сейчас редактируем/удаляем
        if (p.id === excludeId) return false;

        // 1. Проверяем главное фото
        if (p.imageUrl === url) return true;

        // 2. Проверяем прикрепленные файлы (на случай, если когда-то разрешим копирование файлов)
        if (p.fileUrls && Array.isArray(p.fileUrls)) {
            if (p.fileUrls.some(f => f.url === url)) return true;
        }

        return false;
    });
}

// Сбор всех ссылок (URL) из базы данных (для очистки мусора)
function getAllCloudinaryUrls(databaseObj) {
    const urls = new Set();
    if (!databaseObj || !databaseObj.products) return urls;

    databaseObj.products.forEach(p => {
        // Главное фото
        if (p.imageUrl && p.imageUrl.includes('cloudinary')) {
            urls.add(p.imageUrl);
        }
        // Прикрепленные файлы
        if (p.fileUrls && Array.isArray(p.fileUrls)) {
            p.fileUrls.forEach(f => {
                if (f.url && f.url.includes('cloudinary')) {
                    urls.add(f.url);
                }
            });
        }
    });
    return urls;
}



// ==================== V4.0 МИГРАЦИЯ И ИМПОРТ ====================

// Вспомогательная: Base64 -> Blob (нужна для распаковки бэкапа v3.7)
function base64ToBlob(base64) {
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

/**
 * Валидирует структуру загружаемого JSON-бэкапа. Должны быть массивы products и filaments.
 * @param {object} loaded - распарсенный JSON
 * @returns {{ valid: boolean, error?: string }}
 */
function validateImportData(loaded) {
    if (!loaded || typeof loaded !== 'object') return { valid: false, error: 'Файл не является объектом JSON.' };
    const hasProducts = loaded.products && (Array.isArray(loaded.products) || typeof loaded.products === 'object');
    const hasFilaments = loaded.filaments && (Array.isArray(loaded.filaments) || typeof loaded.filaments === 'object');
    if (!hasProducts && !hasFilaments) return { valid: false, error: 'В файле нет разделов products или filaments. Проверьте формат.' };
    return { valid: true };
}

/**
 * Импорт данных из JSON-бэкапа. Валидирует структуру, при невалидном файле не выполняет импорт.
 * Мигрирует Base64-фото в Cloudinary, очищает устаревшие файлы из облака.
 */
function importData(input) {
    const file = input.files[0];
    if (!file) return;
    
    // УБРАНА проверка размера файла бэкапа. Теперь можно грузить файлы любого размера.

    const r = new FileReader();
    
    r.onload = async (e) => {
        try {
            let loaded;
            try {
                loaded = JSON.parse(e.target.result);
            } catch (parseErr) {
                showToast('Некорректный JSON. Файл повреждён или не является бэкапом.', 'error');
                return;
            }
            const validation = validateImportData(loaded);
            if (!validation.valid) {
                showToast(validation.error || 'Некорректный формат файла.', 'error');
                return;
            }
            if (loaded.filaments || loaded.products) {
                if (confirm('Внимание! Загрузка базы.\n\nТекущие данные будут заменены.\nФайлы, отсутствующие в бэкапе, будут удалены из облака.\n\nПродолжить?')) {
                    
                    const btn = document.getElementById('importBtn');
                    if(btn) { btn.textContent = "♻️ Очистка и загрузка..."; btn.disabled = true; }

                    // === ШАГ 1: ОЧИСТКА МУСОРА (Удаляем файлы, которых нет в бэкапе) ===
                    // ВАЖНО: Если вы переходите с локальной версии 3.7, этот шаг может удалить 
                    // файлы из облака, если они там были. Но для v3.7 это обычно не актуально.
                    const currentUrls = getAllCloudinaryUrls(db);
                    const newUrls = getAllCloudinaryUrls(loaded);
                    
                    console.log(`Анализ файлов: Текущих - ${currentUrls.size}, В бэкапе - ${newUrls.size}`);
                    
                    let deletedCount = 0;
                    for (const url of currentUrls) {
                        if (!newUrls.has(url)) {
                            deleteFileFromCloud(url);
                            deletedCount++;
                        }
                    }
                    if(deletedCount > 0) console.log(`Очищено ${deletedCount} устаревших файлов из облака.`);

                    // === ШАГ 2: МИГРАЦИЯ СТАРЫХ БЭКАПОВ (v3.7 -> v4.2) ===
                    if (loaded.products) {
                        let uploadedImageCount = 0;
                        let uploadedFileCount = 0;
                        
                        for (let p of loaded.products) {
                            // 1. Главное фото (Base64 -> Cloudinary)
                            if (p._backupBase64Image) {
                                try {
                                    const blob = base64ToBlob(p._backupBase64Image);
                                    // Здесь проверка размера происходит на стороне Cloudinary.
                                    // Если файл > 10МБ, он не загрузится, но база восстановится.
                                    const cloudUrl = await uploadFileToCloud(blob);
                                    if (cloudUrl) {
                                        p.imageUrl = cloudUrl;
                                        uploadedImageCount++;
                                    }
                                } catch (err) {
                                    console.error(`Ошибка миграции фото: ${p.name}`, err);
                                }
                                delete p._backupBase64Image;
                            } 
                            else if (p.imageBlob && Object.keys(p.imageBlob).length === 0) {
                                p.imageBlob = null;
                            }

                            // 2. Файлы (Base64 -> Cloudinary)
                            if (p._backupAttachedFiles && Array.isArray(p._backupAttachedFiles)) {
                                p.fileUrls = p.fileUrls || [];
                                for (let f of p._backupAttachedFiles) {
                                    if (f._contentBase64) {
                                        try {
                                            const blob = base64ToBlob(f._contentBase64);
                                            const cloudUrl = await uploadFileToCloud(blob);
                                            if (cloudUrl) {
                                                p.fileUrls.push({ name: f.name, url: cloudUrl });
                                                uploadedFileCount++;
                                            } else {
                                                p.fileUrls.push({ name: f.name + " (ошибка загр.)", url: null });
                                            }
                                        } catch (err) {
                                            console.warn(`Не удалось мигрировать файл ${f.name}`);
                                        }
                                    }
                                }
                                delete p._backupAttachedFiles;
                            }
                        }
                        if(uploadedImageCount > 0 || uploadedFileCount > 0) {
                            console.log(`Миграция завершена: загружено ${uploadedImageCount} фото и ${uploadedFileCount} файлов.`);
                        }
                    }

                    // --- Обычное восстановление данных ---
                    if (loaded.writeoffs) {
                        loaded.writeoffs.forEach(w => {
                            if (!w.systemId) w.systemId = String(w.id);
                        });
                    }

                    Object.assign(db, loaded);
                    await saveData();
                    
                    showToast('База восстановлена! Устаревшие файлы очищены, новые загружены.', 'success');
                    window.location.reload();
                }
            }
        } catch(err) { 
            console.error(err);
            showToast('Ошибка обработки файла: ' + err, 'error'); 
        } finally {
            const btn = document.getElementById('importBtn');
            if(btn) { btn.textContent = "📂 Восстановить"; btn.disabled = false; }
        }
    };
    r.readAsText(file);
    input.value = ''; 
}




/**
 * Экспорт всей базы (db) в JSON-файл для бэкапа. Скачивает файл в браузере.
 */
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `3d_filament_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dl); dl.click(); dl.remove();
}



function updateAllSelects() {
    document.querySelectorAll('#filamentBrand').forEach(s => s.innerHTML = db.brands.map((b, i) => `<option value="${i}">${escapeHtml(b)}</option>`).join(''));
    document.querySelectorAll('#filamentColor').forEach(s => { const editId = document.getElementById('filamentModal')?.getAttribute('data-edit-id'); let opts = !editId ? [`<option value="">-- Выберите цвет --</option>`] : []; opts.push(...db.colors.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)); s.innerHTML = opts.join(''); });
    document.querySelectorAll('#filamentType').forEach(s => s.innerHTML = db.plasticTypes.map(p => `<option value="${p}">${escapeHtml(p)}</option>`).join(''));
    document.querySelectorAll('#filamentAvailability').forEach(s => s.innerHTML = db.filamentStatuses.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join(''));
    const fs = document.getElementById('filamentStatusFilter'); if(fs) { const v=fs.value; fs.innerHTML = '<option value="">— Все статусы —</option>' + db.filamentStatuses.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join(''); fs.value=v; }
    document.querySelectorAll('#productPrinter').forEach(s => s.innerHTML = db.printers.map(p => `<option value="${p.id}">${escapeHtml(p.model)}</option>`).join(''));
    
    updateProductFilamentSelect(); 
    updateBrandsList(); 
    updateColorsList(); 
    updateFilamentTypeList(); 
    //updateFilamentStatusList(); 
    updatePrintersList(); 
    updateElectricityCostList();
	updateComponentsList();
    updateServiceNamesList();
}

// ==================== DASHBOARD ====================

function updateDashboard() {
    const nameEvents = (id) => id ? `onmouseenter="showProductImagePreview(this, ${id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"` : '';

    const filamentsInStock = db.filaments.filter(f => f.availability === 'В наличии');
    document.getElementById('dashFilamentCount').textContent = filamentsInStock.length;
    
    const lowStock = filamentsInStock.filter(f => {
        const rem = Math.max(0, (f.length || 0) - (f.usedLength || 0));
        return rem < 50;
    });

    const warning = document.getElementById('dashFilamentWarnings');
    if (lowStock.length > 0) {
        warning.innerHTML = lowStock.map(f => {
            const rem = Math.max(0, (f.length || 0) - (f.usedLength || 0));
            return `<div class="warning-item"><span>⚠️</span><span>Филамента <b>${escapeHtml(f.customId)}</b> осталось всего <b>${rem.toFixed(1)}</b> метров.</span></div>`;
        }).join('');
        warning.classList.remove('hidden');
    } else { 
        warning.innerHTML = ''; 
        warning.classList.add('hidden'); 
    }

    const filamentsSorted = [...filamentsInStock].sort((a, b) => new Date(a.date) - new Date(b.date));
    document.querySelector('#dashFilamentTable tbody').innerHTML = filamentsSorted.map(f => {
        const rem = Math.max(0, (f.length || 0) - (f.usedLength || 0));
        const rowClass = (rem < 50) ? 'row-bg-danger' : '';
        return `<tr class="${rowClass}"><td><span class="color-swatch" style="background:${f.color ? f.color.hex : '#eee'}"></span>${f.color ? escapeHtml(f.color.name) : '-'}</td><td>${f.date}</td><td>${escapeHtml(f.brand)}</td><td>${escapeHtml(f.type)}</td><td>${rem.toFixed(1)}</td><td>${(f.actualPrice||0).toFixed(2)} ₽</td></tr>`;
    }).join('');


    const rootProducts = db.products.filter(p => p.type !== 'Часть составного' && !p.isDraft);
    const stockProducts = rootProducts.filter(p => p.status === 'В наличии полностью' || p.status === 'В наличии частично');
    document.getElementById('dashProductCountRecord').textContent = stockProducts.length;
    const totalInStock = stockProducts.reduce((sum, p) => sum + (p.inStock || 0), 0);
    document.getElementById('dashProductCountStock').textContent = totalInStock;

    const lastProds = [...rootProducts].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    document.querySelector('#dashProductTable tbody').innerHTML = lastProds.map(p => {
        let badgeClass = 'badge-secondary', statusStyle = 'font-weight: 400;';
        if (p.status === 'В наличии полностью') { badgeClass = 'badge-light-green'; statusStyle = 'font-weight: 700;'; }
        else if (p.status === 'В наличии частично') { badgeClass = 'badge-success'; statusStyle = 'font-weight: 700;'; }
        else if (p.status === 'Брак') badgeClass = 'badge-danger';
        else if (p.status === 'Нет в наличии') badgeClass = 'badge-gray';

        let colorHtml = '—';
        if (p.type === 'Составное') {
            const children = db.products.filter(k => k.parentId === p.id);
            const uniqueColors = new Map();
            children.forEach(child => {
                const f = (child.filament && child.filament.color) ? child.filament : db.filaments.find(fil => fil.id == child.filament);
                if (f && f.color) uniqueColors.set(f.color.id, f.color);
            });
            if (uniqueColors.size > 0) {
                colorHtml = Array.from(uniqueColors.values())
                    .map(c => `<span class="color-swatch" style="background:${c.hex}" title="${escapeHtml(c.name)}"></span>`)
                    .join('');
            }
        } else if (p.filament) {
            const f = (p.filament.color) ? p.filament : db.filaments.find(fil => fil.id == p.filament);
            if(f && f.color) {
                colorHtml = `<span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}`;
            }
        }

        return `<tr>
            <td ${nameEvents(p.id)}><strong>${escapeHtml(p.name)}</strong></td>
            <td>${p.date}</td>
            <td>${colorHtml}</td>
            <td>${p.inStock}</td>
            <td><span class="badge ${badgeClass}" style="${statusStyle}">${escapeHtml(p.status)}</span></td>
        </tr>`;
    }).join('');

    const sales = db.writeoffs.filter(w => w.type === 'Продажа');
    document.getElementById('dashSoldCount').textContent = sales.reduce((sum, w) => sum + w.qty, 0);
    const lastSales = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    document.querySelector('#dashSalesTable tbody').innerHTML = lastSales.map(w => `<tr><td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td><td>${w.date}</td><td>${w.qty}</td><td>${(w.price||0).toFixed(2)}</td><td>${(w.total||0).toFixed(2)}</td><td><span class="badge badge-success">Продажа</span></td></tr>`).join('');

    const used = db.writeoffs.filter(w => w.type === 'Использовано');
    document.getElementById('dashUsedCount').textContent = used.reduce((sum, w) => sum + w.qty, 0);
    const lastUsed = [...used].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    document.querySelector('#dashUsedTable tbody').innerHTML = lastUsed.map(w => `<tr><td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td><td>${w.date}</td><td>${w.qty}</td><td>${escapeHtml(w.note || '')}</td><td><span class="badge badge-purple">Использовано</span></td></tr>`).join('');

    const indepProds = db.products.filter(p => p.type !== 'Часть составного');
    const defProds = indepProds.filter(p => p.defective).map(p=>({productId: p.id, name: p.name, date: p.date, qty: p.quantity, note: p.note, ts: new Date(p.date).getTime()}));
    const defWrites = db.writeoffs.filter(w => w.type === 'Брак').map(w=>({productId: w.productId, name: w.productName, date: w.date, qty: w.qty, note: w.note, ts: new Date(w.date).getTime()}));
    const allDef = [...defProds, ...defWrites].sort((a, b) => b.ts - a.ts).slice(0, 5);
    document.getElementById('dashDefectiveCount').textContent = allDef.reduce((s, i) => s + i.qty, 0);
    document.querySelector('#dashDefectiveTable tbody').innerHTML = allDef.map(i => `<tr><td ${nameEvents(i.productId)}>${escapeHtml(i.name)}</td><td>${i.date}</td><td>${i.qty}</td><td>${escapeHtml(i.note || '')}</td><td><span class="badge badge-danger">Брак</span></td></tr>`).join('');
}


// ==================== FILAMENTS ====================

function updateFilamentCalcFields() {
    const w = parseFloat(document.getElementById('filamentWeight').value) || 1000;
    const l = parseFloat(document.getElementById('filamentLength').value) || 330;
    const act = parseFloat(document.getElementById('filamentActualPrice').value) || 0;
    const avg = parseFloat(document.getElementById('filamentAvgPrice').value) || 0;
    document.getElementById('actualCostPerGramCalc').textContent = `${(act/w).toFixed(2)} ₽/г`;
    document.getElementById('actualCostPerMeterCalc').textContent = `${(act/l).toFixed(2)} ₽/м`;
    document.getElementById('avgCostPerGramCalc').textContent = `${(avg/w).toFixed(2)} ₽/г`;
    document.getElementById('avgCostPerMeterCalc').textContent = `${(avg/l).toFixed(2)} ₽/м`;
    
    const fid = document.getElementById('filamentModal').getAttribute('data-edit-id');
    const f = fid ? db.filaments.find(x => x.id == parseInt(fid)) : null;
    if (f) {
        document.getElementById('weightUsedCalc').textContent = `${(f.usedWeight||0).toFixed(1)} г`;
        document.getElementById('weightRemainingCalc').textContent = `${(f.weight-(f.usedWeight||0)).toFixed(1)} г`;
        document.getElementById('lengthUsedCalc').textContent = `${(f.usedLength||0).toFixed(1)} м`;
        document.getElementById('lengthRemainingCalc').textContent = `${(f.length-(f.usedLength||0)).toFixed(1)} м`;
    } else {
        document.getElementById('weightUsedCalc').textContent = '0 г';
        document.getElementById('weightRemainingCalc').textContent = `${w} г`;
        document.getElementById('lengthUsedCalc').textContent = '0 м';
        document.getElementById('lengthRemainingCalc').textContent = `${l} м`;
    }
}

function updatePriceTooltip() {
    const avg = parseFloat(document.getElementById('filamentAvgPrice').value) || 0;
    const act = parseFloat(document.getElementById('filamentActualPrice').value) || 0;
    document.getElementById('priceTooltip').textContent = `Коэффициент: ${avg > 0 ? (act / avg).toFixed(3) : '-'}`;
    updateFilamentCalcFields();
}
function updateWeightTooltip() {
    const w = parseFloat(document.getElementById('filamentWeight').value) || 1000;
    const l = parseFloat(document.getElementById('filamentLength').value) || 330;
    document.getElementById('weightTooltip').textContent = `Граммов в метре: ${(w / l).toFixed(2)}`;
    updateFilamentCalcFields();
}
function updateFilamentColorPreview() {
    const cid = parseInt(document.getElementById('filamentColor').value);
    const c = db.colors.find(i => i.id === cid);
    if (c) document.getElementById('filamentColorPreview').style.background = c.hex;
}

// --- FILAMENT ---
function openFilamentModal() { isModalOpen = true; document.getElementById('filamentModal').classList.add('active'); clearFilamentForm(); setTimeout(() => document.getElementById('filamentCustomId').focus(), 100); }


function closeFilamentModal() { 
    isModalOpen = false;
    // Используем dbRef.parent, чтобы получить корневой объект (с stats и data)
    if(dbRef && dbRef.parent) dbRef.parent.once('value').then(window.updateAppFromSnapshot);

    document.getElementById('filamentModal').classList.remove('active'); 
    document.getElementById('filamentModal').removeAttribute('data-edit-id'); 
    document.querySelector('#filamentModal .modal-header-title').textContent = 'Добавить филамент'; 
    clearFilamentForm(); 
}


function clearFilamentForm() {
    document.getElementById('filamentCustomId').value = ''; document.getElementById('filamentName').value = ''; document.getElementById('filamentLink').value = ''; document.getElementById('filamentType').value = 'PLA';
    document.getElementById('filamentAvgPrice').value = ''; document.getElementById('filamentActualPrice').value = ''; document.getElementById('filamentNote').value = '';
    document.getElementById('filamentBrand').value = '0'; document.getElementById('filamentColorPreview').style.background = '#ffffff'; document.getElementById('filamentAvailability').value = 'В наличии';
    document.getElementById('filamentWeight').value = '1000'; document.getElementById('filamentLength').value = '330'; document.getElementById('filamentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('filamentValidationMessage').classList.add('hidden'); document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
    document.querySelectorAll('#filamentModal input, #filamentModal select').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('#filamentModal input, #filamentModal select, #filamentModal textarea').forEach(el => el.disabled = false);
    
    // --- ДОБАВИТЬ СЮДА ---
    document.getElementById('priceTooltip').textContent = "Коэффициент: -";
    document.getElementById('weightTooltip').textContent = "Граммов в метре: -";
    // ---------------------

    updateFilamentCalcFields(); 
    updateFilamentStatusUI();
}

function validateFilamentForm() {
    let valid = true;
    const requiredIds = ['filamentCustomId','filamentDate','filamentName','filamentActualPrice','filamentAvgPrice','filamentWeight','filamentLength','filamentColor'];
    
    requiredIds.forEach(id => {
        const el = document.getElementById(id);
        const val = parseFloat(el.value);
        
        // Проверка: Пустое, или (если число) меньше или равно нулю
        let isInvalid = !el.value.trim();
        if (el.type === 'number') {
            isInvalid = isInvalid || isNaN(val) || val <= 0;
        }

        if (isInvalid) { 
            el.classList.add('error'); 
            valid = false; 
        } else {
            el.classList.remove('error');
        }
    });

    const cid = document.getElementById('filamentCustomId').value.trim(); 
    const eid = document.getElementById('filamentModal').getAttribute('data-edit-id');
    
    if (valid && cid && db.filaments.some(f => f.customId === cid && (!eid || f.id != eid))) { 
        document.getElementById('filamentCustomId').classList.add('error'); 
        document.getElementById('filamentUniqueIdMessage').classList.remove('hidden'); 
        valid = false; 
    } else {
        document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
    }

    const msg = document.getElementById('filamentValidationMessage');
    if (!valid) {
        if (document.getElementById('filamentUniqueIdMessage').classList.contains('hidden')) {
            // Уточняем текст ошибки
            msg.textContent = 'Заполните все поля корректными значениями (числа > 0)';
            msg.classList.remove('hidden');
        }
    } else {
        msg.classList.add('hidden');
    }
    
    return valid;
}


async function saveFilament() {
    if (!validateFilamentForm()) return;
    
    const saveBtn = document.getElementById('saveFilamentBtn');
    saveBtn.textContent = '⏳ Сохраняю...'; 
    saveBtn.disabled = true;

    const eid = document.getElementById('filamentModal').getAttribute('data-edit-id');
    
    const data = {
        customId: document.getElementById('filamentCustomId').value, 
        brand: db.brands[document.getElementById('filamentBrand').value], 
        type: document.getElementById('filamentType').value,
        color: db.colors.find(c => c.id == document.getElementById('filamentColor').value), 
        name: document.getElementById('filamentName').value, 
        link: document.getElementById('filamentLink').value.trim(),
        date: document.getElementById('filamentDate').value, 
        avgPrice: parseFloat(document.getElementById('filamentAvgPrice').value) || 0, 
        actualPrice: parseFloat(document.getElementById('filamentActualPrice').value) || 0,
        weight: parseFloat(document.getElementById('filamentWeight').value) || 1000, 
        length: parseFloat(document.getElementById('filamentLength').value) || 330, 
        note: document.getElementById('filamentNote').value, 
        availability: document.getElementById('filamentAvailability').value
    };
    
    // Безопасные расчеты
    data.priceRatio = data.avgPrice > 0 ? data.actualPrice / data.avgPrice : 1; 
    data.weightPerMeter = data.length > 0 ? data.weight / data.length : 0; 
    data.avgCostPerGram = data.weight > 0 ? data.avgPrice / data.weight : 0;
    data.avgCostPerMeter = data.length > 0 ? data.avgPrice / data.length : 0; 
    data.actualCostPerGram = data.weight > 0 ? data.actualPrice / data.weight : 0; 
    data.actualCostPerMeter = data.length > 0 ? data.actualPrice / data.length : 0;
    
    try {
        // [ВАЖНОЕ ИСПРАВЛЕНИЕ]
        // Инициализируем начальные значения ДО транзакции.
        // Это гарантирует, что даже если список пуст, объект data будет полным.
        if (!eid) {
            data.id = Date.now();
            data.remainingLength = data.length; 
            data.usedLength = 0; 
            data.usedWeight = 0;
        }

        // 1. Транзакция
        await dbRef.child('filaments').transaction((currentList) => {
            // Если список пуст, возвращаем массив с нашим ПОЛНЫМ объектом data
            if (currentList === null) return [data]; 
            
            if (eid) {
                // Редактирование
                const index = currentList.findIndex(x => x && x.id == parseInt(eid));
                if (index > -1) {
                    data.id = currentList[index].id;
                    // Аккуратно сохраняем существующую статистику расхода
                    data.remainingLength = currentList[index].remainingLength !== undefined ? currentList[index].remainingLength : data.length; 
                    data.usedLength = currentList[index].usedLength || 0; 
                    data.usedWeight = currentList[index].usedWeight || 0;
                    currentList[index] = data;
                }
            } else {
                // Добавление в существующий список
                currentList.push(data);
            }
            return currentList;
        });

        // 2. Локальное обновление UI (для мгновенной реакции)
        if (eid) {
            const localF = db.filaments.find(x => x.id == parseInt(eid));
            if (localF) {
                // Восстанавливаем статистику из локальной копии, чтобы не сбить отображение
                const savedStats = {
                    remainingLength: localF.remainingLength,
                    usedLength: localF.usedLength,
                    usedWeight: localF.usedWeight
                };
                Object.assign(localF, data, savedStats);
            }
        } else {
            db.filaments.push(data);
        }

        updateAllSelects(); 
        updateFilamentsTable(); 
        updateDashboard(); 
        closeFilamentModal();

    } catch (e) {
        console.error("Ошибка сохранения филамента:", e);
        showToast("Ошибка при сохранении: " + e.message, "error");
    } finally {
        saveBtn.textContent = 'Сохранить и закрыть'; 
        saveBtn.disabled = false;
    }
}




function filterFilaments() {
    const term = document.getElementById('filamentSearch').value.toLowerCase(); const status = document.getElementById('filamentStatusFilter').value;
    document.querySelectorAll('#filamentsTable tbody tr').forEach(row => { 
        const text = row.textContent.toLowerCase(); 
        const matchTerm = text.includes(term); 
        const matchStatus = !status || row.children[2].textContent.includes(status); 
        row.style.display = matchTerm && matchStatus ? '' : 'none'; 
    });
}
function resetFilamentFilters() {
    document.getElementById('filamentSearch').value = '';
    document.getElementById('filamentStatusFilter').value = '';
    saveFiltersToStorage();
    updateFilamentsTable();
}

function editFilament(id) {
    const f = db.filaments.find(x => x.id === id); if (!f) return;
    openFilamentModal();
    document.getElementById('filamentCustomId').value = f.customId; 
    document.getElementById('filamentBrand').value = db.brands.indexOf(f.brand);
    document.getElementById('filamentType').value = f.type;
    document.getElementById('filamentColor').value = f.color.id;
    updateFilamentColorPreview();
    document.getElementById('filamentDate').value = f.date;
    document.getElementById('filamentName').value = f.name;
    document.getElementById('filamentLink').value = f.link;
    document.getElementById('filamentAvgPrice').value = f.avgPrice;
    document.getElementById('filamentActualPrice').value = f.actualPrice;
    document.getElementById('filamentWeight').value = f.weight;
    document.getElementById('filamentLength').value = f.length;
    document.getElementById('filamentNote').value = f.note;
    document.getElementById('filamentAvailability').value = f.availability;
    
    document.getElementById('filamentModal').setAttribute('data-edit-id', id); 

    updatePriceTooltip();  
    updateWeightTooltip(); 

    updateFilamentCalcFields(); 
    updateFilamentStatusUI();
}

function copyFilament(id) { 
    editFilament(id); 
    document.getElementById('filamentModal').removeAttribute('data-edit-id'); 
    document.getElementById('filamentCustomId').value += ' (Копия)';
    document.getElementById('filamentAvailability').value = 'В наличии';
    
    document.getElementById('filamentNote').value = ''; // <--- ДОБАВЛЕНО: Очистка комментария
    
    document.querySelector('#filamentModal .modal-header-title').textContent = 'Копирование';
}


async function deleteFilament(id) {
    const f = db.filaments.find(x => x.id === id);
    if (!f) return;

    // Проверка, используется ли филамент в каких-либо изделиях
    if (db.products.some(p => p.filament && p.filament.id === id)) {
        showToast(`Удаление невозможно. Филамент "${f.customId}" использован в изделиях.`, "error");
        return;
    }

    if (!confirm(`Удалить филамент "${f.customId}"?`)) return;

    const index = db.filaments.findIndex(fil => fil.id === id);
    if(index > -1) {
        await dbRef.child('filaments').child(index).remove();
    }
}

function updateFilamentStatusUI() {
    const el = document.getElementById('filamentAvailability');
    el.className = el.value === 'В наличии' ? 'select-status-stock' : 'select-status-used';
}



// ==================== PRODUCTS ====================

function renderProductImage() {
    const preview = document.getElementById('productImagePreview');
    const placeholder = document.getElementById('imagePlaceholder');
    const btnDelete = document.getElementById('btnDeleteImage');
    
    let src = null;

    if (currentProductImage) {
        if (currentProductImage instanceof Blob) {
            // Если это только что выбранный файл
            src = URL.createObjectURL(currentProductImage);
        } else if (typeof currentProductImage === 'string') {
            // Если это URL из базы данных
            src = currentProductImage;
        }
    }

    if (src) {
        preview.src = src; 
        preview.style.display = 'block'; 
        placeholder.style.display = 'none'; 
        btnDelete.style.display = 'flex';
        
        // Очистка памяти только если это Blob
        if (currentProductImage instanceof Blob) {
            preview.onload = () => URL.revokeObjectURL(src);
        }
    } else {
        preview.src = ''; 
        preview.style.display = 'none'; 
        placeholder.style.display = 'block'; 
        btnDelete.style.display = 'none';
    }
}



// Обработка загрузки ГЛАВНОГО ФОТО
function handleImageUpload(input) { 
    const file = input.files[0]; 
    if(file) { 
        // Проверка размера (10 МБ)
        if (file.size > 10 * 1024 * 1024) {
            showToast("Файл изображения слишком большой! Максимум: 10 МБ.", "error");
            input.value = '';
            return;
        }
        currentProductImage = file; 
        renderProductImage(); 
    } 
}

function removeProductImage() { currentProductImage = null; renderProductImage(); }

// Обработка загрузки ПРИКРЕПЛЕННЫХ ФАЙЛОВ
function handleFileUpload(input) { 
    const file = input.files[0]; 
    if(file) { 
        // ВЫДАЕМ СООБЩЕНИЕ (как вы просили)
        showToast("Сохранение в Cloudinary временно недоступно. Файл будет сохранён только как запись (без скачивания).", "warning");
        
        // Добавляем в список, чтобы пользователь видел, что он "прикрепил" файл
        currentProductFiles.push({name:file.name, blob:file}); 
        renderProductFiles(); 
    } 
}


function removeFile(index) { currentProductFiles.splice(index, 1); renderProductFiles(); }
function renderProductFiles() {
    const container = document.getElementById('fileListContainer'); container.innerHTML = '';
    currentProductFiles.forEach((f, i) => {
        const isCloud = !!f.url;
        container.innerHTML += `<div class="file-chip"><span onclick="downloadFile(${i})" title="${escapeHtml(f.name)}" style="${isCloud ? 'color:#1e40af; text-decoration:underline;' : ''}">${escapeHtml(f.name)} ${isCloud ? '☁️' : ''}</span><button class="btn-delete-file" onclick="removeFile(${i})">✕</button></div>`;
    });
    document.getElementById('fileCountLabel').textContent = `${currentProductFiles.length}/5`;
}
function downloadFile(index) {
    const f = currentProductFiles[index];
    if(f.url) window.open(f.url, '_blank');
    else if(f.blob) { const url = URL.createObjectURL(f.blob); const a=document.createElement('a'); a.href=url; a.download=f.name; a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 100); }
}


// ДОБАВИТЬ эти 2 функции
function captureProductSnapshot() {
    const type = document.getElementById('productType').value;
    const snapshot = {
        isDraft: document.getElementById('productIsDraft').checked, 
		name: document.getElementById('productName').value,
        date: document.getElementById('productDate').value,
        link: document.getElementById('productLink').value,
        quantity: document.getElementById('productQuantity').value,
        weight: document.getElementById('productWeight').value,
        length: document.getElementById('productLength').value,
        printTimeH: document.getElementById('productPrintTimeHours').value,
        printTimeM: document.getElementById('productPrintTimeMinutes').value,
        printer: document.getElementById('productPrinter').value,
        type: type,
        note: document.getElementById('productNote').value,
        defective: document.getElementById('productDefective').checked,
        filament: document.getElementById('productFilament').value,
        parentId: type === 'Часть составного' ? document.getElementById('productParent').value : '',
        allPartsCreated: type === 'Составное' ? document.getElementById('productAllPartsCreated').checked : false,
    };
    return JSON.stringify(snapshot);
}

function initiateWriteOff() {
    const currentSnapshot = captureProductSnapshot();
    if (currentSnapshot !== productSnapshotForDirtyCheck) {
        if (!confirm('Вы вносили изменения. Сохранить их перед переходом к списанию?')) {
            return; 
        }
    }
    saveProduct(true); 
}



function updateProductCosts() {
    const type = document.getElementById('productType').value;
    const w = parseFloat(document.getElementById('productWeight').value) || 0;
    const l = parseFloat(document.getElementById('productLength').value) || 0;
    const qty = parseInt(document.getElementById('productQuantity').value) || 1;
    const printer = db.printers.find(p => p.id == document.getElementById('productPrinter').value);
    const time = (parseInt(document.getElementById('productPrintTimeHours').value) || 0) * 60 + (parseInt(document.getElementById('productPrintTimeMinutes').value) || 0);
    updateProductStockDisplay();

    let energy = 0, costMarket = 0, costActual = 0;
    let mkL = 0, mkW = 0, acL = 0, acW = 0;

    const productDate = document.getElementById('productDate').value;
    const currentCostPerKw = getCostPerKwForDate(productDate);
    document.getElementById('energyCostTooltip').textContent = `Стоимость 1 кВт: ${currentCostPerKw.toFixed(2)} ₽`;

    const f = db.filaments.find(x => x.id == document.getElementById('productFilament').value);
    if (f) {
        const avgGram = typeof f.avgCostPerGram === 'number' ? f.avgCostPerGram.toFixed(2) : '?.??';
        const actGram = typeof f.actualCostPerGram === 'number' ? f.actualCostPerGram.toFixed(2) : '?.??';
        const avgMeter = typeof f.avgCostPerMeter === 'number' ? f.avgCostPerMeter.toFixed(2) : '?.??';
        const actMeter = typeof f.actualCostPerMeter === 'number' ? f.actualCostPerMeter.toFixed(2) : '?.??';
        
        document.getElementById('costPerGramTooltip').textContent = `Себест. за грамм рынок/реальная: ${avgGram} / ${actGram} ₽`;
        document.getElementById('costPerMeterTooltip').textContent = `Себест. за метр рынок/реальная: ${avgMeter} / ${actMeter} ₽`;
    } else {
        document.getElementById('costPerGramTooltip').textContent = 'Себест. за грамм рынок/реальная: - / -';
        document.getElementById('costPerMeterTooltip').textContent = 'Себест. за метр рынок/реальная: - / -';
    }

    if (type === 'Составное') {
        const eid = document.getElementById('productModal').getAttribute('data-edit-id');
        const kids = eid ? db.products.filter(p => p.parentId == parseInt(eid)) : [];
        
        kids.forEach(child => {
            if (child.printer && child.printer.power) {
                const costPerKw = getCostPerKwForDate(child.date);
                energy += (child.printTime / 60) * child.printer.power * costPerKw;
            }
            mkW += child.marketCostByWeight || 0;
            mkL += child.marketCostByLength || 0;
            acW += child.costActualByWeight || 0;
            acL += child.costActualByLength || 0;
            costMarket += child.costMarketPrice || 0;
            costActual += child.costActualPrice || 0;
        });

    } else { 
        if (printer) {
            energy = (time / 60) * printer.power * currentCostPerKw;
        }
        
        if (f) {
            mkW = w * (f.avgCostPerGram || 0);
            mkL = l * (f.avgCostPerMeter || 0);
            acW = w * (f.actualCostPerGram || 0);
            acL = l * (f.actualCostPerMeter || 0);
            costMarket = Math.max(mkW, mkL) + energy;
            costActual = Math.max(acW, acL) + energy;
        } else {
            costMarket = energy;
            costActual = energy;
        }
    }

    document.getElementById('productEnergyCostCalc').textContent = energy.toFixed(2);
    document.getElementById('productFilamentCostByWeightCalc').textContent = mkW.toFixed(2);
    document.getElementById('productFilamentCostByLengthCalc').textContent = mkL.toFixed(2);
    document.getElementById('filamentCostByWeightTooltip').textContent = `Расчет с реальной стоимостью: ${acW.toFixed(2)} ₽`;
    document.getElementById('filamentCostByLengthTooltip').textContent = `Расчет с реальной стоимостью: ${acL.toFixed(2)} ₽`;
    
    document.getElementById('productCostMarketCalc').textContent = costMarket.toFixed(2);
    document.getElementById('productCostActualTooltip').textContent = `Расчет с реальной стоимостью: ${costActual.toFixed(2)} ₽`;
    document.getElementById('productCostMarketPerUnitCalc').textContent = (costMarket / qty).toFixed(2);
    document.getElementById('productCostPerUnitActualTooltip').textContent = `Расчет с реальной стоимостью: ${(costActual / qty).toFixed(2)} ₽`;

    const tooltipEl = document.getElementById('costsDetailTooltip');
    let tooltipContent = '';
    const hr = '<hr style="margin: 4px 0; border-color: rgba(255,255,255,0.2); border-style: dashed;">';

    if (type === 'Составное') {
        const eid = document.getElementById('productModal').getAttribute('data-edit-id');
		const kids = eid ? db.products.filter(p => p.parentId == parseInt(eid)) : [];
        const totalWeight = kids.reduce((sum, k) => sum + (k.weight || 0), 0);
        const totalLength = kids.reduce((sum, k) => sum + (k.length || 0), 0);

        tooltipContent = [
			'<b>Расчет для составного изделия (суммирование частей):</b>',
			hr,
			`<b>Программный вес (г):</b> ${totalWeight.toFixed(1)} г`,
			`<b>Программная длина (м):</b> ${totalLength.toFixed(2)} м`,
			hr,
			`<b>Стоимость энергии:</b> ${energy.toFixed(2)} ₽`,
			`<b>Стоим. фил. (рынок/вес):</b> ${mkW.toFixed(2)} ₽`,
			`<b>Стоим. фил. (реальн/вес):</b> ${acW.toFixed(2)} ₽`,
			`<b>Стоим. фил. (рынок/длина):</b> ${mkL.toFixed(2)} ₽`,
			`<b>Стоим. фил. (реальн/длина):</b> ${acL.toFixed(2)} ₽`,
			hr,
			`<b>Себест. изделия (рынок):</b> ${costMarket.toFixed(2)} ₽`,
			`<b>Себест. изделия (реальн):</b> ${costActual.toFixed(2)} ₽`,
			hr,
			`<b>Себест. за 1 шт. (рынок):</b> ${costMarket.toFixed(2)} ₽ / ${qty} = <b>${(costMarket/qty).toFixed(2)} ₽</b>`,
			`<b>Себест. за 1 шт. (реальн):</b> ${costActual.toFixed(2)} ₽ / ${qty} = <b>${(costActual/qty).toFixed(2)} ₽</b>`
		].join('<br>');

    } else {
        const timeH = time / 60;
        const printerP = printer ? printer.power : 0;
        
        tooltipContent = [
			'<b>Стоимость энергии:</b> ' + `(${timeH.toFixed(2)} ч * ${printerP.toFixed(2)} кВт) * ${currentCostPerKw.toFixed(2)} ₽/кВтч = <b>${energy.toFixed(2)} ₽</b>`,
			hr,
			'<b>Стоим. фил. (рынок/вес):</b> ' + `${w.toFixed(1)} г * ${(f ? f.avgCostPerGram : 0).toFixed(2)} ₽/г = <b>${mkW.toFixed(2)} ₽</b>`,
			'<b>Стоим. фил. (реальн/вес):</b> ' + `${w.toFixed(1)} г * ${(f ? f.actualCostPerGram : 0).toFixed(2)} ₽/г = <b>${acW.toFixed(2)} ₽</b>`,
			'<b>Стоим. фил. (рынок/длина):</b> ' + `${l.toFixed(2)} м * ${(f ? f.avgCostPerMeter : 0).toFixed(2)} ₽/м = <b>${mkL.toFixed(2)} ₽</b>`,
			'<b>Стоим. фил. (реальн/длина):</b> ' + `${l.toFixed(2)} м * ${(f ? f.actualCostPerMeter : 0).toFixed(2)} ₽/м = <b>${acL.toFixed(2)} ₽</b>`,
			hr,
			'<b>Себест. изделия (рынок):</b> ' + `MAX(${mkW.toFixed(2)}, ${mkL.toFixed(2)}) + ${energy.toFixed(2)} = <b>${costMarket.toFixed(2)} ₽</b>`,
			'<b>Себест. изделия (реальн):</b> ' + `MAX(${acW.toFixed(2)}, ${acL.toFixed(2)}) + ${energy.toFixed(2)} = <b>${costActual.toFixed(2)} ₽</b>`,
			hr,
			'<b>Себест. за 1 шт. (рынок):</b> ' + `${costMarket.toFixed(2)} ₽ / ${qty} = <b>${(costMarket/qty).toFixed(2)} ₽</b>`,
			'<b>Себест. за 1 шт. (реальн):</b> ' + `${costActual.toFixed(2)} ₽ / ${qty} = <b>${(costActual/qty).toFixed(2)} ₽</b>`
		].join('<br>');
    }

    if (tooltipEl) {
        tooltipEl.innerHTML = tooltipContent;
    }
}



// ==================== PRODUCT LOGIC (FIXED & RESTORED FROM v3.7) ====================

function updateParentSelect(ensureParentId = null) {
    const modal = document.getElementById('productModal');
    const eid = modal.getAttribute('data-edit-id');
    const cp = eid ? db.products.find(p => p.id == parseInt(eid)) : null;
    
    let currentParentId = cp?.parentId || ensureParentId;
    let currentParent = currentParentId ? db.products.find(p => p.id == currentParentId) : null;
    
    // Фильтр как в 3.7: Только составные, не завершенные, не брак
    const avail = db.products.filter(p => 
        p.type === 'Составное' && 
        p.allPartsCreated !== true && 
        p.defective !== true
    );
    
    let opts = [];
    if (!eid && !ensureParentId) {
        opts.push('<option value="">-- Выберите родителя --</option>');
    }

    // Если текущий родитель скрыт фильтром (например, стал браком), добавляем его принудительно
    if (currentParent && !avail.some(p => p.id === currentParent.id)) {
        opts.push(`<option value="${currentParent.id}">${escapeHtml(currentParent.name)} (текущий)</option>`);
    }

    opts.push(...avail.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`));
    
    const select = document.getElementById('productParent');
    if (select) {
        select.innerHTML = opts.join('');
        if (currentParentId) select.value = currentParentId;
    }
}

function openProductModal() {
    isModalOpen = true; 
	const modal = document.getElementById('productModal');
    modal.classList.add('active');
    
    // Если это добавление нового (нет атрибута редактирования)
    if(!modal.hasAttribute('data-edit-id')) {
        // Сбрасываем заголовок, который мог остаться от копирования
        document.querySelector('#productModal .modal-header-title').textContent = 'Добавить изделие';
        
        clearProductForm();
        
        const now = new Date(); 
        document.getElementById('productSystemId').textContent = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        
        updateProductTypeUI();
        updateProductFilamentSelect();
    }
}

function closeProductModal() { 
    isModalOpen = false;
    if(dbRef && dbRef.parent) dbRef.parent.once('value').then(window.updateAppFromSnapshot);

	const modal = document.getElementById('productModal');
    modal.classList.remove('active'); 
    modal.removeAttribute('data-edit-id'); 
    modal.removeAttribute('data-system-id');
    clearProductForm(); 
}


function clearProductForm() {
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if(el) el.checked = v; };
    const setText = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };

    setVal('productName', ''); 
    setVal('productLink', ''); 
    setVal('productQuantity', '1'); 
    setVal('productWeight', ''); 
    setVal('productLength', ''); 
    setVal('productPrintTimeHours', ''); 
    setVal('productPrintTimeMinutes', ''); 
    setVal('productNote', ''); 
    setCheck('productDefective', false);
	setCheck('productIsDraft', false); 
    
    if(document.getElementById('productAllPartsCreated')) 
        document.getElementById('productAllPartsCreated').checked = false;
	
	const defCb = document.getElementById('productDefective');
    const draftCb = document.getElementById('productIsDraft');
    
    if(defCb) { defCb.disabled = false; defCb.removeAttribute('data-locked-by-system'); }
    if(draftCb) { draftCb.disabled = false; draftCb.removeAttribute('data-locked-by-system'); }

    // Очистка таблицы
    const childrenTbody = document.querySelector('#childrenTable tbody');
    if (childrenTbody) childrenTbody.innerHTML = '';

    setVal('productFilament', ''); 
    const swatch = document.getElementById('productColorSwatch'); if(swatch) swatch.style.background = '#ffffff'; 
    setText('productColorName', '—'); 
    
    const printers = db.printers || [];
    setVal('productPrinter', printers.length > 0 ? printers[0].id : ''); 
    setVal('productDate', new Date().toISOString().split('T')[0]);
    
    setVal('productParent', ''); 
    setText('productStockCalc', '1 шт.'); 
    setVal('productType', 'Самостоятельное'); 
    
    const statusField = document.getElementById('productAvailabilityField');
    if (statusField) {
        statusField.textContent = 'В наличии полностью';
        statusField.className = 'calc-field status-field-stocked';
    }
    
    const msg = document.getElementById('productValidationMessage');
    if(msg) {
        msg.classList.add('hidden'); 
        msg.textContent = 'Не все обязательные поля заполнены';
    }

    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));
    
    // === ВОССТАНОВЛЕНО: Принудительная разблокировка ВСЕХ полей ===
    // Без этого форма открывалась заблокированной после просмотра архивных записей
    const allInputs = document.querySelectorAll('#productModal input, #productModal select, #productModal textarea, #productModal button.btn-primary'); 
    allInputs.forEach(el => { 
        el.disabled = false; 
        el.style.opacity = ''; 
        el.style.cursor = ''; 
        if(el.tagName === 'BUTTON') el.title = ""; 
    });
    
    removeProductImage();
    currentProductFiles = [];
    renderProductFiles();

    updateProductTypeUI();
    updateProductColorDisplay();
    updateProductCosts();
}

function updateProductTypeUI() {
    const type = document.getElementById('productType').value;
    const groups = { 
        parent: document.getElementById('productParentGroup'), 
        allParts: document.getElementById('productAllPartsCreatedContainer'), 
        material: document.getElementById('materialSection'), 
        children: document.getElementById('childrenTableGroup'), 
        linkContainer: document.getElementById('productLinkFieldContainer'), 
        fileSection: document.getElementById('fileUploadSection') 
    };
    const inputs = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
    
    // Управление видимостью чекбокса Черновик
    const draftLabel = document.getElementById('productDraftLabel');
    if (draftLabel) {
        draftLabel.style.display = (type === 'Часть составного') ? 'none' : 'block';
    }

    const isDraft = document.getElementById('productIsDraft').checked;
    
    // Кнопка списания
    const btnWriteOff = document.getElementById('btnWriteOffProduct');
    const isExistingProduct = !!document.getElementById('productModal').getAttribute('data-edit-id');
    if (btnWriteOff) {
        btnWriteOff.style.display = (isExistingProduct && type !== 'Часть составного' && !isDraft) ? 'flex' : 'none';
    }

    groups.parent.classList.add('hidden');
    if(groups.allParts) groups.allParts.style.display = 'none';
    groups.material.classList.remove('hidden');
    groups.children.classList.add('hidden');
    groups.linkContainer.style.display = 'block';
    if(groups.fileSection) groups.fileSection.classList.remove('hidden');

    if (type === 'Составное') {
        if(groups.allParts) groups.allParts.style.display = 'flex';
        groups.material.classList.add('hidden');
        groups.children.classList.remove('hidden');
        inputs.forEach(id => { 
            const el = document.getElementById(id);
            if(el) { el.disabled = true; if(id.includes('Filament') || id.includes('Printer')) el.value = ''; }
        });
        updateChildrenTable();
        updateCompositeProductValues();
    } else if (type === 'Часть составного') {
        groups.parent.classList.remove('hidden');
        groups.linkContainer.style.display = 'none';
        if(groups.fileSection) groups.fileSection.classList.add('hidden');
        inputs.forEach(id => { const el = document.getElementById(id); if(el) el.disabled = false; });
        updateParentSelect();
    } else {
        inputs.forEach(id => { const el = document.getElementById(id); if(el) el.disabled = false; });
    }
    
    updateProductCosts();
    updateProductAvailability();
}


function updateCompositeProductValues() {
    const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
    if (!eid) return;
    const children = db.products.filter(p => p.parentId == eid && p.type === 'Часть составного'); 
    const totalTime = children.reduce((s, p) => s + (p.printTime || 0), 0);
    document.getElementById('productPrintTimeHours').value = Math.floor(totalTime / 60);
    document.getElementById('productPrintTimeMinutes').value = totalTime % 60;
    document.getElementById('productWeight').value = children.reduce((s, p) => s + (p.weight || 0), 0).toFixed(1);
    document.getElementById('productLength').value = children.reduce((s, p) => s + (p.length || 0), 0).toFixed(2);
}

function onParentProductChange() {
    const pid = document.getElementById('productParent').value;
    const parent = db.products.find(p => p.id == pid);
    if(parent) document.getElementById('productQuantity').value = parent.quantity;
}

// === ФУНКЦИЯ КОПИРОВАНИЯ ИЗДЕЛИЯ ===
async function copyProduct(id) {
    const p = db.products.find(x => x.id === id); if (!p) return;

    // 1. Копирование СОСТАВНОГО изделия
    if (p.type === 'Составное') {
        if (!confirm('Это составное изделие. Будут скопированы все его части (без прикрепленных файлов). Продолжить?')) {
            return;
        }
        
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        
        // --- Подготовка Родителя ---
        const newParent = JSON.parse(JSON.stringify(p));
        newParent.id = now.getTime();
        newParent.systemId = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        newParent.name = p.name + ' (Копия)';
        newParent.date = dateStr;
        newParent.inStock = p.quantity;
        newParent.allPartsCreated = false;
        newParent.defective = false;
        newParent.status = determineProductStatus(newParent);
        newParent.note = '';
         newParent.fileUrls = (p.fileUrls || []).map(f => ({ name: f.name, url: null }));
        newParent.imageBlob = null; 
        newParent.attachedFiles = [];
        newParent.printer = newParent.printer || null; // Fix undefined

        // --- Подготовка Детей ---
        const children = db.products.filter(child => child.parentId === p.id);
        const newChildren = children.map((child, index) => {
            const newChild = JSON.parse(JSON.stringify(child));
            const childNow = new Date();
            newChild.id = childNow.getTime() + index + 1;
            newChild.systemId = `${childNow.getFullYear()}${String(childNow.getMonth()+1).padStart(2,'0')}${String(childNow.getDate()).padStart(2,'0')}${String(childNow.getHours()).padStart(2,'0')}${String(childNow.getMinutes()).padStart(2,'0')}${String(childNow.getSeconds()+index+1).padStart(2,'0')}`;
            newChild.parentId = newParent.id;
            newChild.date = dateStr;
            newChild.inStock = newChild.quantity;
            newChild.defective = false;
            newChild.status = determineProductStatus(newChild);
            newChild.note = '';
            newChild.fileUrls = (child.fileUrls || []).map(f => ({ name: f.name, url: null }));
            newChild.imageBlob = null;
            newChild.attachedFiles = [];
            newChild.printer = newChild.printer || null; // Fix undefined
            newChild.filament = newChild.filament || null; // Fix undefined
            return newChild;
        });
        
        try {
            // [FIX] Транзакция и обновление ИЗ РЕЗУЛЬТАТА
            const result = await dbRef.child('products').transaction(currentProducts => {
                if (!currentProducts) currentProducts = [];
                currentProducts.push(newParent);
                newChildren.forEach(child => currentProducts.push(child));
                return currentProducts;
            });

            if (result.committed && result.snapshot.val()) {
                // Обновляем локальную базу полной копией с сервера
                // Это предотвращает рассинхронизацию и дублирование
                db.products = result.snapshot.val();
            }

            // Учёт расхода филамента по частям копии (как в saveProduct / recalculate)
            const deltaByFilId = {};
            for (const child of newChildren) {
                if (child.isDraft || !child.filament) continue;
                const filId = (typeof child.filament === 'object') ? child.filament.id : child.filament;
                if (!deltaByFilId[filId]) deltaByFilId[filId] = { L: 0, W: 0 };
                deltaByFilId[filId].L += (child.length || 0);
                deltaByFilId[filId].W += (child.weight || 0);
            }
            const filamentUpdates = {};
            db.filaments.forEach((f, index) => {
                const d = deltaByFilId[f.id];
                if (!d) return;
                f.usedLength = (f.usedLength || 0) + d.L;
                f.usedWeight = (f.usedWeight || 0) + d.W;
                f.remainingLength = Math.max(0, (f.length || 0) - (f.usedLength || 0));
                filamentUpdates[`filaments/${index}/usedLength`] = f.usedLength;
                filamentUpdates[`filaments/${index}/usedWeight`] = f.usedWeight;
                filamentUpdates[`filaments/${index}/remainingLength`] = f.remainingLength;
            });
            if (Object.keys(filamentUpdates).length > 0) {
                await dbRef.update(filamentUpdates);
            }

            updateProductsTable();
            updateFilamentsTable();
            updateDashboard();
            showToast(`Составное изделие "${newParent.name}" скопировано.`, 'success');
        } catch (e) {
            console.error("Ошибка копирования:", e);
            showToast("Ошибка при сохранении копии: " + e.message, "error");
        }

    } else {
        // 2. Копирование ПРОСТОГО изделия
        const modal = document.getElementById('productModal');
        modal.removeAttribute('data-edit-id');
        modal.removeAttribute('data-system-id');
        openProductModal();
        
        document.querySelector('#productModal .modal-header-title').textContent = 'Копирование изделия';

        document.getElementById('productName').value = p.name + ' (Копия)';
        document.getElementById('productLink').value = p.link || '';
        document.getElementById('productDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('productWeight').value = p.weight;
        document.getElementById('productLength').value = p.length;
        document.getElementById('productPrintTimeHours').value = Math.floor(p.printTime/60);
        document.getElementById('productPrintTimeMinutes').value = p.printTime%60;
        if(p.printer) document.getElementById('productPrinter').value = p.printer.id;
        
        document.getElementById('productType').value = p.type;
        document.getElementById('productNote').value = '';
        document.getElementById('productDefective').checked = false;
        
        updateProductTypeUI();
        updateProductFilamentSelect(); 
        
        if (p.type === 'Часть составного') { 
            updateParentSelect(p.parentId);
            document.getElementById('productParent').value = p.parentId;
            
            const parent = db.products.find(x => x.id == p.parentId);
            if (parent) document.getElementById('productQuantity').value = parent.quantity;
            else document.getElementById('productQuantity').value = p.quantity;
        } else {
            document.getElementById('productQuantity').value = p.quantity;
        }

        if (p.type !== 'Составное' && p.filament) { 
            // Теперь, когда список заполнен, выбираем нужное значение
            const filSelect = document.getElementById('productFilament');
            filSelect.value = p.filament.id; 
            
            // Если вдруг филамент закончился и его нет в списке (он скрыт),
            // updateProductFilamentSelect должен был его добавить как "текущий".
            // Но так как мы копируем в НОВОЕ окно, "текущего" для окна нет.
            // Нужно проверить, выбралось ли значение.
            if (!filSelect.value) {
                 // Если не выбралось (значит филамент в архиве), добавляем опцию вручную
                 const opt = document.createElement('option');
                 opt.value = p.filament.id;
                 opt.textContent = `${p.filament.customId} (Архивный)`;
                 filSelect.appendChild(opt);
                 filSelect.value = p.filament.id;
            }

            updateProductColorDisplay(); 
        }
        
        currentProductImage = p.imageUrl || null;
        currentProductFiles = []; 
        currentProductFiles = (p.fileUrls || []).map(f => ({ name: f.name, url: null }));
  
        
        renderProductImage();
        renderProductFiles();
        
        updateProductCosts();
    }
}





// === ФУНКЦИЯ ДЛЯ КНОПКИ [+] ===
// Объявляем её явно в window, чтобы избежать любых проблем с областью видимости
window.addChildPart = function(parentId) {
    // console.log("Кнопка (+) нажата, ID:", parentId);
    // alert("Кнопка нажата! ID: " + parentId); // Раскомментируйте для теста, если консоль молчит

    const modal = document.getElementById('productModal');
    if (!modal) return console.error("Modal not found");

    // Сброс флагов (чтобы открылось как новое)
    modal.removeAttribute('data-edit-id');
    modal.removeAttribute('data-system-id');
    
    // Открытие и очистка
    // Важно: эта функция очищает форму, поэтому вызываем её первой
    openProductModal(); 

    // Заполнение полей
    const typeSelect = document.getElementById('productType');
    if(typeSelect) {
        typeSelect.value = 'Часть составного';
        // Обновляем UI, чтобы показать поле выбора родителя
        updateProductTypeUI(); 
    }

    // Принудительно обновляем список родителей, передавая ID текущего
    if (typeof updateParentSelect === 'function') {
        updateParentSelect(parentId);
    }
    
    // Выбираем родителя
    const parentSelect = document.getElementById('productParent');
    if(parentSelect) {
        parentSelect.value = parentId;
    }

    // Наследование количества от родителя
    const parent = db.products.find(p => p.id == parentId);
    if (parent) {
        const qtyInput = document.getElementById('productQuantity');
        if(qtyInput) qtyInput.value = parent.quantity;
    }
    
    // Пересчет стоимости
    if (typeof updateProductCosts === 'function') {
        updateProductCosts();
    }

    // Фокус на имя
    setTimeout(() => {
        const nameInput = document.getElementById('productName');
        if(nameInput) nameInput.focus();
    }, 50);
};



function editProduct(id) {
    const productId = parseInt(id);
    const p = db.products.find(x => x.id === productId);
    if (!p) { console.error('Продукт не найден:', id); return; }

    document.getElementById('productSystemId').textContent = p.systemId || '-';
    document.getElementById('productModal').setAttribute('data-edit-id', id);
    document.getElementById('productModal').setAttribute('data-system-id', p.systemId);

    openProductModal();

    const titleEl = document.querySelector('#productModal .modal-header-title');
    if (titleEl) titleEl.textContent = 'Редактировать изделие';
    
    const defCheckbox = document.getElementById('productDefective');
    if (defCheckbox) {
        defCheckbox.checked = p.defective;
        updateProductAvailability();
    }

    // 1. Первая (и теперь единственная) декларация
    const validationMessage = document.getElementById('productValidationMessage');
    if (validationMessage) validationMessage.classList.add('hidden');
    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));

    const fieldsToFill = [ 
		{ id: 'productName', value: p.name }, 
		{ id: 'productLink', value: p.link || '' }, 
		{ id: 'productDate', value: p.date }, 
		{ id: 'productQuantity', value: p.quantity }, 
		{ id: 'productWeight', value: p.weight || '' }, 
		{ id: 'productLength', value: p.length || '' }, 
		{ id: 'productPrintTimeHours', value: Math.floor((p.printTime || 0) / 60) }, 
		{ id: 'productPrintTimeMinutes', value: (p.printTime || 0) % 60 }, 
		{ id: 'productNote', value: p.note || '' }, 
		{ id: 'productType', value: p.type || 'Самостоятельное' } 
	];
    fieldsToFill.forEach(field => {
        const el = document.getElementById(field.id);
        if (el) el.value = field.value;
    });

	const defCb = document.getElementById('productDefective');
	const draftCb = document.getElementById('productIsDraft');
    
    // Сброс атрибутов блокировки
    defCb.removeAttribute('data-locked-by-system');
    draftCb.removeAttribute('data-locked-by-system');
    
    // Заполнение чекбоксов
    if (defCb) defCb.checked = p.defective;
    if (draftCb) draftCb.checked = p.isDraft || false;

	currentProductImage = p.imageUrl || null; 
    currentProductFiles = p.fileUrls ? [...p.fileUrls] : []; 
    renderProductImage();
    renderProductFiles();
    
	const isDraftCb = document.getElementById('productIsDraft');
    if (isDraftCb) isDraftCb.checked = p.isDraft || false;
	
    updateProductTypeUI();
    
    const statusField = document.getElementById('productAvailabilityField');
    if (statusField) {
        const statusText = p.status || 'В наличии полностью';
        statusField.textContent = statusText;
        let statusClass = 'status-field-stocked';
        if (statusText === 'В наличии частично') statusClass = 'status-field-partial';
        else if (statusText === 'Нет в наличии') statusClass = 'status-field-none';
        else if (statusText === 'Брак') statusClass = 'status-field-defective';
        else if (statusText === 'Часть изделия') statusClass = 'status-field-part';
        statusField.className = 'calc-field ' + statusClass;
    }

    const printerSelect = document.getElementById('productPrinter');
    if (printerSelect && p.printer) printerSelect.value = p.printer.id;

    if (p.type === 'Часть составного' && p.parentId) {
        updateParentSelect();
        document.getElementById('productParent').value = p.parentId;
    }

    if (p.type !== 'Составное' && p.filament) {
        updateProductFilamentSelect();
        document.getElementById('productFilament').value = p.filament.id;
		updateProductColorDisplay(); 
    }

    if (p.type === 'Составное') {
        const allPartsEl = document.getElementById('productAllPartsCreated');
        if(allPartsEl) allPartsEl.checked = p.allPartsCreated || false;
    }

    updateProductCosts();
	
    // Разблокировка всех полей по умолчанию
    const allInputs = document.querySelectorAll('#productModal input, #productModal select, #productModal textarea');
    allInputs.forEach(el => el.disabled = false);

    // Логика блокировок для составных полей (филамент и т.д.)
    if (p.type === 'Составное') {
        const compositeLockedFields = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
        compositeLockedFields.forEach(id => document.getElementById(id).disabled = true);
    }

    // === ПРОВЕРКА УСЛОВИЙ БЛОКИРОВКИ ===
    let hasWriteoffs = db.writeoffs && db.writeoffs.some(w => w.productId === productId);
    // Проверка списаний у родителя (для частей)
    if (!hasWriteoffs && p.type === 'Часть составного' && p.parentId) {
        if (db.writeoffs.some(w => w.productId === p.parentId)) hasWriteoffs = true;
    }

    let isChildOfDefectiveParent = false;
    let isChildOfCompletedParent = false; 
    let hasDefectiveChild = false; 

    if (p.type === 'Часть составного' && p.parentId) {
        const parent = db.products.find(x => x.id === p.parentId);
        if (parent) {
            if(parent.defective) isChildOfDefectiveParent = true;
            if(parent.allPartsCreated) isChildOfCompletedParent = true;
        }
    }
    
    if (p.type === 'Составное') {
        const children = db.products.filter(child => child.parentId === p.id);
        if (children.some(child => child.defective)) {
            hasDefectiveChild = true;
        }
    }

    // УДАЛЕНО ПОВТОРНОЕ ОБЪЯВЛЕНИЕ validationMessage
    let lockReason = '';
    const mediaFields = ['productImageInput', 'productFileInput'];
	
    // 1. Блокировка Черновика, если есть списания
    if (hasWriteoffs) {
        draftCb.disabled = true;
        draftCb.setAttribute('data-locked-by-system', 'true');
        
        allInputs.forEach(el => {
            if (!['productNote', 'productDefective', ...mediaFields].includes(el.id)) el.disabled = true;
        });
        lockReason = 'Редактирование ограничено: есть списания.';
    }

    // 2. Блокировка Черновика, если есть бракованные дети
    if (hasDefectiveChild) {
        draftCb.disabled = true; 
        draftCb.setAttribute('data-locked-by-system', 'true');
        if (!lockReason) lockReason = 'Статус "Черновик" недоступен: одна из частей изделия в браке.';
    }

    // Стандартные блокировки
    if (p.defective) {
        allInputs.forEach(el => {
            if (!['productNote', 'productDefective', ...mediaFields].includes(el.id)) el.disabled = true;
        });
        lockReason = lockReason || 'Редактирование ограничено: изделие в браке.';
    } else if (isChildOfDefectiveParent) {
        allInputs.forEach(el => { if (!['productNote', ...mediaFields].includes(el.id)) el.disabled = true; });
        lockReason = lockReason || 'Редактирование ограничено: родительское изделие в браке.';
    } else if (isChildOfCompletedParent) {
        allInputs.forEach(el => { if (!['productNote', 'productDefective', ...mediaFields].includes(el.id)) el.disabled = true; });
        lockReason = lockReason || 'Редактирование ограничено: родительское изделие завершено.';
    }

    if (lockReason) {
        if (validationMessage) {
            validationMessage.textContent = lockReason;
            validationMessage.classList.remove('hidden');
        }
    } else {
        if (validationMessage) validationMessage.classList.add('hidden');
    }
    
    updateProductAvailability();

    // --- Секция списаний ---
    const modalBody = document.querySelector('#productModal .modal-body');
    const oldSection = document.getElementById('productWriteoffsSection');
    if (oldSection) oldSection.remove();

    if (p.type !== 'Часть составного') {
        const writeoffSection = document.createElement('div');
        writeoffSection.id = 'productWriteoffsSection';
        writeoffSection.className = 'product-writeoffs-section';
        writeoffSection.innerHTML = `<div class="product-writeoffs-title">Документы списания</div>`;

        const productWriteoffs = db.writeoffs.filter(w => w.productId === productId);
        
        if (productWriteoffs.length === 0) {
            writeoffSection.innerHTML += `<div style="font-size:13px; color:#94a3b8;">Нет списаний по этому изделию.</div>`;
        } else {
            const active = productWriteoffs.filter(w => w.type !== 'Подготовлено к продаже').sort((a,b) => new Date(b.date) - new Date(a.date));
            const prepared = productWriteoffs.filter(w => w.type === 'Подготовлено к продаже').sort((a,b) => new Date(b.date) - new Date(a.date));
            
            const renderLink = (w) => {
                let details = `${w.date} | ${w.type} | ${w.qty} шт.`;
                if (w.type === 'Продажа') details += ` | ${w.total.toFixed(2)} ₽`;
                const safeId = escapeHtml(String(w.systemId || ''));
                return `<a class="writeoff-link-item" data-writeoff-id="${safeId}" onclick="closeProductModal(); var _el=this; setTimeout(function(){editWriteoff(_el.getAttribute('data-writeoff-id'));}, 200);">${escapeHtml(details)}</a>`;
            };

            if (active.length > 0) {
                active.forEach(w => writeoffSection.innerHTML += renderLink(w));
            }

            if (prepared.length > 0) {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'writeoff-prepared-group';
                groupDiv.innerHTML = `<div class="writeoff-prepared-label">Подготовлено к продаже:</div>`;
                prepared.forEach(w => groupDiv.innerHTML += renderLink(w));
                writeoffSection.appendChild(groupDiv);
            }
        }
        modalBody.appendChild(writeoffSection);
    }
    
    productSnapshotForDirtyCheck = captureProductSnapshot();
}

function validateProductForm() {
    let valid = true;
    const t = document.getElementById('productType').value;
    const msgEl = document.getElementById('productValidationMessage');
    
    // Сброс ошибок
    msgEl.classList.add('hidden');
    msgEl.textContent = 'Не все обязательные поля заполнены'; // Возвращаем стандартный текст
    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));

    // 1. Проверка обязательных полей
    const req = ['productDate', 'productQuantity', 'productName'];
    if (t !== 'Составное') {
        req.push('productFilament', 'productPrinter', 'productWeight', 'productLength');
    }
    if (t === 'Часть составного') {
        req.push('productParent');
    }

    req.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value || (el.type === 'number' && parseFloat(el.value) === 0)) {
            el.classList.add('error');
            valid = false;
        }
    });

    // 2. Проверка времени (не должно быть 0:00)
    if (t !== 'Составное') {
        const h = parseInt(document.getElementById('productPrintTimeHours').value) || 0;
        const m = parseInt(document.getElementById('productPrintTimeMinutes').value) || 0;
        if (h === 0 && m === 0) {
            document.getElementById('productPrintTimeHours').classList.add('error');
            document.getElementById('productPrintTimeMinutes').classList.add('error');
            valid = false;
        }
    }

    // 3. НОВАЯ ПРОВЕРКА: Наличие филамента (только если остальные поля заполнены)
    if (valid && t !== 'Составное') {
        const filEl = document.getElementById('productFilament');
        const filId = filEl.value;
        const filament = db.filaments.find(f => f.id == filId);

        // Если филамент выбран, но его статус НЕ "В наличии"
        if (filament && filament.availability !== 'В наличии') {
            filEl.classList.add('error');
            msgEl.textContent = 'Выберите цвет имеющийся в наличии'; // Спец. сообщение
            msgEl.classList.remove('hidden');
            return false; // Блокируем сохранение
        }
    }

    if (!valid) {
        msgEl.classList.remove('hidden');
    }
    return valid;
}



/**
 * Сохранение изделия. Транзакция: 1) обновление филамента (usedLength/usedWeight), 2) transaction products.
 * При редактировании — возврат филамента от старого изделия; при добавлении — списание филамента.
 */
async function saveProduct(andThenWriteOff = false) {
    if (!validateProductForm()) return;

    const saveBtn = document.getElementById('saveProductBtn');
    saveBtn.textContent = '⏳ Сохраняю...'; saveBtn.disabled = true;

    const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
    
    let imgUrl = currentProductImage;
    let imgSize = 0; // Новая переменная

    if(currentProductImage instanceof Blob) {
        // Мы вызываем upload, который теперь возвращает объект
        const uploadResult = await uploadFileToCloud(currentProductImage);
        if (uploadResult) {
            imgUrl = uploadResult.url;
            imgSize = uploadResult.size;
            
            // Атомарно обновляем статистику
            const uid = firebase.auth().currentUser.uid;
            const statsRef = firebase.database().ref('users/' + uid + '/stats');
            
            // Транзакция для счетчика
            statsRef.transaction(stats => {
                if (!stats) stats = { storageUsed: 0, filesCount: 0 };
                stats.storageUsed += imgSize;
                stats.filesCount += 1;
                return stats;
            });
        } else {
            // Загрузка не удалась или лимит превышен
            saveBtn.disabled = false; saveBtn.textContent = 'Сохранить';
            return; // Прерываем сохранение
        }
    }
    
    let fileUrls = [];
    for(let f of currentProductFiles) {
        if(f.url) fileUrls.push(f);
        else if(f.blob) { 
            const u = null; 
            if(u) fileUrls.push({name: f.name, url: u}); 
            else fileUrls.push({name: f.name + " (ошибка загр.)", url: null});
        }
        else fileUrls.push(f);
    }

    const type = document.getElementById('productType').value;
    const qty = parseInt(document.getElementById('productQuantity').value) || 0;
    const isDefective = document.getElementById('productDefective').checked;
    const isDraft = document.getElementById('productIsDraft').checked; // Получаем значение
    
    // [FIX] Добавляем || null для безопасности транзакции
    const printerObj = db.printers.find(x => x.id == document.getElementById('productPrinter').value);
    
    const p = { 
        name: document.getElementById('productName').value, 
        systemId: eid ? document.getElementById('productModal').getAttribute('data-system-id') : document.getElementById('productSystemId').textContent, 
        date: document.getElementById('productDate').value, 
        link: document.getElementById('productLink').value, 
        quantity: qty, 
        weight: parseFloat(document.getElementById('productWeight').value) || 0, 
        length: parseFloat(document.getElementById('productLength').value) || 0, 
        printTime: (parseInt(document.getElementById('productPrintTimeHours').value)||0)*60 + (parseInt(document.getElementById('productPrintTimeMinutes').value)||0), 
        printer: printerObj || null, 
        type: type, 
        note: document.getElementById('productNote').value, 
        defective: isDefective,
		isDraft: isDraft, 
        imageUrl: imgUrl,    
		imageSize: imgSize,		
        fileUrls: fileUrls,
    };
    
    // Остаток для черновика всегда 0 (или равен кол-ву, но не участвует в списании). 
    // Для логики склада лучше оставить логику как есть, но статус "Черновик" перекроет отображение.
    const writeoffs = db.writeoffs || [];
    const existingWriteoffs = (eid) ? writeoffs.filter(w => w.productId == eid).reduce((sum,w)=>sum+w.qty,0) : 0;
    p.inStock = isDefective ? 0 : Math.max(0, qty - existingWriteoffs);
    p.status = determineProductStatus(p); 
    p.availability = p.status;

    if (type === 'Часть составного') p.parentId = parseInt(document.getElementById('productParent').value); 
    if (type === 'Составное') p.allPartsCreated = document.getElementById('productAllPartsCreated').checked;
    
    let filament = null; 
    if (type !== 'Составное') { 
        const filId = document.getElementById('productFilament').value;
        filament = db.filaments.find(x => x.id == filId); 
        p.filament = filament || null; // <--- ИСПРАВЛЕНИЕ ОШИБКИ
    } else {
        p.filament = null; // Для составного филамента нет
    }
    
    recalculateAllProductCosts();
    const tempProdForCost = { ...p, costActualPrice: 0, costMarketPrice: 0 };
    const { costActualPrice, costMarketPrice } = calculateSingleProductCost(tempProdForCost);
    p.costActualPrice = costActualPrice;
    p.costMarketPrice = costMarketPrice;
    p.costPer1Actual = qty > 0 ? p.costActualPrice / qty : 0;
    p.costPer1Market = qty > 0 ? p.costMarketPrice / qty : 0;

    if (!eid) {
        p.id = Date.now();
    } else {
        const oldProd = db.products.find(x => x.id == parseInt(eid));
        if (oldProd) p.id = oldProd.id;
    }

    try {
        const updates = {};
       
        // 1. Обновления филамента (стандартный update)
        if (eid) {
            const oldProd = db.products.find(x => x.id == parseInt(eid));
            if (oldProd && oldProd.filament && oldProd.type !== 'Составное') {
                // Если старое изделие НЕ было черновиком, значит оно потребило филамент. Надо вернуть.
                if (!oldProd.isDraft) {
                    const oldFil = db.filaments.find(f => f.id === oldProd.filament.id);
                    if (oldFil) {
                        const oldFilIndex = db.filaments.indexOf(oldFil);
                        const newUsedL = Math.max(0, oldFil.usedLength - (oldProd.length || 0));
                        const newUsedW = Math.max(0, oldFil.usedWeight - (oldProd.weight || 0));
                        // === ИСПРАВЛЕНИЕ: Обновляем remainingLength в базе ===
                        const newRem = Math.max(0, oldFil.length - newUsedL);
                        
                        updates[`filaments/${oldFilIndex}/usedLength`] = newUsedL;
                        updates[`filaments/${oldFilIndex}/usedWeight`] = newUsedW;
                        updates[`filaments/${oldFilIndex}/remainingLength`] = newRem;
                        
                        oldFil.usedLength = newUsedL;
                        oldFil.usedWeight = newUsedW;
                        oldFil.remainingLength = newRem;
                    }
                }
            }
        }

        if (filament && type !== 'Составное') {
            // Если новое состояние НЕ черновик - списываем филамент.
            if (!p.isDraft) {
                const currentFil = db.filaments.find(f => f.id === filament.id);
                if (currentFil) {
                    const filIndex = db.filaments.indexOf(currentFil);
                    const finalUsedL = (currentFil.usedLength || 0) + p.length;
                    const finalUsedW = (currentFil.usedWeight || 0) + p.weight;
                    // === ИСПРАВЛЕНИЕ: Обновляем remainingLength в базе ===
                    const finalRem = Math.max(0, currentFil.length - finalUsedL);

                    updates[`filaments/${filIndex}/usedLength`] = finalUsedL;
                    updates[`filaments/${filIndex}/usedWeight`] = finalUsedW;
                    updates[`filaments/${filIndex}/remainingLength`] = finalRem;
                    
                    currentFil.usedLength = finalUsedL;
                    currentFil.usedWeight = finalUsedW;
                    currentFil.remainingLength = finalRem;
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await dbRef.update(updates);
        }

        // 2. Транзакция для изделия
        const result = await dbRef.child('products').transaction((currentProducts) => {
            if (currentProducts === null) return [p];
            
            const index = currentProducts.findIndex(x => x && x.id === p.id);
            if (index > -1) {
                currentProducts[index] = p;
            } else {
                currentProducts.push(p);
            }
            return currentProducts;
        });

        // [FIX] ОБНОВЛЕНИЕ ЛОКАЛЬНЫХ ДАННЫХ ИЗ РЕЗУЛЬТАТА ТРАНЗАКЦИИ
        // Вместо ручного push, мы берем то, что реально сохранилось на сервере
        if (result.committed && result.snapshot.val()) {
            db.products = result.snapshot.val().filter(x => x);
        }

        updateAllSelects(); 
        updateProductsTable(); 
        updateDashboard(); 
        updateFilamentsTable(); 
        updateReports();
        
        productSnapshotForDirtyCheck = captureProductSnapshot();

        if (andThenWriteOff) {
            const productIdToPass = p.id;
            closeProductModal();
            setTimeout(() => openWriteoffModalForProduct(productIdToPass), 150); 
        } else {
            closeProductModal();
        }

    } catch (e) {
        console.error('Ошибка при сохранении изделия:', e);
        showToast('Не удалось сохранить изделие: ' + e.message, 'error');
    } finally {
        saveBtn.textContent = 'Сохранить и закрыть'; 
        saveBtn.disabled = false;
    }
}




function determineProductStatus(p) { 
    if (p.isDraft) return 'Черновик'; // Приоритетный статус
    if (p.defective) return 'Брак'; 
    if (p.type === 'Часть составного') return 'Часть изделия'; 
    if (p.inStock <= 0) return 'Нет в наличии'; 
    if (p.inStock < p.quantity) return 'В наличии частично'; 
    return 'В наличии полностью'; 
}


// Вспомогательная функция для расчета
function calculateSingleProductCost(p) {
    let costActualPrice = 0, costMarketPrice = 0;
    const filament = p.filament ? db.filaments.find(f => f.id === p.filament.id) : null;
    let energy = 0;
    if (p.printer && p.printer.power) {
        const costPerKw = getCostPerKwForDate(p.date);
        energy = (p.printTime / 60) * p.printer.power * costPerKw;
    }

    if (filament) {
        const acW = p.weight * (filament.actualCostPerGram || 0);
        const acL = p.length * (filament.actualCostPerMeter || 0);
        costActualPrice = Math.max(acW, acL) + energy;

        const mkW = p.weight * (filament.avgCostPerGram || 0);
        const mkL = p.length * (filament.avgCostPerMeter || 0);
        costMarketPrice = Math.max(mkW, mkL) + energy;
    } else {
        costActualPrice = energy;
        costMarketPrice = energy;
    }
    return { costActualPrice, costMarketPrice };
}

// --- ИСПРАВЛЕНА ЛОГИКА УДАЛЕНИЯ ---
async function deleteProduct(id) {
    const p = db.products.find(x => x.id === id);
    if (!p) return;
    
    // Проверка списаний
    if (db.writeoffs && db.writeoffs.some(w => w.productId === id)) { 
        showToast('Нельзя удалить изделие, по которому уже есть списания!', 'error'); 
        return; 
    }
    // Проверка списаний для родителя (если удаляем часть)
    if (!db.writeoffs.some(w => w.productId === id) && p.type === 'Часть составного' && p.parentId) {
        if (db.writeoffs.some(w => w.productId === p.parentId)) {
             showToast('Нельзя удалить часть, так как родительское изделие имеет списания!', 'error'); 
             return;
        }
    }

    if (!confirm(`Удалить изделие "${p.name}" и вернуть филамент?`)) return;

    // 1. Удаление файлов из облака
    if (p.imageUrl && !isResourceUsedByOthers(p.imageUrl, id)) {
        deleteFileFromCloud(p.imageUrl);
        const sizeToFree = p.imageSize || 0;
        if (sizeToFree > 0) {
             const uid = firebase.auth().currentUser.uid;
             firebase.database().ref('users/' + uid + '/stats').transaction(stats => {
                if (stats) {
                    stats.storageUsed = Math.max(0, stats.storageUsed - sizeToFree);
                    stats.filesCount = Math.max(0, stats.filesCount - 1);
                }
                return stats;
             });
        }
    }
    if (p.fileUrls) p.fileUrls.forEach(f => { 
        if(f.url && !isResourceUsedByOthers(f.url, id)) deleteFileFromCloud(f.url); 
    });

    // 2. Возврат филамента (Локальное обновление)
    // Функция helper для возврата
    const refundFilament = (prod) => {
        if (prod.filament && !prod.isDraft) {
            const filId = (typeof prod.filament === 'object') ? prod.filament.id : prod.filament;
            const dbFilament = db.filaments.find(f => f.id == filId);
            if (dbFilament) {
                dbFilament.usedLength = Math.max(0, dbFilament.usedLength - (prod.length || 0));
                dbFilament.usedWeight = Math.max(0, dbFilament.usedWeight - (prod.weight || 0));
                dbFilament.remainingLength = Math.max(0, dbFilament.length - dbFilament.usedLength);
            }
        }
    };

    if (p.type !== 'Составное') {
        refundFilament(p);
    } 
    
    // Если удаляем Составное, нужно вернуть филамент за все его части
    if (p.type === 'Составное') { 
        const kids = db.products.filter(k => k.parentId === id); 
        kids.forEach(k => refundFilament(k));
    }

    // 3. Удаление из массива (Локально)
    // Удаляем само изделие И его детей (если это составное)
    const newProducts = db.products.filter(prod => prod.id !== id && prod.parentId !== id);
    db.products = newProducts;

    try {
        // 4. Сохранение полных списков (Перезапись, чтобы не было дырок)
        const updates = {};
        updates['products'] = db.products;
        updates['filaments'] = db.filaments;
        
        await dbRef.update(updates);
        
        updateProductsTable(); 
        updateDashboard(); 
        updateReports(); 
        updateFilamentsTable();
        
        console.log('Изделие успешно удалено');
    } catch (e) {
        console.error("Ошибка удаления:", e);
        showToast("Не удалось удалить изделие: " + e.message, "error");
    }
}




function buildProductRow(p, isChild) {
    let weight = p.weight, length = p.length, printTime = p.printTime;
    if (p.type === 'Составное') {
        const kids = db.products.filter(k => k.parentId === p.id);
        weight = kids.reduce((s,k) => s + k.weight, 0);
        length = kids.reduce((s,k) => s + k.length, 0);
        printTime = kids.reduce((s, k) => s + (k.printTime || 0), 0); 
    }

    const hours = Math.floor(printTime / 60);
    const minutes = printTime % 60;
    const formattedTime = `${hours}:${String(minutes).padStart(2, '0')}`;

    const icon = p.type === 'Составное' 
        ? (p.allPartsCreated ? '📦' : '🥡') 
        : (p.type === 'Часть составного' ? '↳' : '✓');
    
    let fil = '—';
    if (p.filament && p.type !== 'Составное') {
        const fObj = (typeof p.filament === 'object') ? p.filament : db.filaments.find(f => f.id == p.filament);
        if(fObj && fObj.color) fil = `<span class="color-swatch" style="background:${fObj.color.hex}"></span>${escapeHtml(fObj.customId)}`;
    }
    const note = p.note ? `<span class="tooltip-container"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-right">${escapeHtml(p.note)}</span></span>` : '';
    
    let statusClass = 'badge-secondary';
    let rowBgClass = ''; 
    
	if (p.isDraft) { 
        statusClass = 'badge-gray'; 
        rowBgClass = 'row-bg-gray'; // Серый фон строки
    }
    if (p.status === 'В наличии полностью') { statusClass = 'badge-light-green'; rowBgClass = 'row-bg-light-green'; } 
    else if (p.status === 'В наличии частично') { statusClass = 'badge-success'; rowBgClass = 'row-bg-success'; } 
    else if (p.status === 'Брак') { statusClass = 'badge-danger'; rowBgClass = 'row-bg-danger'; } 
    else if (p.status === 'Нет в наличии') { statusClass = 'badge-gray'; rowBgClass = 'row-bg-gray'; }
    else if (p.status === 'Часть изделия') { statusClass = 'badge-purple'; }

    let statusHtml;
    if (isChild) {
        let statusTextStyle = 'status-text-purple';
        if (p.status === 'Брак') statusTextStyle = 'status-text-danger';
        statusHtml = `<span class="${statusTextStyle}">${escapeHtml(p.status)}</span>`;
    } else {
        const productWriteoffs = db.writeoffs.filter(w => w.productId === p.id);
        if (productWriteoffs.length > 0) {
            const linksHtml = productWriteoffs
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map(w => {
                    const plainType = `<strong>${escapeHtml(w.type)}</strong>`;
                    
                    // --- ВОССТАНОВЛЕННАЯ ЧАСТЬ КОДА ---
                    let linkText = w.type === 'Продажа' 
                        ? `${w.date} ${plainType}: ${w.qty} шт. х ${w.price.toFixed(2)} ₽ = ${w.total.toFixed(2)} ₽`
                        : `${w.date} ${plainType}: ${w.qty} шт.`;
                    // ----------------------------------

                    const style = w.type === 'Подготовлено к продаже' ? 'color: #94a3b8;' : '';
                    const safeId = escapeHtml(String(w.systemId || ''));
                    return `<a data-writeoff-id="${safeId}" onclick="editWriteoff(this.getAttribute('data-writeoff-id'))" style="${style}">${linkText}</a>`;
                }).join('');

            statusHtml = `<div class="tooltip-container">
                            <span class="badge ${statusClass}" style="cursor:pointer;">${escapeHtml(p.status)}</span>
                            <span class="tooltip-text tooltip-top-right" style="text-align: left; width: auto; white-space: nowrap;">${linksHtml}</span>
                         </div>`;
        } else {
            statusHtml = `<span class="badge ${statusClass}">${escapeHtml(p.status)}</span>`;
        }
    }
    
    const costM = p.costPer1Market ? p.costPer1Market.toFixed(2) : '0.00';
    const costA = p.costPer1Actual ? p.costPer1Actual.toFixed(2) : '0.00';
    
    const fileList = p.fileUrls || p.attachedFiles || [];
    let fileIconHtml = '';
    if (fileList.length > 0) {
        fileIconHtml = `<div class="tooltip-container"><span style="font-size: 16px; cursor: default;">📎</span><span class="tooltip-text tooltip-top-right">Прикреплено ${fileList.length} файлов</span></div>`;
    }
    
    const linkHtml = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Модель</a>` : '';

    const nameEvents = `onmouseenter="showProductImagePreview(this, ${p.id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"`;

    let nameHtml = isChild 
        ? `<div class="product-name-cell product-child-indent"><div class="product-icon-wrapper"><strong>${icon}</strong></div><span ${nameEvents} style="cursor:default">${escapeHtml(p.name)}</span>${note}</div>`
        : `<div class="product-name-cell"><div class="product-icon-wrapper"><strong>${icon}</strong></div><span ${nameEvents} style="cursor:default"><strong>${escapeHtml(p.name)}</strong></span>${note}</div>`;

    let addPartButtonHtml = '';
	if (p.type === 'Составное') {
        addPartButtonHtml = `<button class="btn-secondary btn-small btn-add-part" 
                                     title="Добавить часть изделия" 
                                     data-id="${p.id}">+</button>`;
    }

    return `<tr class="${isChild ? 'product-child-row' : rowBgClass}">
        <td style="padding-left:12px;">${nameHtml}</td>
        <td class="text-center">${fileIconHtml}</td>
        <td style="width: 110px;">${p.date}</td>
        <td>${fil}</td>
        <td>${formattedTime}</td>
        <td>${weight.toFixed(1)}</td>
        <td>${length.toFixed(2)}</td>
        <td>${p.quantity}</td>
        <td>${p.inStock !== undefined ? p.inStock : p.quantity}</td>
        <td>${costM} ₽</td>
        <td>${costA} ₽</td>
        <td>${statusHtml}</td>
        <td class="text-center">${linkHtml}</td>
        <td class="text-center">
            <div class="action-buttons">
                ${addPartButtonHtml} 
                <button class="btn-secondary btn-small" title="Редактировать" onclick="editProduct(${p.id})">✎</button>
                <button class="btn-secondary btn-small" title="Копировать" onclick="copyProduct(${p.id})">❐</button>
                <button class="btn-danger btn-small" title="Удалить" onclick="deleteProduct(${p.id})">✕</button>
            </div>
        </td>
    </tr>`;
}


function updateChildrenTable() { 
    const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
    if(!eid) return; 
    const kids = db.products.filter(p => p.parentId === parseInt(eid)); 
    
    document.querySelector('#childrenTable tbody').innerHTML = kids.map(k => {
        const colorHex = k.filament && k.filament.color ? k.filament.color.hex : '#eee';
        const colorName = k.filament && k.filament.color ? escapeHtml(k.filament.color.name) : 'Нет цвета';
        
        return `<tr>
            <td>${k.defective?'❌ ':''}${escapeHtml(k.name)}</td>
            <td><span class="color-swatch" style="background:${colorHex}" title="${colorName}"></span></td>
            <td>${k.quantity}</td>
            <td>${(k.weight || 0).toFixed(1)}</td>
            <td>${(k.length || 0).toFixed(2)}</td>
            <td>${(k.costMarketPrice || 0).toFixed(2)}</td>
            <td>${(k.costActualPrice || 0).toFixed(2)}</td>
        </tr>`;
    }).join(''); 
}


function updateProductsTable() {
    const tbody = document.querySelector('#productsTable tbody');
    const term = document.getElementById('productSearch').value.toLowerCase();
    const availFilter = document.getElementById('productAvailabilityFilter').value;
    const sortBy = document.getElementById('productSortBy').value;
    const showChildren = document.getElementById('showProductChildren').checked;

    const sortFn = (a, b) => {
        if (sortBy === 'systemId-desc') return (b.systemId||'').localeCompare(a.systemId||'');
        if (sortBy === 'systemId-asc') return (a.systemId||'').localeCompare(b.systemId||'');
        if (sortBy === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (sortBy === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'weight') return (b.weight||0) - (a.weight||0);
        if (sortBy === 'length') return (b.length||0) - (a.length||0);
        if (sortBy === 'quantity') return (b.quantity||0) - (a.quantity||0);
        return 0;
    };

    let rootProducts = db.products.filter(p => {
        if (p.type === 'Часть составного') return false; 
        if (term && !p.name.toLowerCase().includes(term)) return false;
        
        if (availFilter) {
            if (availFilter === 'Брак') { if (!p.defective) return false; }
            else if (availFilter === 'Draft') { if (!p.isDraft) return false; } // Фильтр черновиков
            else if (availFilter === 'InStock') { if ((p.inStock || 0) <= 0 || p.isDraft) return false; } // Черновики не "В наличии"
            else if (p.status !== availFilter) return false;
        }
        return true;
    });
    
    rootProducts.sort(sortFn);

    let html = '';
    rootProducts.forEach(root => {
        html += buildProductRow(root, false);
        if (root.type === 'Составное' && showChildren) {
            const children = db.products.filter(k => k.parentId === root.id);
            children.sort((a, b) => (a.systemId || '').localeCompare(b.systemId || ''));
            children.forEach(child => html += buildProductRow(child, true));
        }
    });
    tbody.innerHTML = html;
}

function filterProducts() { updateProductsTable(); }
function resetProductFilters() { 
    document.getElementById('productSearch').value = ''; 
    document.getElementById('productAvailabilityFilter').value = '';
    saveFiltersToStorage();
    updateProductsTable(); 
}

function showProductImagePreview(el, pid) {
    activePreviewProductId = pid;
    const p = db.products.find(x => x.id == pid);
    
    // Проверка: есть ли продукт, и есть ли у него URL или валидный Blob
    if(!p) return;
    
    let src = null;
    
    if (p.imageUrl && typeof p.imageUrl === 'string') {
        // Если это ссылка на облако (v4.0)
        src = p.imageUrl;
    } else if (p.imageBlob && p.imageBlob instanceof Blob) {
        // Если это локальный Blob (только что загруженный, но еще не сохраненный)
        src = URL.createObjectURL(p.imageBlob);
    }

    if (!src) return; // Если картинки нет, ничего не делаем

    const img = document.getElementById('globalImageTooltipImg');
    const tip = document.getElementById('globalImageTooltip');
    
    if(img.src !== src) {
        img.style.display = 'none';
        img.src = src;
        img.onload = () => { 
            if(activePreviewProductId === pid) { 
                img.style.display = 'block'; 
                tip.style.display = 'block'; 
                
                // Очистка памяти, если это был Blob
                if (p.imageBlob instanceof Blob) {
                    // Не ревокаем сразу, чтобы не пропала, но в идеале нужно следить за памятью
                }
            }
        };
    } else {
        if(activePreviewProductId === pid) { 
            img.style.display = 'block'; 
            tip.style.display = 'block'; 
        }
    }
}



function moveProductImagePreview(e) {
    const tip = document.getElementById('globalImageTooltip');
    if(tip.style.display === 'block') {
        tip.style.left = (e.clientX + 20) + 'px';
        tip.style.top = (e.clientY + 20) + 'px';
    }
}
function hideProductImagePreview() {
    activePreviewProductId = null;
    document.getElementById('globalImageTooltip').style.display = 'none';
}

function getWriteoffQuantityForProduct(productId, excludeWriteoffId = null) {
    if (!db.writeoffs) return 0;
    return db.writeoffs.filter(w => w.productId === productId && (!excludeWriteoffId || w.systemId !== excludeWriteoffId)).reduce((sum, w) => sum + w.qty, 0);
}

function updateProductStockDisplay() {
    const qty = parseInt(document.getElementById('productQuantity').value) || 0;
    const isDefective = document.getElementById('productDefective').checked;
    const eid = document.getElementById('productModal').getAttribute('data-edit-id');
    const pid = eid ? parseInt(eid) : null;
    let currentStock = isDefective ? 0 : Math.max(0, qty - getWriteoffQuantityForProduct(pid));
    document.getElementById('productStockCalc').textContent = currentStock + ' шт.';
}

function updateProductAvailability() {
    const defCb = document.getElementById('productDefective');
    const draftCb = document.getElementById('productIsDraft');
    const statusField = document.getElementById('productAvailabilityField');
    const type = document.getElementById('productType').value;
    
    // Блокировка чекбоксов друг другом (UI Mutual Exclusion)
    if (draftCb.checked) {
        defCb.checked = false;
        defCb.disabled = true; // Черновик не может быть браком
    } else {
        // Разблокируем только если нет внешних причин блокировки (см. ниже в editProduct)
        // Пока временно разблокируем, в editProduct перепроверим
        if (!defCb.hasAttribute('data-locked-by-system')) {
             defCb.disabled = false;
        }
    }

    if (defCb.checked) {
        draftCb.checked = false;
        draftCb.disabled = true; // Брак не может быть черновиком
    } else {
        // Аналогично, если нет системной блокировки
        if (!draftCb.hasAttribute('data-locked-by-system')) {
            draftCb.disabled = false;
        }
    }

    // Авто-активация признака сборки для составного при браке
    if (type === 'Составное' && defCb.checked) {
        const allPartsCb = document.getElementById('productAllPartsCreated');
        if(allPartsCb) allPartsCb.checked = true;
    }

    let statusText = 'В наличии полностью'; 
    let statusClass = 'status-field-stocked';

    if (draftCb.checked) {
        statusText = 'Черновик';
        statusClass = 'status-field-none';
    } else if (defCb.checked) {
        statusText = 'Брак';
        statusClass = 'status-field-defective'; 
    } else if (type === 'Часть составного') { 
        statusText = 'Часть изделия'; 
        statusClass = 'status-field-part'; 
    } else {
        const qty = parseInt(document.getElementById('productQuantity').value) || 0;
        statusText = 'В наличии полностью'; 
    }

    statusField.textContent = statusText; 
    statusField.className = 'calc-field ' + statusClass;
    
    const btnWriteOff = document.getElementById('btnWriteOffProduct');
    const isExisting = !!document.getElementById('productModal').getAttribute('data-edit-id');
    if (btnWriteOff) {
        btnWriteOff.style.display = (draftCb.checked) ? 'none' : (type !== 'Часть составного' && isExisting ? 'flex' : 'none');
    }

    updateProductStockDisplay();
}



// Сортировка выпадающего списка филаментов по алфавиту
function updateProductFilamentSelect() {
    const productModal = document.getElementById('productModal');
    const editId = productModal.getAttribute('data-edit-id');
    const currentProduct = editId ? db.products.find(p => p.id == parseInt(editId)) : null;
    const currentFilament = currentProduct?.filament;
    const filamentSelect = document.getElementById('productFilament');
    if (!filamentSelect) return;

    // Фильтруем доступные филаменты и сортируем их по имени (customId)
    const available = db.filaments
        .filter(f => f.availability === 'В наличии')
        .sort((a, b) => (a.customId || '').localeCompare(b.customId || ''));

    let options = [];
    // Для новых изделий добавляем пустой вариант
    if (!editId) options.push(`<option value="">-- Выберите филамент --</option>`);

    // Если у редактируемого изделия уже выбран филамент, который закончился,
    // его нужно добавить в список, чтобы он оставался видимым и выбранным.
    if (currentFilament && !available.find(f => f.id === currentFilament.id)) {
        const currentRemaining = Math.max(0, currentFilament.length - (currentFilament.usedLength||0));
        options.push(`<option value="${currentFilament.id}">${escapeHtml(currentFilament.customId)} (ост. ${currentRemaining.toFixed(1)} м.) - текущий</option>`);
    }

    // Добавляем отсортированный список доступных филаментов
    options.push(...available.map(f => {
        const remaining = Math.max(0, f.length - (f.usedLength||0));
        return `<option value="${f.id}">${escapeHtml(f.customId)} (ост. ${remaining.toFixed(1)} м.)</option>`;
    }));

    filamentSelect.innerHTML = options.join('');

    // Восстанавливаем выбор, если он был
    if (currentFilament) filamentSelect.value = currentFilament.id;
}

// Пункт 1: Значки катушек с хинтом
function updateFilamentsTable() {
    const tbody = document.querySelector('#filamentsTable tbody');
    const sortBy = document.getElementById('filamentSortBy').value;

    const sortedFilaments = [...db.filaments].sort((a, b) => {
        // Для сортировки тоже считаем реальный остаток
        const remA = Math.max(0, (a.length||0) - (a.usedLength||0));
        const remB = Math.max(0, (b.length||0) - (b.usedLength||0));
        
        switch (sortBy) {
            case 'date-desc': return new Date(b.date) - new Date(a.date);
            case 'date-asc': return new Date(a.date) - new Date(b.date);
            case 'availability': return (a.availability || '').localeCompare(b.availability || '');
            case 'brand': return (a.brand || '').localeCompare(b.brand || '');
            case 'color': return (a.color?.name || '').localeCompare(b.color?.name || '');
            case 'id': return (a.customId || '').localeCompare(b.customId || '');
            case 'length': return remB - remA; // Сортировка по реальному остатку
            case 'price': return (b.actualPrice || 0) - (a.actualPrice || 0);
            default: return 0;
        }
    });

    tbody.innerHTML = sortedFilaments.map(f => {
        const badge = f.availability === 'В наличии' ? 'badge-success' : 'badge-gray';
        const note = f.note ? `<span class="tooltip-container" style="display:inline-flex; vertical-align:middle;"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-left" style="width:200px; white-space:normal; line-height:1.2;">${escapeHtml(f.note)}</span></span>` : '';
        const link = f.link ? `<a href="${escapeHtml(f.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Товар</a>` : '';
        
        const iconHtml = `<span class="tooltip-container" style="margin-right:6px; cursor:default;"><span style="font-size:16px;">🧵</span><span class="tooltip-text tooltip-top-right">${escapeHtml(f.name)}</span></span>`;

        let rowClass = '';
        if (f.availability === 'Израсходовано') rowClass = 'row-bg-gray';
        
        // === ИСПРАВЛЕНИЕ: Считаем остаток на лету ===
        const realRemaining = Math.max(0, (f.length || 0) - (f.usedLength || 0));
        let remainingHtml = realRemaining.toFixed(1);
        
        if (f.availability === 'В наличии' && realRemaining < 50) {
            remainingHtml = `<span class="badge badge-danger">${remainingHtml}</span>`;
            rowClass = 'row-bg-danger';
        }

        return `<tr class="${rowClass}">
            <td>${iconHtml}<strong>${escapeHtml(f.customId)}</strong></td>
            <td>${f.date}</td>
            <td><span class="badge ${badge}">${escapeHtml(f.availability)}</span></td>
            <td><span class="color-swatch" style="background:${f.color ? f.color.hex : '#eee'}"></span>${f.color ? escapeHtml(f.color.name) : '-'}</td>
            <td>${escapeHtml(f.brand)}</td>
            <td>${escapeHtml(f.type)}</td>
            <td>${(f.length || 0).toFixed(1)}</td>
            <td>${remainingHtml} ${note}</td>
            <td>${(f.usedLength||0).toFixed(1)}</td>
            <td>${(f.usedWeight||0).toFixed(1)}</td>
            <td>${(f.actualPrice || 0).toFixed(2)}</td>
            <td>${(f.avgPrice || 0).toFixed(2)}</td>
            <td class="text-center">${link}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-secondary btn-small" title="Редактировать" onclick="editFilament(${f.id})">✎</button>
                    <button class="btn-secondary btn-small" title="Копировать" onclick="copyFilament(${f.id})">❐</button>
                    <button class="btn-danger btn-small" title="Удалить" onclick="deleteFilament(${f.id})">✕</button>
                </div>
            </td>
        </tr>`;
    }).join('');
    
    filterFilaments();
}







function updateProductColorDisplay() {
    const filamentSelect = document.getElementById('productFilament');
    const previewBox = document.getElementById('productColorSwatch');
    const colorName = document.getElementById('productColorName');
    
    if (!filamentSelect || !previewBox || !colorName) return;
    
    const filId = filamentSelect.value;
    const filament = db.filaments.find(f => f.id == filId);

    if (filament && filament.color) {
        previewBox.style.backgroundColor = filament.color.hex;
        colorName.textContent = escapeHtml(filament.color.name);
    } else {
        previewBox.style.backgroundColor = '#ffffff';
        colorName.textContent = '—';
    }
}



// ==================== WRITEOFFS (RESTORED LOGIC) ====================

function generateProductOptionLabel(product) {
    let colorText = '';
    if (product.type === 'Составное') {
        const uniqueColors = new Map();
        const children = db.products.filter(child => child.parentId == product.id);
        children.forEach(child => {
            if (child.filament && child.filament.color) {
                uniqueColors.set(child.filament.color.id, child.filament.color);
            }
        });
        if (uniqueColors.size > 0) {
            const colorNames = Array.from(uniqueColors.values()).map(color => escapeHtml(color.name));
            colorText = ` (${colorNames.join(' / ')})`;
        }
    } else if (product.filament && product.filament.color) {
        colorText = ` (${escapeHtml(product.filament.color.name)})`;
    }
    const infoText = `. Изготовлено: ${product.date}, в кол-ве: ${product.quantity}, остаток: ${product.inStock}`;
    return `${escapeHtml(product.name)}${colorText}${infoText}`;
}

function renumberWriteoffSections() {
    writeoffSectionCount = 0; // Reset counter
    const sections = document.querySelectorAll('.writeoff-item-section');
    sections.forEach((sec, i) => {
        writeoffSectionCount++;
        const newIndex = writeoffSectionCount;
        sec.id = `writeoffSection_${newIndex}`;
        sec.querySelector('.section-title').textContent = `ИЗДЕЛИЕ ${newIndex}`;
        
        // Update onclick handlers
        const btn = sec.querySelector('.btn-remove-section');
        btn.setAttribute('onclick', `removeWriteoffSection(${newIndex})`);
        
        // Update onchange handlers
        sec.querySelector('.writeoff-product-select').setAttribute('onchange', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-qty').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-price').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
    });
}

function removeWriteoffSection(index) {
    const el = document.getElementById(`writeoffSection_${index}`);
    if (el) el.remove();
    renumberWriteoffSections();
    updateRemoveButtons();
    calcWriteoffTotal();
}


function updateRemoveButtons() {
    const sections = document.querySelectorAll('.writeoff-item-section');
    sections.forEach(sec => {
        const btn = sec.querySelector('.btn-remove-section');
        if (sections.length === 1) {
            btn.style.display = 'none';
        } else {
            btn.style.display = 'block';
        }
    });
}


function openWriteoffModal(systemId = null) {
	isModalOpen = true;
    document.getElementById('writeoffModal').classList.add('active');
    document.getElementById('writeoffValidationMessage').classList.add('hidden');
    const isEdit = !!systemId;
    document.getElementById('writeoffModal').setAttribute('data-edit-group', isEdit ? systemId : '');
    
    // Обновляем список типов списания
    const typeSelect = document.getElementById('writeoffType');
    typeSelect.innerHTML = `
        <option value="Продажа">Продажа</option>
        <option value="Использовано">Использовано</option>
        <option value="Брак">Брак</option>
        <option value="Подготовлено к продаже">Подготовлено к продаже</option>
    `;

    if (isEdit) {
        document.querySelector('#writeoffModal .modal-header-title').textContent = 'Редактировать списание';
        const items = db.writeoffs.filter(w => w.systemId === systemId);
        const first = items[0];
        document.getElementById('writeoffSystemId').textContent = first.systemId;
        document.getElementById('writeoffDate').value = first.date;
        document.getElementById('writeoffType').value = first.type;
        document.getElementById('writeoffNote').value = first.note;
        document.getElementById('writeoffItemsContainer').innerHTML = '';
        writeoffSectionCount = 0;
        
        // УДАЛЕНО: ensurePreparedCheckboxExists(); 
        
        items.forEach(item => addWriteoffItemSection(item));
    } else {
        document.querySelector('#writeoffModal .modal-header-title').textContent = 'Добавить списание';
        const now = new Date();
        const genId = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        document.getElementById('writeoffSystemId').textContent = genId;
        document.getElementById('writeoffDate').value = now.toISOString().split('T')[0];
        document.getElementById('writeoffType').value = 'Продажа';
        document.getElementById('writeoffNote').value = '';
        document.getElementById('writeoffItemsContainer').innerHTML = '';
        writeoffSectionCount = 0;
        
        // УДАЛЕНО: ensurePreparedCheckboxExists();
        addWriteoffItemSection(); 
    }
    updateWriteoffTypeUI();
}


// Вспомогательная функция для добавления чекбокса
function ensurePreparedCheckboxExists() {
    const container = document.querySelector('#writeoffItemsContainer').previousElementSibling; // .form-section
    if (document.getElementById('showPreparedCheckbox')) return;

    const div = document.createElement('div');
    div.style.cssText = "display: flex; justify-content: flex-end; margin-bottom: 8px; margin-top: -10px;";
    div.innerHTML = `
        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: #64748b;">
            <input type="checkbox" id="showPreparedCheckbox" onchange="refreshProductSelectsInWriteoff()"> 
            Отображать подготовленные к продаже
        </label>
    `;
    container.appendChild(div);
}

// Обновляет списки товаров при клике на чекбокс
window.refreshProductSelectsInWriteoff = function() {
    const selects = document.querySelectorAll('.writeoff-product-select');
    selects.forEach(select => {
        const currentVal = select.value;
        const sectionId = select.closest('.writeoff-item-section').id.split('_')[1];
        // Перерисовываем опции
        populateWriteoffProductOptions(select, currentVal);
    });
}




function closeWriteoffModal() { 
	isModalOpen = false;
    if(dbRef && dbRef.parent) dbRef.parent.once('value').then(window.updateAppFromSnapshot);

	document.getElementById('writeoffModal').classList.remove('active'); 
}



function updateWriteoffTypeUI() {
    const type = document.getElementById('writeoffType').value;
    const isSale = type === 'Продажа';
    const isPrepared = type === 'Подготовлено к продаже';
    
    // --- ИЗМЕНЕНИЕ: Показываем сводку и для Подготовленного ---
    document.getElementById('writeoffTotalSummary').classList.toggle('hidden', !(isSale || isPrepared));
    
    document.querySelectorAll('.writeoff-item-section').forEach(sec => {
        const idx = sec.id.split('_')[1];
        updateWriteoffSection(idx);
    });
    calcWriteoffTotal();
    
    const el = document.getElementById('writeoffType');
    el.className = '';
    el.style = ''; // Сброс инлайн стилей
    
    if (type === 'Продажа') el.classList.add('select-writeoff-sale');
    else if (type === 'Использовано') el.classList.add('select-writeoff-used');
    else if (type === 'Брак') el.classList.add('select-writeoff-defective');
    else if (type === 'Подготовлено к продаже') { 
        el.style.backgroundColor = '#ffffff'; 
        el.style.color = '#475569'; 
        el.style.border = '1px solid #cbd5e1'; 
        el.style.fontWeight = '500';
    }
}



function addWriteoffItemSection(data = null) {
    writeoffSectionCount++;
    const index = writeoffSectionCount;
    const container = document.getElementById('writeoffItemsContainer');
    
    const div = document.createElement('div');
    div.className = 'writeoff-item-section';
    div.id = `writeoffSection_${index}`;
    
    div.innerHTML = `
        <div class="writeoff-item-header">
            <span class="section-title">ИЗДЕЛИЕ ${index}</span>
            <button class="btn-remove-section" onclick="removeWriteoffSection(${index})">✕</button>
        </div>
        <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                <label style="margin-bottom:0;">Наименование изделия:</label>
                <div style="display: flex; gap: 16px;">
                    <!-- СВИТЧЕР СОРТИРОВКИ -->
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: #64748b; font-weight: normal; white-space: nowrap;" title="По умолчанию сортировка по Наименованию (А-Я)">
                        <input type="checkbox" class="sort-by-id-checkbox" onchange="populateWriteoffProductOptions(this.closest('.writeoff-item-section').querySelector('.writeoff-product-select'), this.closest('.writeoff-item-section').querySelector('.writeoff-product-select').value)"> 
                        Сортировать по ID
                    </label>
                    
                    <!-- СВИТЧЕР ПОДГОТОВЛЕННЫХ -->
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; color: #64748b; font-weight: normal; white-space: nowrap;">
                        <input type="checkbox" class="show-prepared-checkbox" onchange="updateWriteoffSection(${index}); populateWriteoffProductOptions(this.closest('.writeoff-item-section').querySelector('.writeoff-product-select'), this.closest('.writeoff-item-section').querySelector('.writeoff-product-select').value)"> 
                        Отображать подготовленные
                    </label>
                </div>
            </div>
            <select class="writeoff-product-select" onchange="updateWriteoffSection(${index})">
                <option value="">-- Выберите изделие --</option>
            </select>
        </div>
        
        <div class="form-row-3">
            <div class="form-group">
                <label>Наличие (шт):</label>
                <div class="calc-field section-stock">0 шт.</div>
            </div>
            <div class="form-group">
                <label>Количество списания (шт):</label>
                <input type="number" class="section-qty" value="${data ? data.qty : ''}" min="1" oninput="updateWriteoffSection(${index})">
            </div>
            <div class="form-group">
                <label>Остаток (шт):</label>
                <div class="calc-field section-remaining">0 шт.</div>
            </div>
        </div>
        
        <div class="enrichment-section hidden" style="margin-top: 15px; margin-bottom: 15px; border-top: 1px dashed #ccc; padding-top: 10px;">
            <div style="font-size: 12px; font-weight: 600; color: #64748b; margin-bottom: 8px;">КОМПЛЕКТУЮЩИЕ (Доп. расходы на 1 шт.)</div>
            <div id="enrichmentContainer_${index}"></div>
            <button type="button" class="btn-secondary btn-small" onclick="addEnrichmentRow(${index})" style="width: 100%; justify-content: center; border-style: dashed;">+ Добавить деталь</button>
        </div>

        <div class="form-row-3 writeoff-price-row">
            <div class="form-group">
                <label class="label-with-tooltip" style="justify-content:center;">
                    Итоговая себест. (1 шт.)
                    <span class="tooltip-container"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-center section-tooltip">Изделие + Комплектующие</span></span>
                </label>
                <div class="calc-field section-cost">0.00 ₽</div>
            </div>
            <div class="form-group">
                <label>Цена продажи за 1 шт. (₽)</label>
                <input type="number" class="section-price" value="${data ? data.price : ''}" step="0.01" oninput="updateWriteoffSection(${index})">
            </div>
            <div class="form-group">
                <label>Стоимость продажи общая (₽)</label>
                <div class="calc-field section-total">0.00 ₽</div>
            </div>
        </div>
        
        <div class="markup-info hidden" style="margin-top: 8px; padding: 0 4px;">
            <div style="font-size: 12px; color: var(--color-text-light); margin-bottom: 4px;">
                Наценка для рыночной себестоимости = <span class="markup-market-val" style="font-weight:600; color: var(--color-text);">0 ₽ (0%)</span>
            </div>
            <div style="font-size: 12px; color: var(--color-text-light);">
                Наценка для реальной себестоимости = <span class="markup-actual-val" style="font-weight:600; color: var(--color-text);">0 ₽ (0%)</span>
            </div>
        </div>
		<div class="profit-info hidden" style="margin-top: 12px; padding: 0 4px; font-weight: bold; font-size: 13px;">
            Прибыль с продажи Изделия: <span class="profit-val">0.00 ₽</span>
        </div>
    `;
    container.appendChild(div);
    
    // Заполняем список
    const select = div.querySelector('.writeoff-product-select');
    populateWriteoffProductOptions(select, data ? data.productId : null);

    if (data && data.enrichmentCosts) {
        data.enrichmentCosts.forEach(item => addEnrichmentRow(index, item));
    }
    
    updateRemoveButtons();
    updateWriteoffSection(index); 
}





function populateWriteoffProductOptions(selectElement, selectedId) {
    const section = selectElement.closest('.writeoff-item-section');
    
    // 1. Получаем состояние чекбокса "Подготовленные"
    const checkboxPrepared = section.querySelector('.show-prepared-checkbox');
    const showPrepared = checkboxPrepared ? checkboxPrepared.checked : false;
    
    // 2. Получаем состояние чекбокса "Сортировка по ID"
    const checkboxSort = section.querySelector('.sort-by-id-checkbox');
    const sortById = checkboxSort ? checkboxSort.checked : false;

    const preparedProductIds = new Set();
    if (!showPrepared) {
        db.writeoffs.forEach(w => {
            if (w.type === 'Подготовлено к продаже') {
                preparedProductIds.add(w.productId);
            }
        });
    }

    const availableProducts = db.products.filter(p => {
        const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
        const usedElsewhere = getWriteoffQuantityForProduct(p.id, editGroup);
        const currentStock = Math.max(0, p.quantity - usedElsewhere);
        const hasStock = currentStock > 0;
        const isSelected = selectedId == p.id;
        
		if (p.isDraft) return false;
        return (p.type !== 'Часть составного') && 
               (isSelected || (!p.defective && hasStock)) &&
               (showPrepared || isSelected || !preparedProductIds.has(p.id));
    });
    
    // 3. ПРИМЕНЯЕМ СОРТИРОВКУ В ЗАВИСИМОСТИ ОТ ЧЕКБОКСА
    availableProducts.sort((a, b) => {
        if (sortById) {
            // Если галочка стоит: Сортировка по System ID (Новые сверху)
            return (b.systemId || '').localeCompare(a.systemId || '');
        } else {
            // Если галочка НЕ стоит (по умолчанию): Сортировка по Наименованию (А-Я)
            return (a.name || '').localeCompare(b.name || '');
        }
    });
    
    const options = availableProducts.map(p => {
        const isSelected = selectedId == p.id;
        const label = generateProductOptionLabel(p);
        return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${label}</option>`;
    }).join('');
    
    selectElement.innerHTML = `<option value="">-- Выберите изделие --</option>` + options;
    if(selectedId) selectElement.value = selectedId;
}






function updateWriteoffSection(index) {
    const section = document.getElementById(`writeoffSection_${index}`);
    if (!section) return;

    const pid = parseInt(section.querySelector('.writeoff-product-select').value);
    const qtyInput = section.querySelector('.section-qty');
    const priceInput = section.querySelector('.section-price');
    const enrichmentSection = section.querySelector('.enrichment-section');
    
    const type = document.getElementById('writeoffType').value;
    const isSale = type === 'Продажа';
    const isPrepared = type === 'Подготовлено к продаже';
    
    // --- ИСПРАВЛЕНИЕ: Комплектующие для Продажи И Подготовленного ---
    enrichmentSection.classList.toggle('hidden', !(isSale || isPrepared));
    priceInput.disabled = !(isSale || isPrepared);
    
    // Блоки прибыли показываем только для этих двух типов
    if (isSale || isPrepared) {
        section.querySelector('.markup-info').classList.remove('hidden');
        section.querySelector('.profit-info').classList.remove('hidden');
    } else {
        section.querySelector('.markup-info').classList.add('hidden');
        section.querySelector('.profit-info').classList.add('hidden');
    }

    const product = db.products.find(p => p.id === pid);
    
    if (!product) {
        section.querySelector('.section-stock').textContent = '0 шт.';
        section.querySelector('.section-remaining').textContent = '0 шт.';
        section.querySelector('.section-cost').textContent = '0.00 ₽';
        section.querySelector('.section-total').textContent = '0.00 ₽';
        calcWriteoffTotal();
        return;
    }

    const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
    const usedElsewhere = getWriteoffQuantityForProduct(pid, editGroup);
    const currentStock = Math.max(0, product.quantity - usedElsewhere);
    
    section.querySelector('.section-stock').textContent = currentStock + ' шт.';
    
    const qty = parseInt(qtyInput.value) || 0;
    const remaining = Math.max(0, currentStock - qty); 
    section.querySelector('.section-remaining').textContent = remaining + ' шт.';

    let totalEnrichmentCost = 0;
    section.querySelectorAll('.enrichment-row').forEach(row => {
        totalEnrichmentCost += parseFloat(row.querySelector('.enrichment-cost').value) || 0;
    });

    const costM = (product.costPer1Market || 0);
    const costA = (product.costPer1Actual || 0);
    
    const totalCostM = costM + totalEnrichmentCost;
    const totalCostA = costA + totalEnrichmentCost;

    section.querySelector('.section-cost').textContent = totalCostM.toFixed(2) + ' ₽';
    section.querySelector('.section-tooltip').textContent = `Себест. (реальная) изделия: ${costA.toFixed(2)} ₽ + Комплектующие: ${totalEnrichmentCost.toFixed(2)} ₽ = Итого: ${totalCostA.toFixed(2)} ₽`;
    
    const price = parseFloat(priceInput.value) || 0;
    section.querySelector('.section-total').textContent = (price * qty).toFixed(2) + ' ₽';
    
    if (isSale || isPrepared) {
        const markupM_money = price - totalCostM;
        const markupM_percent = totalCostM > 0 ? (markupM_money / totalCostM) * 100 : 0;
        const mkM_El = section.querySelector('.markup-market-val');
        if(mkM_El) {
            mkM_El.textContent = `${markupM_money.toFixed(2)} ₽ (${markupM_percent.toFixed(1)}%)`;
            mkM_El.style.color = markupM_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';
        }

        const markupA_money = price - totalCostA;
        const markupA_percent = totalCostA > 0 ? (markupA_money / totalCostA) * 100 : 0;
        const mkA_El = section.querySelector('.markup-actual-val');
        if(mkA_El) {
            mkA_El.textContent = `${markupA_money.toFixed(2)} ₽ (${markupA_percent.toFixed(1)}%)`;
            mkA_El.style.color = markupA_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';
        }

        const itemProfit = (price * qty) - (totalCostA * qty);
        const profitValSpan = section.querySelector('.profit-val');
        profitValSpan.textContent = `${itemProfit.toFixed(2)} ₽`;
        profitValSpan.style.color = itemProfit < 0 ? 'var(--color-danger)' : 'var(--color-success)';
    }
    
    calcWriteoffTotal();
}




// Добавляет строку комплектующего
function addEnrichmentRow(sectionIndex, data = null) {
    const container = document.getElementById(`enrichmentContainer_${sectionIndex}`);
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'enrichment-row';
    row.style.cssText = "display: flex; gap: 10px; margin-bottom: 8px;";
    
    const nameValue = data ? escapeHtml(data.name) : '';
    const costValue = data ? data.cost : '';
    
    // Генерируем опции для datalist
    const sortedComps = [...db.components].sort((a, b) => a.name.localeCompare(b.name));
    const datalistOptions = sortedComps.map(c => `<option value="${escapeHtml(c.name)}" data-price="${c.price}"></option>`).join('');
    const listId = `compList_${sectionIndex}_${Math.random().toString(36).substr(2, 9)}`;

    row.innerHTML = `
        <div style="flex:1; position:relative;">
            <input type="text" list="${listId}" class="enrichment-name" placeholder="Название детали..." value="${nameValue}" 
                   oninput="onComponentInput(this, ${sectionIndex})" onchange="updateWriteoffSection(${sectionIndex})">
            <datalist id="${listId}">${datalistOptions}</datalist>
        </div>
        <input type="number" class="enrichment-cost" placeholder="Цена" value="${costValue}" step="0.01" style="width: 160px;" oninput="updateWriteoffSection(${sectionIndex})">
        <button type="button" class="btn-remove-enrichment" onclick="this.parentElement.remove(); updateWriteoffSection(${sectionIndex})" style="width: 38px; padding: 0; display: flex; justify-content: center; align-items: center; border: 1px solid var(--color-danger); color: var(--color-danger); background: none; border-radius: 4px; cursor: pointer;">✕</button>
    `;
    container.appendChild(row);
}

// Хелпер для подстановки цены при выборе из списка
window.onComponentInput = function(input, sectionIndex) {
    const list = document.getElementById(input.getAttribute('list'));
    const options = list.options;
    for(let i = 0; i < options.length; i++) {
        if(options[i].value === input.value) {
            const price = options[i].getAttribute('data-price');
            // Находим соседнее поле цены и ставим значение
            const priceInput = input.parentElement.nextElementSibling;
            priceInput.value = price;
            updateWriteoffSection(sectionIndex);
            break;
        }
    }
};




// Пересчитывает остатки для ВСЕХ товаров
function recalculateAllProductStock() {
    // 1. Сбрасываем остатки до начальных (равно количеству)
    db.products.forEach(p => {
        p.inStock = p.defective ? 0 : p.quantity;
    });

    // 2. Вычитаем все списания (КРОМЕ статуса "Подготовлено к продаже")
    (db.writeoffs || []).forEach(w => {
        if (w.type === 'Подготовлено к продаже') return; // <--- ИГНОРИРУЕМ ЧЕРНОВИКИ

        const product = db.products.find(p => p.id === w.productId);
        if (product) {
            product.inStock -= w.qty;
        }
    });

    // 3. Обновляем статусы
    db.products.forEach(p => {
        p.status = determineProductStatus(p);
        p.availability = p.status;
    });
}



function calcWriteoffTotal() {
    let totalSale = 0;
    let totalProfit = 0;
    
    document.querySelectorAll('.writeoff-item-section').forEach(sec => {
        const qty = parseInt(sec.querySelector('.section-qty').value) || 0;
        const price = parseFloat(sec.querySelector('.section-price').value) || 0;
        const pid = parseInt(sec.querySelector('.writeoff-product-select').value);
        const product = db.products.find(p => p.id === pid);
        
        if (product) {
            const costA = product.costPer1Actual || 0;
            
            // Считаем стоимость комплектующих для этой секции
            let totalEnrichmentCost = 0;
            sec.querySelectorAll('.enrichment-row').forEach(row => {
                totalEnrichmentCost += parseFloat(row.querySelector('.enrichment-cost').value) || 0;
            });

            // Итоговая себестоимость одной единицы
            const totalCostPerUnit = costA + totalEnrichmentCost;

            totalSale += (qty * price);
            // Прибыль = (Цена продажи - Полная себестоимость) * Кол-во
            totalProfit += (price - totalCostPerUnit) * qty;
        }
    });

    const amountSpan = document.getElementById('writeoffTotalAmount');
    const profitSpan = document.getElementById('writeoffTotalProfit');

    amountSpan.textContent = `${totalSale.toFixed(2)} ₽`;
    profitSpan.textContent = `${totalProfit.toFixed(2)} ₽`;
    profitSpan.style.color = totalProfit < 0 ? 'var(--color-danger)' : 'var(--color-success)';
}


async function saveWriteoff() {
    const systemId = document.getElementById('writeoffSystemId').textContent;
    let date = document.getElementById('writeoffDate').value;
    const type = document.getElementById('writeoffType').value;
    const note = document.getElementById('writeoffNote').value;
    const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
    const isEdit = !!editGroup;

    // Логика смены даты
    if (isEdit) {
        const oldItem = db.writeoffs.find(w => w.systemId === editGroup);
        if (oldItem && oldItem.type === 'Подготовлено к продаже' && type !== 'Подготовлено к продаже') {
            date = new Date().toISOString().split('T')[0];
            document.getElementById('writeoffDate').value = date;
        }
    }

    const sections = document.querySelectorAll('.writeoff-item-section');
    const newItems = [];
    let globalValid = true; 
    
    document.getElementById('writeoffValidationMessage').classList.add('hidden');
    document.getElementById('writeoffValidationMessage').textContent = 'Не все обязательные поля заполнены';
    
    sections.forEach(sec => {
        sec.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    });

    if (sections.length === 0) globalValid = false;
    
    const productUsageMap = {}; 

    // ВАЛИДАЦИЯ и СБОР ДАННЫХ
    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        let sectionValid = true;

        const pid = sec.querySelector('.writeoff-product-select').value;
        const qtyInput = sec.querySelector('.section-qty');
        const qty = parseInt(qtyInput.value);

        if (!pid || !qty || qty <= 0) {
            if (!pid) sec.querySelector('.writeoff-product-select').classList.add('error');
            if (!qty || qty <= 0) qtyInput.classList.add('error');
            sectionValid = false;
        }
        
        if (pid && qty > 0) {
            const product = db.products.find(p => p.id == parseInt(pid));
            if (!product) { 
                sectionValid = false; 
            } else {
                if (!productUsageMap[pid]) productUsageMap[pid] = 0;
                productUsageMap[pid] += qty;
                
                const usedElsewhere = getWriteoffQuantityForProduct(parseInt(pid), editGroup);
                const currentStock = Math.max(0, product.quantity - usedElsewhere);
                
                if (productUsageMap[pid] > currentStock) {
                    const msg = `Ошибка: Попытка списать (${productUsageMap[pid]}) больше доступного остатка (${currentStock}) для "${product.name}"`;
                    document.getElementById('writeoffValidationMessage').textContent = msg;
                    document.getElementById('writeoffValidationMessage').classList.remove('hidden');
                    qtyInput.classList.add('error');
                    sectionValid = false;
                }
            }
        }

        let price = 0;
        if (type === 'Продажа' || type === 'Подготовлено к продаже') {
            const priceInput = sec.querySelector('.section-price');
            price = parseFloat(priceInput.value);
            if (type === 'Продажа' && (isNaN(price) || price <= 0)) {
                priceInput.classList.add('error');
                sectionValid = false;
            }
        }
        
        const enrichmentCosts = [];
        if (type === 'Продажа' || type === 'Подготовлено к продаже') {
            sec.querySelectorAll('.enrichment-row').forEach(row => {
                const name = row.querySelector('.enrichment-name').value.trim();
                const cost = parseFloat(row.querySelector('.enrichment-cost').value) || 0;
                if (name && cost > 0) enrichmentCosts.push({ name, cost });
            });
        }

        if (sectionValid) {
            const product = db.products.find(p => p.id == parseInt(pid));
            newItems.push({
                id: Date.now() + i, 
                systemId: systemId,
                date: date,
                productId: parseInt(pid),
                productName: product ? product.name : 'Unknown',
                type: type,
                qty: qty,
                price: price,
                total: qty * price,
                note: note,
                enrichmentCosts: enrichmentCosts
            });
        } else {
            globalValid = false;
        }
    }

    if (!globalValid) {
        document.getElementById('writeoffValidationMessage').classList.remove('hidden');
        return;
    }
    
    if (newItems.length === 0) { showToast('Нет данных для сохранения', 'error'); return; }

    try {
        // 1. [FIX] ТРАНЗАКЦИЯ ДЛЯ СПИСАНИЙ (Решает коллизию массивов)
        await dbRef.child('writeoffs').transaction((currentList) => {
            if (!currentList) currentList = [];
            
            // Если редактирование - удаляем старые записи этой группы
            if (isEdit) {
                currentList = currentList.filter(w => w && w.systemId !== systemId);
            }
            
            // Добавляем новые
            newItems.forEach(item => currentList.push(item));
            
            return currentList;
        });

        // 2. Локальное обновление списаний
        if (isEdit) {
            db.writeoffs = db.writeoffs.filter(w => w.systemId !== systemId);
        }
        newItems.forEach(item => db.writeoffs.push(item));

        // 3. Обновление компонентов и остатков (через Update, здесь коллизии не страшны)
        const updates = {};
        
        // Компоненты
        newItems.forEach(item => {
            if (item.enrichmentCosts) {
                item.enrichmentCosts.forEach(comp => {
                    const existingComp = db.components.find(c => c.name.toLowerCase() === comp.name.toLowerCase());
                    if (!existingComp) {
                        const newCompIndex = db.components.length;
                        updates[`components/${newCompIndex}`] = { name: comp.name, price: comp.cost };
                        db.components.push({ name: comp.name, price: comp.cost }); 
                    } else if (Math.abs(existingComp.price - comp.cost) > 0.01) {
                        const cIndex = db.components.indexOf(existingComp);
                        updates[`components/${cIndex}/price`] = comp.cost;
                    }
                });
            }
        });

        // Остатки
        recalculateAllProductStock();
        db.products.forEach((p, idx) => {
            updates[`products/${idx}/inStock`] = p.inStock;
            updates[`products/${idx}/status`] = p.status;
            updates[`products/${idx}/availability`] = p.status;
        });
        
        if (Object.keys(updates).length > 0) {
            await dbRef.update(updates);
        }

        updateWriteoffTable(); 
        updateProductsTable(); 
        updateDashboard(); 
        updateReports(); 
        updateAllSelects();
        closeWriteoffModal();

    } catch (e) {
        console.error("Ошибка сохранения списания:", e);
        showToast("Ошибка: " + e.message, "error");
    }
}



async function deleteWriteoff(systemId) {
    if (!confirm('Удалить списание? Изделия будут возвращены на склад (кроме статуса "Подготовлено к продаже").')) return;

    // --- ПЕРЕСЧЕТ ОСТАТКОВ ---
    const itemsToDelete = db.writeoffs.filter(w => w.systemId === systemId);

    // Сначала готовим обновления для остатков, чтобы не потерять данные
    const stockUpdates = {};

    itemsToDelete.forEach(item => {
        // Пропускаем возврат на склад для "Подготовлено к продаже"
        if (item.type === 'Подготовлено к продаже') {
            return; 
        }

        const p = db.products.find(x => x.id === item.productId);

        if(p) {
            const productIndex = db.products.indexOf(p);

            // Мы должны увеличить остаток, так как отменяем списание
            p.inStock += item.qty; 

            // Формируем пути для обновления в Firebase
            stockUpdates[`products/${productIndex}/inStock`] = p.inStock;
            stockUpdates[`products/${productIndex}/status`] = determineProductStatus(p);
            stockUpdates[`products/${productIndex}/availability`] = determineProductStatus(p);
        }
    });

    // Применяем изменения к остаткам
    if (Object.keys(stockUpdates).length > 0) {
        await dbRef.update(stockUpdates);
    }

    // --- УДАЛЕНИЕ ЗАПИСЕЙ ---
    const indicesToRemove = [];
    db.writeoffs.forEach((w, index) => {
        if (w.systemId === systemId) indicesToRemove.push(index);
    });

    // Удаляем с конца, чтобы не сбивать индексы (хотя при использовании child().remove() порядок не так важен для Firebase, но важен для логики)
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
        await dbRef.child('writeoffs').child(indicesToRemove[i]).remove();
    }
    
}




function openWriteoffModalForProduct(pid) {
    if (!pid) return;
    openWriteoffModal();
    setTimeout(() => {
        const sel = document.querySelector('.writeoff-product-select');
        if(sel) { sel.value = pid; sel.onchange(); }
    }, 100);
}

function editWriteoff(systemId) { openWriteoffModal(systemId); }

function updateWriteoffTable() {
    const tbody = document.querySelector('#writeoffTable tbody');
    const filterType = document.getElementById('writeoffTypeFilter').value;
    const search = document.getElementById('writeoffSearch').value.toLowerCase();
    const sortBy = document.getElementById('writeoffSortBy').value;
	const typeFilterSelect = document.getElementById('writeoffTypeFilter');
    if (!typeFilterSelect.querySelector('option[value="Подготовлено к продаже"]')) {
        const opt = document.createElement('option');
        opt.value = 'Подготовлено к продаже';
        opt.textContent = 'Подготовлено к продаже';
        typeFilterSelect.appendChild(opt);
    }
    
    let list = db.writeoffs || [];
    
    // Фильтрация
    if (filterType) list = list.filter(w => w.type === filterType);
    if (search) list = list.filter(w => (w.productName && w.productName.toLowerCase().includes(search)) || (w.systemId && w.systemId.includes(search)));

    // Сортировка
    list.sort((a,b) => {
        if (sortBy === 'systemId-desc') return b.systemId.localeCompare(a.systemId);
        if (sortBy === 'systemId-asc') return a.systemId.localeCompare(b.systemId);
        if (sortBy === 'date-desc') return new Date(b.date) - new Date(a.date);
        if (sortBy === 'date-asc') return new Date(a.date) - new Date(b.date);
        if (sortBy === 'product') return a.productName.localeCompare(b.productName);
        if (sortBy === 'total') return (b.total || 0) - (a.total || 0);
        return 0;
    });

    tbody.innerHTML = list.map(w => {
        let statusBadge = 'badge-secondary';
        if (w.type === 'Продажа') statusBadge = 'badge-success';
        else if (w.type === 'Использовано') statusBadge = 'badge-purple';
        else if (w.type === 'Брак') statusBadge = 'badge-danger';
        else if (w.type === 'Подготовлено к продаже') statusBadge = 'badge-white';

        const product = db.products.find(p => p.id === w.productId);
        const actualCost = product ? (product.costPer1Actual || 0).toFixed(2) : '0.00';

        // --- ИЗМЕНЕНИЕ: Добавлены обработчики событий для превью картинки ---
        // Использованы те же функции showProductImagePreview, что и в таблице изделий
        const nameEvents = w.productId ? `onmouseenter="showProductImagePreview(this, ${w.productId})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"` : '';

        return `<tr>
            <td>${w.date}</td>
            <td><small>${escapeHtml(w.systemId)}</small></td>
            <td ${nameEvents} style="cursor:default"><strong>${escapeHtml(w.productName)}</strong></td>
            <td><span class="badge ${statusBadge}">${escapeHtml(w.type)}</span></td>
            <td>${actualCost} ₽</td>
            <td>${w.qty}</td>
            <td>${(w.type === 'Продажа' || w.type === 'Подготовлено к продаже') ? w.price.toFixed(2) : '-'}</td>
            <td>${(w.type === 'Продажа' || w.type === 'Подготовлено к продаже') ? w.total.toFixed(2) : '-'}</td>
            <td>${escapeHtml(w.note || '')}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-secondary btn-small" title="Редактировать группу" data-writeoff-id="${escapeHtml(String(w.systemId || ''))}" onclick="editWriteoff(this.getAttribute('data-writeoff-id'))">✎</button>
                    <button class="btn-secondary btn-small" title="Копировать строку" onclick="copyWriteoffItem(${w.id})">❐</button>
                    <button class="btn-danger btn-small" title="Удалить группу" data-writeoff-id="${escapeHtml(String(w.systemId || ''))}" onclick="deleteWriteoff(this.getAttribute('data-writeoff-id'))">✕</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}



function copyWriteoffItem(rowId) {
    const item = db.writeoffs.find(w => w.id === rowId); 
    if (!item) return;

    openWriteoffModal(); 
    
    const container = document.getElementById('writeoffItemsContainer');
    container.innerHTML = '';
    writeoffSectionCount = 0;

    document.getElementById('writeoffType').value = item.type;
    
    document.getElementById('writeoffNote').value = ''; // <--- ИЗМЕНЕНО: Очистка комментария
    
    document.getElementById('writeoffDate').value = new Date().toISOString().split('T')[0];
    
    updateWriteoffTypeUI();

    addWriteoffItemSection({
        productId: item.productId,
        qty: item.qty,
        price: item.price
    });
    
    document.querySelector('#writeoffModal .modal-header-title').textContent = 'Копирование записи списания';
}





// ==================== REPORTS (FIXED LOGIC) ====================

function updateFinancialReport() {
    const dStart = new Date(document.getElementById('reportStartDate').value);
    const dEnd = new Date(document.getElementById('reportEndDate').value); 
    dEnd.setHours(23,59,59,999);

    const filamentsBought = db.filaments.filter(f => { const d=new Date(f.date); return d>=dStart && d<=dEnd; });
    const sumExpenses = filamentsBought.reduce((s,f) => s + (f.actualPrice||0), 0);

    const writeoffsInRange = db.writeoffs.filter(w => { 
        const d=new Date(w.date); 
        return d>=dStart && d<=dEnd && w.type!=='Подготовлено к продаже'; 
    });
    
    const sumRevenue = writeoffsInRange.filter(w => w.type==='Продажа').reduce((s,w) => s+(w.total||0), 0);

    let sumCOGS = 0; 
    let sumCostUsedDefect = 0;

    writeoffsInRange.forEach(w => {
        const product = db.products.find(x => x && x.id === w.productId);
		
        const costOne = product ? (product.costPer1Actual||0) : 0;
        const enrichmentCost = (w.enrichmentCosts||[]).reduce((s, item) => s + (item.cost||0), 0);
        
        const totalCostOne = costOne + enrichmentCost;
        const totalCost = totalCostOne * w.qty;

        if(w.type==='Продажа') {
            sumCOGS += totalCost;
        } else if (w.type === 'Использовано' || w.type === 'Брак') {
            sumCostUsedDefect += totalCost;
        }
    });

    // ДОП ЗАДАНИЕ: Исключаем части составных изделий из прямого подсчета брака в списке изделий,
    // так как предполагается, что учет ведется по родительскому изделию или через списания.
    const defectiveProducts = db.products.filter(p => { 
        const d=new Date(p.date); 
        return p.defective && !p.isDraft && p.type !== 'Часть составного' && d>=dStart && d<=dEnd; 
    });
    defectiveProducts.forEach(p => sumCostUsedDefect += (p.costActualPrice||0));

    // Сервисные расходы
    const serviceInRange = db.serviceExpenses.filter(s => { 
        const d=new Date(s.date); 
        return d>=dStart && d<=dEnd; 
    });
    const sumService = serviceInRange.reduce((s,x) => s + (x.total||0), 0);

    const createRow = (title, desc, expenses, costUsed, service, revenue, cogs, profit) => {
        const ros = revenue > 0 ? (profit/revenue)*100 : 0;
        const markup = cogs > 0 ? (profit/cogs)*100 : 0;
        const fmtMoney = v => v!=null ? v.toLocaleString('ru-RU',{style:'currency',currency:'RUB'}) : '';
        const fmtNum = v => v!=null ? v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
        const pColor = profit>0?'val-positive':(profit<0?'val-negative':'val-neutral');

        // У сервиса убираем цветное форматирование цифр, делаем обычным текстом
        const serviceStyle = service!=null ? 'color: var(--color-text);' : '';

        return `
        <tr>
            <td style="text-align:left; padding: 12px 16px;">
                <div class="tooltip-container" style="display: inline-block; position: relative;">
                    <div class="report-row-title">${title}</div>
                    <span class="tooltip-text">${desc}</span>
                </div>
            </td>
            <td class="report-val val-neutral">${expenses!=null ? fmtMoney(expenses) : ''}</td>
            <td class="report-val val-neutral">${costUsed!=null ? fmtMoney(costUsed) : ''}</td>
            
            <td class="report-val" style="${serviceStyle}">${service!=null ? fmtMoney(service) : ''}</td>
            
            <td class="report-val val-neutral">${revenue!=null ? fmtMoney(revenue) : ''}</td>
            <td class="report-val val-neutral">${cogs!=null ? fmtMoney(cogs) : ''}</td>
            
            <td class="report-val col-profit ${pColor}">${fmtMoney(profit)}</td>
            <td class="report-val col-ros">${revenue!=null && cogs!=null ? fmtNum(ros)+'%' : ''}</td>
            <td class="report-val col-markup">${cogs!=null ? fmtNum(markup)+'%' : ''}</td>
        </tr>`;
    };

    // 1. Profit (Cash Flow): Теперь включает вычет сервисных расходов
    // Формула: Выручка - Филамент - Сервис
    const profit1 = sumRevenue - sumExpenses - sumService;
    
    // 2. Profit (Adjusted): Cash Flow + Себест.Брака. 
    // ВАЖНО: Мы НЕ вычитаем сервис второй раз, так как он уже вычтен в profit1.
    // И мы не показываем значение в колонке service для этой строки (pass null).
    const profit2 = profit1 + sumCostUsedDefect;
    
    // 3. Gross Profit (Trading): Без изменений
    const profit3 = sumRevenue - sumCOGS;
    
    // 4. Net Profit (Operating): Вычитаем всё
    const profit4 = profit3 - sumCostUsedDefect - sumService;

    let html = '';
    html += createRow(
        'Прибыль (Cash Flow)', 
        '<b>Формула:</b><br>Выручка с продаж<br>− Затраты на покупку филамента<br>− Сервисные расходы', 
        sumExpenses, null, sumService, sumRevenue, null, profit1
    );
    
    html += createRow(
        'Прибыль (Скорректированная)', 
        '<b>Формула:</b><br>Cash Flow + Себестоимость (Использовано для себя + Брак)', 
        sumExpenses, sumCostUsedDefect, null, sumRevenue, null, profit2
    );
    
    html += createRow(
        'Валовая прибыль (Торговая)', 
        '<b>Формула:</b><br>Выручка с продаж<br>− Себестоимость проданных товаров', 
        null, null, null, sumRevenue, sumCOGS, profit3
    );
    
    html += createRow(
        'Чистая прибыль (Операционная)', 
        '<b>Формула:</b><br>Валовая прибыль<br>− Убытки (Использовано + Брак)<br>− Сервисные расходы', 
        null, sumCostUsedDefect, sumService, sumRevenue, sumCOGS, profit4
    );

    document.querySelector('#financialTable tbody').innerHTML = html;
}




function updateReports() {
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    
    if (!startInput.value) {
        const prevYear = new Date().getFullYear() - 1;
        startInput.value = `${prevYear}-01-01`;
    }
    if (!endInput.value) {
        endInput.value = new Date().toISOString().split('T')[0];
    }

    updateFinancialReport();
}



// ==================== REFERENCES UI ====================


// --- COMPONENTS REFERENCE ---
function updateComponentsList() {
    const listDiv = document.getElementById('componentsList');
    if (!listDiv) return;
    
    // Сортировка по имени
    const sorted = [...db.components].sort((a, b) => a.name.localeCompare(b.name));
    
    listDiv.innerHTML = sorted.map((c, i) => `
        <div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
            <span>${escapeHtml(c.name)} — <strong>${c.price.toFixed(2)} ₽</strong></span>
            <div class="action-buttons">
                <button class="btn-secondary btn-small" onclick="editComponent(${i})">✎</button>
                <button class="btn-danger btn-small" onclick="removeComponent(${i})">✕</button>
            </div>
        </div>
    `).join('');
}

// --- COMPONENTS ---
async function addComponent() {
    const name = document.getElementById('newComponentName').value.trim();
    const price = parseFloat(document.getElementById('newComponentPrice').value);
    
    if (name && !isNaN(price)) {
        const newComp = { name, price };
        db.components.push(newComp);
        
        const index = db.components.length - 1;
        await dbRef.child('components').child(index).set(newComp);
        
        document.getElementById('newComponentName').value = '';
        document.getElementById('newComponentPrice').value = '';
        updateComponentsList();
    } else {
        showToast('Введите название и цену', 'error');
    }
}

async function removeComponent(index) {
    const sorted = [...db.components].sort((a, b) => a.name.localeCompare(b.name));
    const toRemove = sorted[index];
    const realIndex = db.components.indexOf(toRemove);
    
    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить комплектующее "${toRemove.name}"?`)) return;

    if (realIndex > -1) {
        db.components.splice(realIndex, 1);
        await dbRef.child('components').set(db.components); 
        updateComponentsList();
    }
}


async function editComponent(index) {
    const sorted = [...db.components].sort((a, b) => a.name.localeCompare(b.name));
    const comp = sorted[index];
    const realIndex = db.components.indexOf(comp);
    
    const newName = prompt("Название:", comp.name);
    if (newName) {
        const newPrice = prompt("Цена:", comp.price);
        if (newPrice && !isNaN(parseFloat(newPrice))) {
            const updates = {};
            updates[`components/${realIndex}/name`] = newName.trim();
            updates[`components/${realIndex}/price`] = parseFloat(newPrice);
            
            // Обновляем локально
            db.components[realIndex].name = newName.trim();
            db.components[realIndex].price = parseFloat(newPrice);
            
            await dbRef.update(updates);
            updateComponentsList();
        }
    }
}



function updateBrandsList(){ document.getElementById('brandsList').innerHTML = db.brands.map((b,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
    <div style="display:flex; align-items:center;">
        <div class="sort-buttons">
            <button class="btn-sort" onclick="moveReferenceItemUp('brands', ${i})" ${i===0?'disabled':''}>▲</button>
            <button class="btn-sort" onclick="moveReferenceItemDown('brands', ${i})" ${i===db.brands.length-1?'disabled':''}>▼</button>
        </div>
        <span>${escapeHtml(b)}</span>
    </div>
    <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editBrand(${i})">✎</button><button class="btn-danger btn-small" onclick="removeBrand(${i})">✕</button></div>
</div>`).join(''); }

function updateColorsList(){ document.getElementById('colorsList').innerHTML = db.colors.map((c,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
    <div style="display:flex; align-items:center;">
        <div class="sort-buttons">
            <button class="btn-sort" onclick="moveReferenceItemUp('colors', ${i})" ${i===0?'disabled':''}>▲</button>
            <button class="btn-sort" onclick="moveReferenceItemDown('colors', ${i})" ${i===db.colors.length-1?'disabled':''}>▼</button>
        </div>
        <span><span class="color-swatch" style="background:${c.hex}"></span>${escapeHtml(c.name)}</span>
    </div>
    <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editColor(${c.id})">✎</button><button class="btn-danger btn-small" onclick="removeColor(${c.id})">✕</button></div>
</div>`).join(''); }

function updateFilamentTypeList(){ document.getElementById('filamentTypeList').innerHTML = db.plasticTypes.map((t,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
    <div style="display:flex; align-items:center;">
        <div class="sort-buttons">
            <button class="btn-sort" onclick="moveReferenceItemUp('plasticTypes', ${i})" ${i===0?'disabled':''}>▲</button>
            <button class="btn-sort" onclick="moveReferenceItemDown('plasticTypes', ${i})" ${i===db.plasticTypes.length-1?'disabled':''}>▼</button>
        </div>
        <span>${escapeHtml(t)}</span>
    </div>
    <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilamentType(${i})">✎</button><button class="btn-danger btn-small" onclick="removeFilamentType(${i})">✕</button></div>
</div>`).join(''); }

// function updateFilamentStatusList(){ document.getElementById('filamentStatusList').innerHTML = db.filamentStatuses.map((s,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
//     <div style="display:flex; align-items:center;">
//         <div class="sort-buttons">
//             <button class="btn-sort" onclick="moveReferenceItemUp('filamentStatuses', ${i})" ${i===0?'disabled':''}>▲</button>
//             <button class="btn-sort" onclick="moveReferenceItemDown('filamentStatuses', ${i})" ${i===db.filamentStatuses.length-1?'disabled':''}>▼</button>
//         </div>
//         <span>${escapeHtml(s)}</span>
//     </div>
//     <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilamentStatus(${i})">✎</button><button class="btn-danger btn-small" onclick="removeFilamentStatus(${i})">✕</button></div>
// </div>`).join(''); }

function updatePrintersList(){ document.getElementById('printersList').innerHTML = db.printers.map((p,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
    <div style="display:flex; align-items:center;">
        <div class="sort-buttons">
            <button class="btn-sort" onclick="moveReferenceItemUp('printers', ${i})" ${i===0?'disabled':''}>▲</button>
            <button class="btn-sort" onclick="moveReferenceItemDown('printers', ${i})" ${i===db.printers.length-1?'disabled':''}>▼</button>
        </div>
        <span>${escapeHtml(p.model)} (${p.power}кВт)</span>
    </div>
    <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editPrinter(${p.id})">✎</button><button class="btn-danger btn-small" onclick="removePrinter(${p.id})">✕</button></div>
</div>`).join(''); }



function updateElectricityCostList() {
    const listDiv = document.getElementById('electricityCostList'); 
    if (!listDiv) return; 
    const sorted = [...db.electricityCosts].sort((a, b) => new Date(b.date) - new Date(a.date));
    listDiv.innerHTML = sorted.map(c => `<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>С <strong>${escapeHtml(c.date)}</strong> — <strong>${c.cost} ₽/кВт</strong></span><div class="action-buttons"><button class="btn-danger btn-small" onclick="removeElectricityCost(${c.id})">✕</button></div></div>`).join('');
}

// Функции управления (Add/Remove/Edit)

// --- Brands  ---
async function addBrand(){ 
    const v=document.getElementById('newBrand').value.trim(); 
    if(v && !db.brands.includes(v)){ 
        const index = db.brands.length;
        await dbRef.child('brands').child(index).set(v); // Добавляем в конец
        document.getElementById('newBrand').value=''; 
        // Локально обновлять не обязательно, listener сделает это
    }
}

async function removeBrand(i){ 
    const val = db.brands[i]; 
    if(db.filaments.some(f => f.brand === val)) { 
        showToast('Нельзя удалить: используется.', 'error'); 
        return; 
    } 
    
    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить бренд "${val}"?`)) return;

    db.brands.splice(i, 1); 
    await dbRef.child('brands').set(db.brands); 
    updateAllSelects(); 
}


async function editBrand(i) { 
    const newVal = prompt("Изменить:", db.brands[i]); 
    if(newVal && newVal.trim()) { 
        const oldVal = db.brands[i]; 
        // Обновляем бренд в списке
        await dbRef.child('brands').child(i).set(newVal.trim());
        
        // ВНИМАНИЕ: Нужно обновить все филаменты, использующие этот бренд
        const updates = {};
        db.filaments.forEach((f, idx) => { 
            if(f.brand === oldVal) 
                updates[`filaments/${idx}/brand`] = newVal.trim(); 
        });
        if(Object.keys(updates).length > 0) await dbRef.update(updates);
    } 
}


// --- COLORS ---
async function addColor(){ 
    const n = document.getElementById('newColor').value.trim(); 
    const h = document.getElementById('newColorCode').value; 
    if(n){ 
        const newColor = {id: Date.now(), name: n, hex: h};
        // Обновляем локально
        db.colors.push(newColor);
        // Отправляем в Firebase (добавляем в конец списка)
        const index = db.colors.length - 1;
        await dbRef.child('colors').child(index).set(newColor);
        
        document.getElementById('newColor').value=''; 
        updateAllSelects(); 
    }
}

async function removeColor(id){ 
    if(db.filaments.some(f => f.color && f.color.id === id)) { 
        showToast('Нельзя удалить: используется.', 'error'); 
        return; 
    } 
    
    const colorToRemove = db.colors.find(c => c.id === id);
    const name = colorToRemove ? colorToRemove.name : 'цвет';

    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить цвет "${name}"?`)) return;
    
    db.colors = db.colors.filter(c => c.id !== id); 
    await dbRef.child('colors').set(db.colors); 
    updateAllSelects(); 
}


async function editColor(id) { 
    const c = db.colors.find(x => x.id === id); 
    if(!c) return; 
    const newName = prompt("Изменить:", c.name); 
    if(newName && newName.trim()) { 
        const oldName = c.name;
        c.name = newName.trim(); // Локальное обновление
        
        const updates = {};
        const index = db.colors.indexOf(c);
        
        // 1. Обновляем имя в справочнике
        updates[`colors/${index}/name`] = c.name;
        
        // 2. Обновляем имя цвета во всех филаментах, где он используется
        db.filaments.forEach((f, idx) => {
            if(f.color && f.color.id === id) {
                // Обновляем вложенный объект цвета внутри филамента
                updates[`filaments/${idx}/color/name`] = c.name;
                // Обновляем локально тоже, чтобы UI сразу перерисовался корректно
                f.color.name = c.name;
            }
        });
        
        if(Object.keys(updates).length > 0) await dbRef.update(updates);
        updateAllSelects(); 
    } 
}


// --- FILAMENT TYPES ---
async function addFilamentType(){ 
    const v = document.getElementById('newFilamentType').value.trim(); 
    if(v && !db.plasticTypes.includes(v)){ 
        db.plasticTypes.push(v);
        const index = db.plasticTypes.length - 1;
        await dbRef.child('plasticTypes').child(index).set(v);
        
        document.getElementById('newFilamentType').value=''; 
        updateAllSelects(); 
    }
}

async function removeFilamentType(i){ 
    const val = db.plasticTypes[i]; 
    if(db.filaments.some(f => f.type === val)) { 
        showToast('Нельзя удалить: используется.', 'error'); 
        return; 
    } 
    
    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить тип пластика "${val}"?`)) return;

    db.plasticTypes.splice(i, 1);
    await dbRef.child('plasticTypes').set(db.plasticTypes);
    updateAllSelects(); 
}


async function editFilamentType(i) { 
    const newVal = prompt("Изменить:", db.plasticTypes[i]); 
    if(newVal && newVal.trim()) { 
        const oldVal = db.plasticTypes[i]; 
        const cleanedVal = newVal.trim();
        
        // Локально
        db.plasticTypes[i] = cleanedVal;
        
        const updates = {};
        // 1. Обновляем справочник
        updates[`plasticTypes/${i}`] = cleanedVal;
        
        // 2. Обновляем филаменты
        db.filaments.forEach((f, idx) => {
            if(f.type === oldVal) {
                updates[`filaments/${idx}/type`] = cleanedVal;
                f.type = cleanedVal; // Локально
            }
        });
        
        await dbRef.update(updates);
        updateAllSelects(); 
    } 
}

// --- FILAMENT STATUSES закомментировано по причине скрытия справочника из пользовательского интерфейса---
// async function addFilamentStatus(){ 
//     const v = document.getElementById('newFilamentStatus').value.trim(); 
//     if(v && !db.filamentStatuses.includes(v)){ 
//         db.filamentStatuses.push(v);
//         const index = db.filamentStatuses.length - 1;
//         await dbRef.child('filamentStatuses').child(index).set(v);
        
//         document.getElementById('newFilamentStatus').value=''; 
//         updateAllSelects(); 
//     }
// }

// async function removeFilamentStatus(i){ 
//     const val = db.filamentStatuses[i]; 
//     if(db.filaments.some(f => f.availability === val)) { showToast('Нельзя удалить: используется.', 'error'); return; } 
    
//     db.filamentStatuses.splice(i, 1);
//     await dbRef.child('filamentStatuses').set(db.filamentStatuses);
//     updateAllSelects(); 
// }

// async function editFilamentStatus(i) { 
//     const newVal = prompt("Изменить:", db.filamentStatuses[i]); 
//     if(newVal && newVal.trim()) { 
//         const oldVal = db.filamentStatuses[i]; 
//         const cleanedVal = newVal.trim();
        
//         db.filamentStatuses[i] = cleanedVal;
        
//         const updates = {};
//         updates[`filamentStatuses/${i}`] = cleanedVal;
        
//         db.filaments.forEach((f, idx) => {
//             if(f.availability === oldVal) {
//                 updates[`filaments/${idx}/availability`] = cleanedVal;
//                 f.availability = cleanedVal;
//             }
//         });
        
//         await dbRef.update(updates);
//         updateAllSelects(); 
//     } 
// }

// --- PRINTERS ---
async function addPrinter(){ 
    const m = document.getElementById('newPrinterModel').value.trim(); 
    const p = parseFloat(document.getElementById('newPrinterPower').value); 
    if(m){ 
        const newPrinter = {id: Date.now(), model: m, power: p||0};
        db.printers.push(newPrinter);
        const index = db.printers.length - 1;
        await dbRef.child('printers').child(index).set(newPrinter);
        
        document.getElementById('newPrinterModel').value=''; 
        updateAllSelects(); 
    }
}

async function removePrinter(id){ 
    if(db.products.some(p => p.printer && p.printer.id === id)) { 
        showToast('Нельзя удалить: используется.', 'error'); 
        return; 
    } 
    
    const printer = db.printers.find(p => p.id === id);
    const name = printer ? printer.model : 'принтер';

    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить принтер "${name}"?`)) return;
    
    db.printers = db.printers.filter(p => p.id !== id);
    await dbRef.child('printers').set(db.printers);
    updateAllSelects(); 
}


async function editPrinter(id) { 
    const p = db.printers.find(x => x.id === id); 
    if(!p) return; 
    const newModel = prompt("Модель:", p.model); 
    if(newModel && newModel.trim()) { 
        const newPowerStr = prompt("Мощность (кВт):", p.power); 
        const newPower = parseFloat(newPowerStr); 
        
        // Локальное обновление
        p.model = newModel.trim(); 
        if(!isNaN(newPower)) p.power = newPower; 
        
        const updates = {};
        const index = db.printers.indexOf(p);
        
        // 1. Обновляем справочник
        updates[`printers/${index}`] = p;
        
        // 2. Обновляем изделия
        db.products.forEach((prod, idx) => {
            if(prod.printer && prod.printer.id === id) {
                updates[`products/${idx}/printer`] = p;
                prod.printer = p; // Локально
            }
        });
        
        await dbRef.update(updates);
        updateAllSelects(); 
    } 
}

// --- ELECTRICITY COSTS ---
async function addElectricityCost() { 
    const date = document.getElementById('newElectricityDate').value; 
    const cost = parseFloat(document.getElementById('newElectricityCost').value); 
    if (!date || isNaN(cost) || cost <= 0) { showToast('Ошибка ввода.', 'error'); return; } 
    if (db.electricityCosts.some(c => c.date === date)) { showToast('Тариф на эту дату уже есть.', 'error'); return; } 
    
    const newCost = { id: Date.now(), date: date, cost: cost };
    db.electricityCosts.push(newCost);
    
    const index = db.electricityCosts.length - 1;
    await dbRef.child('electricityCosts').child(index).set(newCost);
    
    document.getElementById('newElectricityDate').value=''; 
    document.getElementById('newElectricityCost').value=''; 
    
    recalculateAllProductCosts(); // Тариф влияет на себестоимость, нужен пересчет
    
    // ВАЖНО: При изменении тарифа нужно обновить себестоимость всех изделий в базе
    const updates = {};
    db.products.forEach((prod, idx) => {
        updates[`products/${idx}/costActualPrice`] = prod.costActualPrice;
        updates[`products/${idx}/costMarketPrice`] = prod.costMarketPrice;
        updates[`products/${idx}/costPer1Actual`] = prod.costPer1Actual;
        updates[`products/${idx}/costPer1Market`] = prod.costPer1Market;
    });
    if(Object.keys(updates).length > 0) await dbRef.update(updates);

    updateAllSelects(); 
    updateProductsTable(); 
}

async function removeElectricityCost(id) { 
    if (db.electricityCosts.length <= 1) { 
        showToast('Нельзя удалить последний тариф.', 'error'); 
        return; 
    } 
    
    const costItem = db.electricityCosts.find(c => c.id === id);
    const date = costItem ? costItem.date : '';

    // ПОДТВЕРЖДЕНИЕ УЖЕ БЫЛО, НО УТОЧНИМ ТЕКСТ
    if(confirm(`Удалить тариф от ${date}?`)){ 
        db.electricityCosts = db.electricityCosts.filter(c => c.id !== id);
        await dbRef.child('electricityCosts').set(db.electricityCosts);
        recalculateAllProductCosts();
        
        // ВАЖНО: При удалении тарифа нужно обновить себестоимость всех изделий (как в addElectricityCost)
        const updates = {};
        db.products.forEach((prod, idx) => {
            updates[`products/${idx}/costActualPrice`] = prod.costActualPrice;
            updates[`products/${idx}/costMarketPrice`] = prod.costMarketPrice;
            updates[`products/${idx}/costPer1Actual`] = prod.costPer1Actual;
            updates[`products/${idx}/costPer1Market`] = prod.costPer1Market;
        });
        if(Object.keys(updates).length > 0) await dbRef.update(updates);

        updateAllSelects(); 
        updateProductsTable(); 
    } 
}



// --- SORTING HELPERS ---
async function moveReferenceItemUp(arrayName, index) {
    if (index === 0) return; 
    const arr = db[arrayName];
    [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]]; // Swap local
    
    // Перезаписываем весь массив в Firebase, так как порядок изменился
    await dbRef.child(arrayName).set(arr);
    updateAllSelects(); 
}

async function moveReferenceItemDown(arrayName, index) {
    const arr = db[arrayName];
    if (index >= arr.length - 1) return;
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]; // Swap local
    
    await dbRef.child(arrayName).set(arr);
    updateAllSelects(); 
}


async function recalculateFilamentUsage() {
    if (!confirm('Пересчитать реальный расход филамента по всем существующим изделиям?\n\nЭто обнулит текущие счетчики расхода у катушек и заново просуммирует вес и длину всех изделий в базе.')) {
        return;
    }

    // 1. Сбрасываем счетчики у всех катушек локально
    db.filaments.forEach(f => {
        f.usedLength = 0;
        f.usedWeight = 0;
    });

    // 2. Проходим по всем изделиям и суммируем расход локально
    db.products.forEach(p => {
        // Пропускаем папки
        if (p.type === 'Составное') return; 
        
        // 1. Если само изделие - черновик, пропускаем
        if (p.isDraft) return;

        // 2. Если это Часть составного, проверяем его Родителя
        if (p.type === 'Часть составного' && p.parentId) {
            const parent = db.products.find(par => par.id === p.parentId);
            // Если родитель черновик, то и часть не учитываем
            if (parent && parent.isDraft) return;
        }

        if (p.filament && p.filament.id) {
            const filamentInDb = db.filaments.find(f => f.id === p.filament.id);
            if (filamentInDb) {
                filamentInDb.usedLength += (p.length || 0);
                filamentInDb.usedWeight += (p.weight || 0);
            }
        }
    });

    // 3. Обновляем остаток локально
    db.filaments.forEach(f => {
        f.remainingLength = Math.max(0, f.length - (f.usedLength || 0));
        // Логика смены статуса (опционально, если хотите авто-смену статуса)
        // if (f.remainingLength > 0) f.availability = 'В наличии';
    });

    // 4. === АТОМАРНОЕ СОХРАНЕНИЕ ===
    // Вместо saveData() формируем пакет обновлений только для полей расхода
    const updates = {};
    
    db.filaments.forEach((f, index) => {
        updates[`filaments/${index}/usedLength`] = f.usedLength;
        updates[`filaments/${index}/usedWeight`] = f.usedWeight;
        updates[`filaments/${index}/remainingLength`] = f.remainingLength;
    });

    try {
        if (Object.keys(updates).length > 0) {
            await dbRef.update(updates);
        }
        
        updateFilamentsTable();
        updateDashboard(); 
        showToast('Пересчет успешно выполнен!', 'success');
    } catch (e) {
        console.error("Ошибка пересчета:", e);
        showToast("Не удалось сохранить результаты пересчета: " + e.message, "error");
    }
}


// ==================== SERVICE EXPENSES LOGIC ====================

function openServiceModal(id = null) {
    isModalOpen = true;
    const modal = document.getElementById('serviceModal');
    modal.classList.add('active');
    document.getElementById('serviceValidationMessage').classList.add('hidden');
    
    // Сброс красной обводки
    const inputs = modal.querySelectorAll('input, textarea');
    inputs.forEach(el => el.style.border = '');

    updateServiceDatalist();

    if (id) {
        // Редактирование
        const item = db.serviceExpenses.find(x => x.id === id);
        if (item) {
            modal.setAttribute('data-edit-id', id);
            document.querySelector('#serviceModal .modal-header-title').textContent = 'Редактировать расход';
            
            document.getElementById('serviceDate').value = item.date;
            document.getElementById('serviceNameInput').value = item.name;
            document.getElementById('serviceQty').value = item.qty;
            document.getElementById('servicePrice').value = item.price;
            document.getElementById('serviceLink').value = item.link || ''; // Загружаем ссылку
            document.getElementById('serviceNote').value = item.note || '';
            
            calcServiceTotal();
        }
    } else {
        // Добавление
        modal.removeAttribute('data-edit-id');
        document.querySelector('#serviceModal .modal-header-title').textContent = 'Добавить сервисный расход';
        
        document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('serviceNameInput').value = '';
        document.getElementById('serviceQty').value = '1';
        document.getElementById('servicePrice').value = '';
        document.getElementById('serviceLink').value = ''; // Очищаем ссылку
        document.getElementById('serviceNote').value = '';
        
        document.getElementById('serviceTotalCalc').textContent = '0.00 ₽';
    }
}


function closeServiceModal() {
    isModalOpen = false;
    if(dbRef && dbRef.parent) dbRef.parent.once('value').then(window.updateAppFromSnapshot);
    document.getElementById('serviceModal').classList.remove('active');
}

function calcServiceTotal() {
    const qty = parseFloat(document.getElementById('serviceQty').value) || 0;
    const price = parseFloat(document.getElementById('servicePrice').value) || 0;
    document.getElementById('serviceTotalCalc').textContent = (qty * price).toFixed(2) + ' ₽';
}

function updateServiceDatalist() {
    const list = document.getElementById('serviceNamesDatalist');
    if (list) {
        list.innerHTML = db.serviceNames.map(s => `<option value="${escapeHtml(s.name)}">${s.price} ₽</option>`).join('');
    }
}

// При выборе из списка подставляем цену
window.onServiceNameChange = function(input) {
    const val = input.value;
    const found = db.serviceNames.find(s => s.name === val);
    if (found) {
        document.getElementById('servicePrice').value = found.price;
        calcServiceTotal();
    }
};

async function saveService() {
    const dateEl = document.getElementById('serviceDate');
    const nameEl = document.getElementById('serviceNameInput');
    const qtyEl = document.getElementById('serviceQty');
    const priceEl = document.getElementById('servicePrice');
    const linkEl = document.getElementById('serviceLink'); // Ссылка
    const noteEl = document.getElementById('serviceNote');

    const date = dateEl.value;
    const name = nameEl.value.trim();
    const qty = parseFloat(qtyEl.value);
    const price = parseFloat(priceEl.value);
    const link = linkEl.value.trim(); // Значение ссылки
    const note = noteEl.value.trim();
    const eid = document.getElementById('serviceModal').getAttribute('data-edit-id');

    // Валидация
    let isValid = true;
    const requiredFields = [dateEl, nameEl, qtyEl, priceEl];
    
    requiredFields.forEach(el => {
        el.style.border = ''; 
        if (!el.value || (el.type === 'number' && parseFloat(el.value) <= 0)) {
            el.style.border = '1px solid red';
            isValid = false;
        }
    });

    if (!isValid) {
        document.getElementById('serviceValidationMessage').classList.remove('hidden');
        return;
    } else {
        document.getElementById('serviceValidationMessage').classList.add('hidden');
    }

    const saveBtn = document.getElementById('saveServiceBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...';

    const item = {
        id: eid ? parseInt(eid) : Date.now(),
        date: date,
        name: name,
        qty: qty,
        price: price,
        total: qty * price,
        link: link, // Сохраняем в объект
        note: note
    };

    try {
        const updates = {};
        let index;
        if (eid) {
            const oldItem = db.serviceExpenses.find(x => x.id === item.id);
            index = db.serviceExpenses.indexOf(oldItem);
        } else {
            index = db.serviceExpenses.length;
        }
        
        updates[`serviceExpenses/${index}`] = item;

        // Обновляем справочник имен
        const existingNameIndex = db.serviceNames.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        if (existingNameIndex === -1) {
            const newIdx = db.serviceNames.length;
            const newRef = { name: name, price: price };
            updates[`serviceNames/${newIdx}`] = newRef; // Теперь без слэша в начале
            db.serviceNames.push(newRef);
        } else {
            if (Math.abs(db.serviceNames[existingNameIndex].price - price) > 0.01) {
                updates[`serviceNames/${existingNameIndex}/price`] = price; // Теперь без слэша в начале
                db.serviceNames[existingNameIndex].price = price;
            }
        }

        await dbRef.update(updates);

        if (eid) {
            const local = db.serviceExpenses.find(x => x.id === item.id);
            if(local) Object.assign(local, item);
        } else {
            db.serviceExpenses.push(item);
        }

        updateServiceTable();
        updateServiceNamesList();
        updateReports();
        closeServiceModal();

    } catch (e) {
        console.error(e);
        showToast('Ошибка сохранения: ' + e.message, 'error');
    } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Сохранить';
    }
}


function copyService(id) {
    const item = db.serviceExpenses.find(x => x.id === id);
    if (!item) return;

    openServiceModal(); 
    
    document.getElementById('serviceDate').value = new Date().toISOString().split('T')[0]; 
    document.getElementById('serviceNameInput').value = item.name;
    document.getElementById('serviceQty').value = item.qty;
    document.getElementById('servicePrice').value = item.price;
    document.getElementById('serviceLink').value = item.link || '';
    
    document.getElementById('serviceNote').value = ''; // <--- ИЗМЕНЕНО: Очистка комментария
    
    calcServiceTotal();
    document.querySelector('#serviceModal .modal-header-title').textContent = 'Копирование расхода';
}





async function deleteService(id) {
    if (!confirm('Удалить запись о расходе?')) return;
    const item = db.serviceExpenses.find(x => x.id === id);
    if (!item) return;
    const index = db.serviceExpenses.indexOf(item);
    
    try {
        await dbRef.child('serviceExpenses').child(index).remove();
        // Локально удаляем (через splice)
        db.serviceExpenses.splice(index, 1);
        updateServiceTable();
        updateReports();
    } catch (e) {
        showToast('Ошибка удаления: ' + e.message, 'error');
    }
}


function updateServiceTable() {
    const tbody = document.querySelector('#serviceTable tbody');
    if (!tbody) return;
    
    // 1. Динамическое обновление заголовков таблицы
    const theadRow = document.querySelector('#serviceTable thead tr');
    if (theadRow) {
        // Убедимся, что есть колонка "Примечание"
        if (!Array.from(theadRow.children).some(th => th.textContent === 'Примечание')) {
             const thNote = document.createElement('th');
             thNote.textContent = 'Примечание';
             theadRow.insertBefore(thNote, theadRow.lastElementChild); // Вставляем перед "Действия"
        }
        
        // Убедимся, что есть колонка для Ссылки (она идет после Примечания и перед Действиями)
        // Сейчас структура: [Дата, Имя, Кол, Цена, Итого, Примечание, Действия] = 7 колонок.
        // Нам нужно 8.
        if (theadRow.children.length < 8) {
             const thLink = document.createElement('th');
             thLink.textContent = ''; // Без названия
             thLink.style.width = '60px'; // Небольшая ширина
             theadRow.insertBefore(thLink, theadRow.lastElementChild);
        }
    }

    const search = document.getElementById('serviceSearch').value.toLowerCase();
    
    const filtered = db.serviceExpenses.filter(x => x.name.toLowerCase().includes(search));
    filtered.sort((a,b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = filtered.map(x => {
        // Формируем ссылку "Заказ", если она есть
        const linkHtml = x.link ? `<a href="${escapeHtml(x.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Заказ</a>` : '';

        return `
        <tr>
            <td>${x.date}</td>
            <td>${escapeHtml(x.name)}</td>
            <td>${x.qty}</td>
            <td>${x.price.toFixed(2)}</td>
            <td>${x.total.toFixed(2)}</td>
            <td style="max-width: 200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.note || '')}">${escapeHtml(x.note || '-')}</td>
            <td class="text-center">${linkHtml}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-secondary btn-small" title="Редактировать" onclick="openServiceModal(${x.id})">✎</button>
                    <button class="btn-secondary btn-small" title="Копировать" onclick="copyService(${x.id})">❐</button>
                    <button class="btn-danger btn-small" title="Удалить" onclick="deleteService(${x.id})">✕</button>
                </div>
            </td>
        </tr>
    `}).join('');
    
    toggleClearButton(document.getElementById('serviceSearch'));
}




// --- Справочник Сервисных работ ---
function updateServiceNamesList() {
    const list = document.getElementById('serviceNamesList');
    if (!list) return;
    const sorted = [...db.serviceNames].sort((a, b) => a.name.localeCompare(b.name));
    list.innerHTML = sorted.map((s, i) => `
        <div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
            <span>${escapeHtml(s.name)} — <strong>${s.price.toFixed(2)} ₽</strong></span>
            <div class="action-buttons">
                <button class="btn-secondary btn-small" onclick="editServiceName(${i})">✎</button>
                <button class="btn-danger btn-small" onclick="removeServiceName(${i})">✕</button>
            </div>
        </div>
    `).join('');
}

async function addServiceName() {
    const name = document.getElementById('newServiceName').value.trim();
    const price = parseFloat(document.getElementById('newServicePrice').value);
    if (name && !isNaN(price)) {
        const item = {name, price};
        db.serviceNames.push(item);
        
        // Перезаписываем весь массив, чтобы гарантировать целостность индексов
        await dbRef.child('serviceNames').set(db.serviceNames);
        
        document.getElementById('newServiceName').value='';
        document.getElementById('newServicePrice').value='';
        updateServiceNamesList();
    }
}


async function removeServiceName(i) {
    const sorted = [...db.serviceNames].sort((a, b) => a.name.localeCompare(b.name));
    const item = sorted[i];
    const realIdx = db.serviceNames.indexOf(item);
    
    // ДОБАВЛЕНО ПОДТВЕРЖДЕНИЕ
    if (!confirm(`Удалить вид работ "${item.name}"?`)) return;

    if (realIdx > -1) {
        db.serviceNames.splice(realIdx, 1);
        await dbRef.child('serviceNames').set(db.serviceNames);
        updateServiceNamesList();
    }
}

async function editServiceName(i) {
    const sorted = [...db.serviceNames].sort((a, b) => a.name.localeCompare(b.name));
    const item = sorted[i];
    const realIdx = db.serviceNames.indexOf(item);
    
    const newName = prompt("Название:", item.name);
    if(newName) {
        const newPrice = prompt("Цена:", item.price);
        if(newPrice && !isNaN(parseFloat(newPrice))) {
            const updates = {};
            updates[`serviceNames/${realIdx}/name`] = newName.trim();
            updates[`serviceNames/${realIdx}/price`] = parseFloat(newPrice);
            await dbRef.update(updates);
            // Local
            db.serviceNames[realIdx].name = newName.trim();
            db.serviceNames[realIdx].price = parseFloat(newPrice);
            updateServiceNamesList();
        }
    }
}


// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    loadFiltersFromStorage();
    const debouncedFilamentFilter = debounce(() => { saveFiltersToStorage(); filterFilaments(); }, APP_CONFIG.search.debounceMs);
    const debouncedProductFilter = debounce(() => { saveFiltersToStorage(); filterProducts(); }, APP_CONFIG.search.debounceMs);
    const debouncedWriteoffFilter = debounce(() => { saveFiltersToStorage(); updateWriteoffTable(); }, APP_CONFIG.search.debounceMs);

    // Nav
    document.querySelectorAll('.menu-item[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    document.getElementById('exportBtn')?.addEventListener('click', exportData);
    document.getElementById('importBtn')?.addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile')?.addEventListener('change', function() { importData(this); });
    
    // --- FILAMENT ---
    document.getElementById('addFilamentBtn')?.addEventListener('click', openFilamentModal);
    document.getElementById('saveFilamentBtn')?.addEventListener('click', saveFilament);
    document.getElementById('closeFilamentModalBtn')?.addEventListener('click', closeFilamentModal);
	document.getElementById('recalculateFilamentBtn')?.addEventListener('click', recalculateFilamentUsage);
    // Filters & Sort (search — debounce; select — immediate + save)
    document.getElementById('filamentSearch')?.addEventListener('input', debouncedFilamentFilter);
    document.getElementById('filamentSearch')?.nextElementSibling.addEventListener('click', () => clearSearch('filamentSearch', 'filterFilaments'));
    document.getElementById('filamentStatusFilter')?.addEventListener('change', () => { saveFiltersToStorage(); filterFilaments(); });
    document.getElementById('filamentSortBy')?.addEventListener('change', () => { saveFiltersToStorage(); updateFilamentsTable(); });
    document.getElementById('resetFilamentFiltersBtn')?.addEventListener('click', resetFilamentFilters);
    // Modal
    document.getElementById('filamentAvailability')?.addEventListener('change', updateFilamentStatusUI);
    document.getElementById('filamentColor')?.addEventListener('change', updateFilamentColorPreview);
    ['filamentActualPrice', 'filamentAvgPrice', 'filamentWeight', 'filamentLength'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('input', updatePriceTooltip);
            el.addEventListener('input', updateWeightTooltip);
        }
    });

    // --- PRODUCTS ---
    document.getElementById('addProductBtn')?.addEventListener('click', openProductModal);
    document.getElementById('saveProductBtn')?.addEventListener('click', () => saveProduct(false));
    document.getElementById('closeProductModalBtn')?.addEventListener('click', closeProductModal);
    document.getElementById('btnWriteOffProduct')?.addEventListener('click', initiateWriteOff);
	    // Делегирование событий для динамической таблицы изделий
    		
    // Filters & Sort (search — debounce; select — immediate + save)
    document.getElementById('productSearch')?.addEventListener('input', debouncedProductFilter);
    document.getElementById('productSearch')?.nextElementSibling.addEventListener('click', () => clearSearch('productSearch', 'filterProducts'));
    document.getElementById('productAvailabilityFilter')?.addEventListener('change', () => { saveFiltersToStorage(); filterProducts(); });
    document.getElementById('productSortBy')?.addEventListener('change', () => { saveFiltersToStorage(); filterProducts(); });
    document.getElementById('resetProductFiltersBtn')?.addEventListener('click', resetProductFilters);
    document.getElementById('showProductChildren')?.addEventListener('change', () => { saveFiltersToStorage(); filterProducts(); });
    // Modal
    document.getElementById('productType')?.addEventListener('change', updateProductTypeUI);
    document.getElementById('productParent')?.addEventListener('change', onParentProductChange);
    document.getElementById('productDefective')?.addEventListener('change', updateProductAvailability);
    document.getElementById('productFilament')?.addEventListener('change', () => {
        updateProductColorDisplay();
        updateProductCosts();
    });
    ['productQuantity', 'productPrintTimeHours', 'productPrintTimeMinutes', 'productWeight', 'productLength', 'productAllPartsCreated'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', updateProductCosts);
    });

    // --- WRITEOFFS ---
    document.getElementById('addWriteoffBtn')?.addEventListener('click', () => openWriteoffModal());
    document.getElementById('addProductPageWriteoffBtn')?.addEventListener('click', () => openWriteoffModal());
    document.getElementById('saveWriteoffBtn')?.addEventListener('click', saveWriteoff);
    document.getElementById('closeWriteoffModalBtn')?.addEventListener('click', closeWriteoffModal);
    document.getElementById('addWriteoffItemBtn')?.addEventListener('click', () => addWriteoffItemSection());
    document.getElementById('writeoffType')?.addEventListener('change', updateWriteoffTypeUI);
    // Filters & Sort
    document.getElementById('writeoffSearch')?.addEventListener('input', debouncedWriteoffFilter);
    document.getElementById('writeoffSearch')?.nextElementSibling.addEventListener('click', () => clearSearch('writeoffSearch', 'updateWriteoffTable'));
    document.getElementById('writeoffTypeFilter')?.addEventListener('change', () => { saveFiltersToStorage(); updateWriteoffTable(); });
    document.getElementById('writeoffSortBy')?.addEventListener('change', () => { saveFiltersToStorage(); updateWriteoffTable(); });
    document.getElementById('resetWriteoffFiltersBtn')?.addEventListener('click', () => {
        document.getElementById('writeoffSearch').value = '';
        document.getElementById('writeoffTypeFilter').value = '';
        document.getElementById('writeoffSortBy').value = 'systemId-desc';
        saveFiltersToStorage();
        updateWriteoffTable();
    });

    ['filamentSearch', 'productSearch', 'writeoffSearch'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            const clearBtn = input.nextElementSibling; // Это наш span.search-clear
            
            // Показ/скрытие крестика при вводе
            input.addEventListener('input', () => toggleClearButton(input));
            
            // Назначение функции фильтрации для каждого поля
            let filterFunc;
            if (id === 'filamentSearch') filterFunc = 'filterFilaments';
            else if (id === 'productSearch') filterFunc = 'filterProducts';
            else if (id === 'writeoffSearch') filterFunc = 'updateWriteoffTable';

            clearBtn.addEventListener('click', () => clearSearch(id, filterFunc));
        }
    });

    // --- REPORTS ---
    document.getElementById('generateReportBtn')?.addEventListener('click', updateFinancialReport);
    
    // --- REFERENCES ---
    document.getElementById('addBrandBtn')?.addEventListener('click', addBrand);
    document.getElementById('addColorBtn')?.addEventListener('click', addColor);
    document.getElementById('addFilamentTypeBtn')?.addEventListener('click', addFilamentType);
    // document.getElementById('addFilamentStatusBtn')?.addEventListener('click', addFilamentStatus);
    document.getElementById('addPrinterBtn')?.addEventListener('click', addPrinter);
    document.getElementById('addElectricityCostBtn')?.addEventListener('click', addElectricityCost);
	document.getElementById('addComponentBtn')?.addEventListener('click', addComponent);

    // --- FILES UI (Product Modal) ---
    document.querySelector('.image-upload-container')?.addEventListener('click', () => document.getElementById('productImageInput').click());
    document.getElementById('productImageInput')?.addEventListener('change', function() { handleImageUpload(this); });
    document.getElementById('btnDeleteImage')?.addEventListener('click', function(event) { event.stopPropagation(); removeProductImage(); });
    document.getElementById('btnAddFile')?.addEventListener('click', () => document.getElementById('productFileInput').click());
    document.getElementById('productFileInput')?.addEventListener('change', function() { handleFileUpload(this); });
	
	// Service (New)
    document.getElementById('addServiceBtn')?.addEventListener('click', () => openServiceModal());
    document.getElementById('saveServiceBtn')?.addEventListener('click', saveService);
    document.getElementById('closeServiceModalBtn')?.addEventListener('click', closeServiceModal);
    document.getElementById('serviceSearch')?.addEventListener('input', updateServiceTable);
    document.getElementById('serviceSearch')?.nextElementSibling.addEventListener('click', () => clearSearch('serviceSearch', 'updateServiceTable'));
    document.getElementById('addServiceNameBtn')?.addEventListener('click', addServiceName);
    
    // Обновляем обновление дат, чтобы захватить и serviceDate
    updateAllDates(); 

    // --- SIDEBAR TOGGLE ---
    const menuBtn = document.getElementById('menuToggle');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-closed');
            
            // Опционально: сохраняем состояние в памяти, чтобы при обновлении страницы меню оставалось закрытым
            const isClosed = document.body.classList.contains('sidebar-closed');
            localStorage.setItem('sidebarState', isClosed ? 'closed' : 'open');
        });
        
        // Восстановление состояния при загрузке (можно вынести отдельно в init)
        if (localStorage.getItem('sidebarState') === 'closed') {
            document.body.classList.add('sidebar-closed');
        }
    }

	    // === ГЛОБАЛЬНЫЕ ТУЛТИПЫ (фикс перекрытия таблицами) ===
        const globalTooltip = document.getElementById('globalTextTooltip');

        // Делегирование событий на весь документ
        document.addEventListener('mouseover', function(e) {
            // Ищем ближайший контейнер тултипа
            const target = e.target.closest('.tooltip-container');
            
            if (target) {
                // Ищем внутри него скрытый текст
                const textEl = target.querySelector('.tooltip-text:not(#globalTextTooltip)');
                if (textEl && globalTooltip) {
                    // Копируем текст в глобальный тултип
                    globalTooltip.innerHTML = textEl.innerHTML;
                    globalTooltip.style.display = 'block';
                }
            }
        });
    
        document.addEventListener('mousemove', function(e) {
            if (globalTooltip && globalTooltip.style.display === 'block') {
                // Размеры тултипа и окна
                const w = globalTooltip.offsetWidth;
                const h = globalTooltip.offsetHeight;
                const winW = window.innerWidth;
                const winH = window.innerHeight;
    
                // --- ГОРИЗОНТАЛЬ (X) ---
                // По умолчанию: чуть правее курсора
                let left = e.clientX + 12;
                
                // Если вылезает за правый край -> сдвигаем влево от курсора
                if (left + w > winW) {
                    left = e.clientX - w - 12;
                }
                
                // --- ВЕРТИКАЛЬ (Y) ---
                // По умолчанию: НАД курсором (сдвиг на высоту тултипа + отступ)
                let top = e.clientY - h - 12;
    
                // Если вылезает за ВЕРХНИЙ край (top < 0) -> показываем ПОД курсором
                if (top < 0) {
                    top = e.clientY + 20;
                }
    
                globalTooltip.style.left = left + 'px';
                globalTooltip.style.top = top + 'px';
            }
        });
    
    
        document.addEventListener('mouseout', function(e) {
            const target = e.target.closest('.tooltip-container');
            if (target && globalTooltip) {
                globalTooltip.style.display = 'none';
            }
        });
    
}


// === ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ДЛЯ КНОПКИ (+) ===
// Вешаем на document, чтобы ловить клики даже на динамических элементах
document.addEventListener('click', function(event) {
    // Ищем ближайший элемент с классом btn-add-part
    const target = event.target.closest('.btn-add-part');
    
    if (target) {
        // Останавливаем всплытие, чтобы не триггерить другие клики (если есть)
        event.preventDefault();
        event.stopPropagation();

        if (target.disabled) return;

        const productId = target.getAttribute('data-id');
        // console.log('Global click handler: (+)', productId);

        if (productId) {
            // Пытаемся вызвать функцию
            if (typeof window.addChildPart === 'function') {
                window.addChildPart(productId);
            } else {
                console.error('Function addChildPart not found!');
                showToast('Ошибка: функция addChildPart не найдена', 'error');
            }
        }
    }
});

// ==================== ONBOARDING TOUR (Driver.js 1.3 — рабочий вариант) ====================
function startOnboardingTour() {
    document.getElementById('helpModal').classList.remove('active');
    
    if (window.innerWidth < 900) {
        showToast("Для обучения рекомендуется использовать широкий экран.", "info");
        return;
    }

    // Driver.js 1.3.0 cdnjs IIFE: чаще всего window.driverJs.driver
    var driverFn = (typeof window.driverJs !== 'undefined' && typeof window.driverJs.driver === 'function') ? window.driverJs.driver
        : (typeof window.driver !== 'undefined' && window.driver && typeof window.driver.js !== 'undefined' && typeof window.driver.js.driver === 'function') ? window.driver.js.driver
        : (typeof window['driver.js'] !== 'undefined' && typeof window['driver.js'].driver === 'function') ? window['driver.js'].driver
        : (typeof window.driver === 'function') ? window.driver
        : null;
    if (!driverFn) {
        showToast('Тур обучения недоступен. Проверьте загрузку Driver.js.', 'error');
        return;
    }

    const saveTourCompleted = () => {
        var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
        if (uid) firebase.database().ref('users/' + uid + '/settings').update({ tourCompleted: true });
    };

    // API 1.x: первый шаг без element (модалка), остальные element + popover.side
    const steps = [
        { popover: { title: 'Добро пожаловать в 3D Manager! 👋', description: 'Это система полного учета вашей печати: от катушки до продажи.<br><br>Давайте быстро посмотрим, как тут всё устроено.' } },
        { element: '.sidebar', popover: { title: 'Главное меню', description: 'Здесь находятся все разделы. Меню можно свернуть, нажав на иконку "бургер" сверху.', side: 'right' } },
        { element: '[data-page="references"]', popover: { title: '1. С чего начать?', description: 'Зайдите в Справочники. Добавьте свои принтеры (мощность кВт) и тарифы на электричество - это важная составляющая для точного расчета себестоимости. По мере появления добавляйте новые бренды, типы и цвета филамента.', side: 'right' }, onHighlightStarted: function() { showPage('references'); } },
        { element: '[data-page="filament"]', popover: { title: '2. Склад филамента', description: 'Добавляйте свои катушки. Система будет учитывать расходуемые метры при каждом изготовлении изделия. Здесь у вас всегда актуальная информация об остатке пластика и вы будете знать достаточно ли его для нового изделия', side: 'right' }, onHighlightStarted: function() { showPage('filament'); } },
        { element: '#addFilamentBtn', popover: { title: 'Добавить катушку', description: 'Укажите наименование и цену покупки. Если пластик заканчивается, система подсветит его красным - пора планировать покупку.', side: 'bottom' } },
        { element: '[data-page="products"]', popover: { title: '3. Изделия', description: 'Здесь создаются карточки ваших товаров. Можно загрузить фото и файлы модели.', side: 'right' }, onHighlightStarted: function() { showPage('products'); } },
        { element: '#addProductBtn', popover: { title: 'Создать изделие', description: 'Выберите используемый пластик, расход материала и время печати. Себестоимость (с учетом затрат электричества) рассчитается мгновенно.', side: 'bottom' } },
        { element: '[data-page="writeoff"]', popover: { title: '4. Продажи и Списания', description: 'Оформляйте здесь продажи клиентам или списывайте использованные или бракованные изделия. Это формирует вашу финансовую историю.', side: 'right' }, onHighlightStarted: function() { showPage('writeoff'); } },
        { element: '#addWriteoffBtn', popover: { title: 'Оформить операцию', description: 'Выберите "Продажа", "Брак" или "Использовано".', side: 'bottom' } },
        { element: '[data-page="service"]', popover: { title: '5. Сервисные расходы', description: 'Учитывайте покупку расходных материалов - клей, смазка, сопла и т.д. Это сделает расчет чистой прибыли точным.', side: 'right' }, onHighlightStarted: function() { showPage('service'); } },
        { element: '#sidebarControls', popover: { title: 'Вы готовы! 🚀', description: 'Если что-то забудете — нажмите кнопку "Инструкция" внизу меню. Там есть шпаргалка и кнопка повтора этого обучения.', side: 'right' }, onHighlightStarted: function() { showPage('dashboard'); saveTourCompleted(); } }
    ];

    const driverObj = driverFn({
        showProgress: true,
        allowClose: true,
        animate: true,
        nextBtnText: 'Далее →',
        prevBtnText: '← Назад',
        doneBtnText: 'Завершить',
        steps: steps,
        onDestroyed: saveTourCompleted
    });
    driverObj.drive();
}

