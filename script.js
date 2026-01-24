console.log("Version: 4.6 (Restored Logic)");

// ==================== КОНФИГУРАЦИЯ ====================

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

const IMGBB_API_KEY = "326af327af6376b3b4d4e580dba10743";

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
const db = {
    filaments: [], products: [], writeoffs: [], brands: ['Prusament', 'MatterHackers', 'Prusament Pro'],
    colors: [ { id: 1, name: 'Белый', hex: '#ffffff' }, { id: 2, name: 'Чёрный', hex: '#000000' }, { id: 3, name: 'Красный', hex: '#ff0000' }, { id: 4, name: 'Синий', hex: '#0000ff' }, { id: 5, name: 'Зелёный', hex: '#00ff00' } ],
    plasticTypes: ['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'ASA', 'PC', 'PVA'],
    filamentStatuses: ['В наличии', 'Израсходовано'],
    printers: [ { id: 1, model: 'Creality Ender 3', power: 0.35 } ],
    electricityCosts: [{ id: 1, date: '2020-01-01', cost: 6 }]
};

let productSnapshotForDirtyCheck = '';
let currentProductImage = null; 
let currentProductFiles = [];   
let dbRef;
let activePreviewProductId = null;
let writeoffSectionCount = 0; // Для списаний

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

try {
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const auth = firebase.auth();
    dbRef = database.ref('filament_manager_data'); 
} catch (e) {
    console.error("Firebase init error:", e);
    alert("Ошибка подключения к сервисам Google!");
}

document.getElementById('loginBtn')?.addEventListener('click', () => {
    const email = document.getElementById('emailInput').value;
    const pass = document.getElementById('passwordInput').value;
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    btn.textContent = "Вход...";
    btn.disabled = true;
    err.style.display = 'none';

    firebase.auth().signInWithEmailAndPassword(email, pass)
        .catch((error) => {
            btn.textContent = "Войти";
            btn.disabled = false;
            err.textContent = "Ошибка: Неверный email или пароль";
            err.style.display = 'block';
        });
});

window.addEventListener('DOMContentLoaded', () => {
    firebase.auth().onAuthStateChanged(async (user) => {
        const overlay = document.getElementById('loginOverlay');
        
        if (user) {
            console.log("Logged in:", user.email);
            if(overlay) overlay.style.display = 'none'; 
            addLogoutButton();
            await loadData();
            
            recalculateAllProductCosts(); 
            loadShowChildren();
            updateAllDates();
            updateAllSelects();
            
            try { updateFilamentsTable(); } catch(e) {}
            try { updateProductsTable(); } catch(e) {}
            try { updateWriteoffTable(); } catch(e) {}
            try { updateReports(); } catch(e) {}
            try { updateDashboard(); } catch(e) {}

            setupEventListeners();
        } else {
            if(overlay) overlay.style.display = 'flex'; 
        }
    });
});

function addLogoutButton() {
    const sidebar = document.querySelector('.sidebar');
    if (document.getElementById('logoutBtn')) return; 
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.id = 'logoutBtn';
    btn.innerHTML = '🚪 Выйти';
    btn.style.marginTop = '20px';
    btn.style.borderTop = '1px solid rgba(255,255,255,0.1)';
    btn.onclick = () => { if(confirm('Выйти?')) firebase.auth().signOut().then(() => window.location.reload()); };
    const copyright = sidebar.lastElementChild;
    sidebar.insertBefore(btn, copyright);
}

// ==================== CLOUD & DATA ====================

async function uploadFileToCloud(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) {
        alert(`Файл "${file.name}" не картинка. ImgBB поддерживает только изображения.`);
        return null;
    }
    try {
        const formData = new FormData();
        formData.append("image", file);
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
        const data = await response.json();
        if (data.success) return data.data.url;
        else throw new Error(data.error?.message);
    } catch (error) {
        alert(`Ошибка загрузки: ${error.message}`);
        return null;
    }
}

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
    } catch (err) { alert('Ошибка синхронизации!'); }
}

// Алиас для совместимости с кодом из v3.7
function saveToLocalStorage() { saveData(); }

async function loadData() {
    if (!dbRef) return;
    try {
        const snapshot = await dbRef.once('value');
        const loadedData = snapshot.val();
        if (loadedData) {
            db.filaments = loadedData.filaments || [];
            db.products = loadedData.products || [];
            db.writeoffs = loadedData.writeoffs || [];
            db.brands = loadedData.brands || [];
            db.colors = loadedData.colors || [];
            db.plasticTypes = loadedData.plasticTypes || [];
            db.filamentStatuses = loadedData.filamentStatuses || [];
            db.printers = loadedData.printers || [];
            db.electricityCosts = loadedData.electricityCosts || [{ id: Date.now(), date: '2020-01-01', cost: 6 }];

            // Восстановление данных
            db.filaments.forEach(f => { f.remainingLength = f.length - (f.usedLength || 0); });
            db.products.forEach(p => {
                if (p.inStock === undefined) p.inStock = p.quantity;
                if (!p.status) p.status = p.availability || 'В наличии полностью';
            });
             // Пересчет ID списаний если они старого формата
             db.writeoffs.forEach(w => {
                if (!w.systemId) w.systemId = String(w.id);
            });
        } 
    } catch (err) { alert("Ошибка загрузки данных."); }
}

// ==================== HELPERS ====================

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
    if(typeof window[filterFunctionName] === 'function') window[filterFunctionName]();
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
    document.getElementById('filamentDate').value = today;
    document.getElementById('productDate').value = today;
    if(document.getElementById('writeoffDate')) document.getElementById('writeoffDate').value = today;
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

// === БЭКАП ФУНКЦИИ ===

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `3d_filament_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dl); dl.click(); dl.remove();
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = async (e) => {
        try {
            const loaded = JSON.parse(e.target.result);
            if (loaded.filaments && loaded.products) {
                if (confirm('Внимание! Текущие данные будут заменены. Продолжить?')) {
                    Object.assign(db, loaded);
                    await saveData();
                    alert('База восстановлена!');
                    window.location.reload();
                }
            } else {
                alert('Ошибка формата файла.');
            }
        } catch(err) { 
            alert('Ошибка чтения: ' + err); 
        }
    };
    r.readAsText(file);
    input.value = ''; 
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
    updateFilamentStatusList(); 
    updatePrintersList(); 
    updateElectricityCostList();
}

// ==================== DASHBOARD ====================

function updateDashboard() {
    const nameEvents = (id) => id ? `onmouseenter="showProductImagePreview(this, ${id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"` : '';

    const filamentsInStock = db.filaments.filter(f => f.availability === 'В наличии');
    document.getElementById('dashFilamentCount').textContent = filamentsInStock.length;
    
    const lowStock = filamentsInStock.filter(f => f.remainingLength < 50);
    const warning = document.getElementById('dashFilamentWarnings');
    if (lowStock.length > 0) {
        warning.innerHTML = lowStock.map(f => `<div class="warning-item"><span>⚠️</span><span>Филамента <b>${escapeHtml(f.customId)}</b> осталось всего <b>${f.remainingLength.toFixed(1)}</b> метров.</span></div>`).join('');
        warning.classList.remove('hidden');
    } else { warning.innerHTML = ''; warning.classList.add('hidden'); }

    const filamentsSorted = [...filamentsInStock].sort((a, b) => new Date(a.date) - new Date(b.date));
    document.querySelector('#dashFilamentTable tbody').innerHTML = filamentsSorted.map(f => {
        const rowClass = (f.remainingLength < 50) ? 'row-bg-danger' : '';
        return `<tr class="${rowClass}"><td><span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}</td><td>${f.date}</td><td>${escapeHtml(f.brand)}</td><td>${escapeHtml(f.type)}</td><td>${f.remainingLength.toFixed(1)}</td><td>${f.actualPrice.toFixed(2)} ₽</td></tr>`;
    }).join('');

    const indepProds = db.products.filter(p => p.type !== 'Часть составного');
    const stockProds = indepProds.filter(p => p.status === 'В наличии полностью' || p.status === 'В наличии частично');
    document.getElementById('dashProductCountRecord').textContent = stockProds.length;
    document.getElementById('dashProductCountStock').textContent = stockProds.reduce((sum, p) => sum + (p.inStock || 0), 0);

    const lastProds = [...indepProds].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    document.querySelector('#dashProductTable tbody').innerHTML = lastProds.map(p => {
        let badgeClass = 'badge-secondary', statusStyle = 'font-weight: 400;';
        if (p.status === 'В наличии полностью') { badgeClass = 'badge-light-green'; statusStyle = 'font-weight: 700;'; }
        else if (p.status === 'В наличии частично') { badgeClass = 'badge-success'; statusStyle = 'font-weight: 700;'; }
        else if (p.status === 'Брак') badgeClass = 'badge-danger'; 
        else if (p.status === 'Нет в наличии') badgeClass = 'badge-gray'; 
        
        let colorHtml = '—';
        if (p.filament) colorHtml = `<span class="color-swatch" style="background:${p.filament.color.hex}"></span>${escapeHtml(p.filament.color.name)}`;
        
        return `<tr><td ${nameEvents(p.id)}><strong>${escapeHtml(p.name)}</strong></td><td>${p.date}</td><td>${colorHtml}</td><td>${p.inStock}</td><td><span class="badge ${badgeClass}" style="${statusStyle}">${escapeHtml(p.status)}</span></td></tr>`;
    }).join('');

    const sales = db.writeoffs.filter(w => w.type === 'Продажа');
    document.getElementById('dashSoldCount').textContent = sales.reduce((sum, w) => sum + w.qty, 0);
    const lastSales = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    document.querySelector('#dashSalesTable tbody').innerHTML = lastSales.map(w => `<tr><td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td><td>${w.date}</td><td>${w.qty}</td><td>${w.price.toFixed(2)}</td><td>${w.total.toFixed(2)}</td><td><span class="badge badge-success">Продажа</span></td></tr>`).join('');

    const used = db.writeoffs.filter(w => w.type === 'Использовано');
    document.getElementById('dashUsedCount').textContent = used.reduce((sum, w) => sum + w.qty, 0);
    const lastUsed = [...used].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    document.querySelector('#dashUsedTable tbody').innerHTML = lastUsed.map(w => `<tr><td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td><td>${w.date}</td><td>${w.qty}</td><td>${escapeHtml(w.note || '')}</td><td><span class="badge badge-purple">Использовано</span></td></tr>`).join('');

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

function openFilamentModal() { document.getElementById('filamentModal').classList.add('active'); clearFilamentForm(); setTimeout(() => document.getElementById('filamentCustomId').focus(), 100); }
function closeFilamentModal() { document.getElementById('filamentModal').classList.remove('active'); document.getElementById('filamentModal').removeAttribute('data-edit-id'); document.querySelector('#filamentModal .modal-header-title').textContent = 'Добавить филамент'; clearFilamentForm(); }

function clearFilamentForm() {
    document.getElementById('filamentCustomId').value = ''; document.getElementById('filamentName').value = ''; document.getElementById('filamentLink').value = ''; document.getElementById('filamentType').value = 'PLA';
    document.getElementById('filamentAvgPrice').value = ''; document.getElementById('filamentActualPrice').value = ''; document.getElementById('filamentNote').value = '';
    document.getElementById('filamentBrand').value = '0'; document.getElementById('filamentColorPreview').style.background = '#ffffff'; document.getElementById('filamentAvailability').value = 'В наличии';
    document.getElementById('filamentWeight').value = '1000'; document.getElementById('filamentLength').value = '330'; document.getElementById('filamentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('filamentValidationMessage').classList.add('hidden'); document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
    document.querySelectorAll('#filamentModal input, #filamentModal select').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('#filamentModal input, #filamentModal select, #filamentModal textarea').forEach(el => el.disabled = false);
    updateFilamentCalcFields(); updateFilamentStatusUI();
}

function validateFilamentForm() {
    let valid = true;
    ['filamentCustomId','filamentDate','filamentName','filamentActualPrice','filamentAvgPrice','filamentWeight','filamentLength','filamentColor'].forEach(id => {
        const el = document.getElementById(id);
        if (!el.value || (el.type === 'number' && parseFloat(el.value) === 0)) { el.classList.add('error'); valid = false; } else el.classList.remove('error');
    });
    const cid = document.getElementById('filamentCustomId').value.trim(); const eid = document.getElementById('filamentModal').getAttribute('data-edit-id');
    if (valid && cid && db.filaments.some(f => f.customId === cid && (!eid || f.id != eid))) { document.getElementById('filamentCustomId').classList.add('error'); document.getElementById('filamentUniqueIdMessage').classList.remove('hidden'); valid = false; }
    else document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
    if (!valid && document.getElementById('filamentUniqueIdMessage').classList.contains('hidden')) document.getElementById('filamentValidationMessage').classList.remove('hidden');
    else document.getElementById('filamentValidationMessage').classList.add('hidden');
    return valid;
}

function saveFilament() {
    if (!validateFilamentForm()) return;
    const eid = document.getElementById('filamentModal').getAttribute('data-edit-id');
    const data = {
        customId: document.getElementById('filamentCustomId').value, brand: db.brands[document.getElementById('filamentBrand').value], type: document.getElementById('filamentType').value,
        color: db.colors.find(c => c.id == document.getElementById('filamentColor').value), name: document.getElementById('filamentName').value, link: document.getElementById('filamentLink').value.trim(),
        date: document.getElementById('filamentDate').value, avgPrice: parseFloat(document.getElementById('filamentAvgPrice').value) || 0, actualPrice: parseFloat(document.getElementById('filamentActualPrice').value) || 0,
        weight: parseFloat(document.getElementById('filamentWeight').value) || 1000, length: parseFloat(document.getElementById('filamentLength').value) || 330, note: document.getElementById('filamentNote').value, availability: document.getElementById('filamentAvailability').value
    };
    data.priceRatio = data.actualPrice / (data.avgPrice || 1); data.weightPerMeter = data.weight / data.length; data.avgCostPerGram = data.avgPrice / data.weight;
    data.avgCostPerMeter = data.avgPrice / data.length; data.actualCostPerGram = data.actualPrice / data.weight; data.actualCostPerMeter = data.actualPrice / data.length;
    
    if (eid) { const f = db.filaments.find(x => x.id == parseInt(eid)); if (f) { data.remainingLength = f.remainingLength; data.usedLength = f.usedLength; data.usedWeight = f.usedWeight; Object.assign(f, data); }
    } else { data.id = Date.now(); data.remainingLength = data.length; data.usedLength = 0; data.usedWeight = 0; db.filaments.push(data); }
    saveToLocalStorage(); updateAllSelects(); updateFilamentsTable(); updateDashboard(); closeFilamentModal();
}

function updateFilamentsTable() {
    const tbody = document.querySelector('#filamentsTable tbody');
    const sortBy = document.getElementById('filamentSortBy').value;
    const sorted = [...db.filaments].sort((a, b) => {
        if(sortBy === 'date-desc') return new Date(b.date) - new Date(a.date);
        if(sortBy === 'date-asc') return new Date(a.date) - new Date(b.date);
        return 0; 
    });
    tbody.innerHTML = sorted.map(f => {
        let rowClass = f.availability === 'Израсходовано' ? 'row-bg-gray' : (f.remainingLength < 50 ? 'row-bg-danger' : '');
        let remHtml = f.remainingLength.toFixed(1); if(f.availability === 'В наличии' && f.remainingLength < 50) remHtml = `<span class="badge badge-danger">${remHtml}</span>`;
        return `<tr class="${rowClass}"><td><strong>${escapeHtml(f.customId)}</strong></td><td>${f.date}</td><td><span class="badge ${f.availability === 'В наличии' ? 'badge-success' : 'badge-gray'}">${escapeHtml(f.availability)}</span></td><td><span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}</td><td>${escapeHtml(f.brand)}</td><td>${escapeHtml(f.type)}</td><td>${f.length.toFixed(1)}</td><td>${remHtml}</td><td>${(f.usedLength||0).toFixed(1)}</td><td>${(f.usedWeight||0).toFixed(1)}</td><td>${f.actualPrice.toFixed(2)}</td><td>${f.avgPrice.toFixed(2)}</td><td class="text-center">${f.link ? 'Link' : ''}</td><td class="text-center"><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilament(${f.id})">✎</button><button class="btn-secondary btn-small" onclick="copyFilament(${f.id})">❐</button><button class="btn-danger btn-small" onclick="deleteFilament(${f.id})">✕</button></div></td></tr>`;
    }).join('');
    filterFilaments();
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
function resetFilamentFilters() { document.getElementById('filamentSearch').value = ''; document.getElementById('filamentStatusFilter').value = ''; updateFilamentsTable(); }
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
    updateFilamentCalcFields(); updateFilamentStatusUI();
}
function copyFilament(id) { 
    editFilament(id); 
    document.getElementById('filamentModal').removeAttribute('data-edit-id'); 
    document.getElementById('filamentCustomId').value += ' (Копия)';
    document.getElementById('filamentAvailability').value = 'В наличии';
    document.querySelector('#filamentModal .modal-header-title').textContent = 'Копирование';
}
function deleteFilament(id) {
    if(confirm('Удалить?')) { db.filaments = db.filaments.filter(f => f.id !== id); saveToLocalStorage(); updateFilamentsTable(); updateDashboard(); }
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
    if (currentProductImage) {
        const src = (currentProductImage instanceof Blob) ? URL.createObjectURL(currentProductImage) : currentProductImage;
        preview.src = src; preview.style.display = 'block'; placeholder.style.display = 'none'; btnDelete.style.display = 'flex';
        if (currentProductImage instanceof Blob) preview.onload = () => URL.revokeObjectURL(src);
    } else {
        preview.src = ''; preview.style.display = 'none'; placeholder.style.display = 'block'; btnDelete.style.display = 'none';
    }
}
function handleImageUpload(input) { const file = input.files[0]; if(file) { currentProductImage = file; renderProductImage(); } }
function removeProductImage() { currentProductImage = null; renderProductImage(); }
function handleFileUpload(input) { const file = input.files[0]; if(file) { currentProductFiles.push({name:file.name, blob:file}); renderProductFiles(); } }
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

function updateProductCosts() {
    const type = document.getElementById('productType').value;
    const w = parseFloat(document.getElementById('productWeight').value) || 0;
    const l = parseFloat(document.getElementById('productLength').value) || 0;
    const qty = parseInt(document.getElementById('productQuantity').value) || 1;
    const printer = db.printers.find(p => p.id == document.getElementById('productPrinter').value);
    const time = (parseInt(document.getElementById('productPrintTimeHours').value) || 0) * 60 + (parseInt(document.getElementById('productPrintTimeMinutes').value) || 0);
    updateProductStockDisplay();

    let energy = 0, costMarket = 0, costActual = 0;
    const productDate = document.getElementById('productDate').value;
    const currentCostPerKw = getCostPerKwForDate(productDate);
    
    // Filament
    const f = db.filaments.find(x => x.id == document.getElementById('productFilament').value);

    if (type === 'Составное') {
        const eid = document.getElementById('productModal').getAttribute('data-edit-id');
        const kids = eid ? db.products.filter(p => p.parentId == parseInt(eid)) : [];
        kids.forEach(child => {
            if (child.printer && child.printer.power) {
                const costPerKw = getCostPerKwForDate(child.date);
                energy += (child.printTime / 60) * child.printer.power * costPerKw;
            }
            costMarket += child.costMarketPrice || 0;
            costActual += child.costActualPrice || 0;
        });
    } else { 
        if (printer) energy = (time / 60) * printer.power * currentCostPerKw;
        if (f) {
            const mkW = w * (f.avgCostPerGram || 0);
            const mkL = l * (f.avgCostPerMeter || 0);
            const acW = w * (f.actualCostPerGram || 0);
            const acL = l * (f.actualCostPerMeter || 0);
            costMarket = Math.max(mkW, mkL) + energy;
            costActual = Math.max(acW, acL) + energy;
            // Update fields
            document.getElementById('productFilamentCostByWeightCalc').textContent = mkW.toFixed(2);
            document.getElementById('productFilamentCostByLengthCalc').textContent = mkL.toFixed(2);
        } else {
            costMarket = energy; costActual = energy;
        }
    }
    
    document.getElementById('productEnergyCostCalc').textContent = energy.toFixed(2);
    document.getElementById('productCostMarketCalc').textContent = costMarket.toFixed(2);
    document.getElementById('productCostMarketPerUnitCalc').textContent = (qty > 0 ? costMarket / qty : 0).toFixed(2);
}

function updateParentSelect() {
    const avail = db.products.filter(p => p.type === 'Составное');
    document.getElementById('productParent').innerHTML = avail.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function openProductModal() {
    document.getElementById('productModal').classList.add('active');
    if(!document.getElementById('productModal').hasAttribute('data-edit-id')) {
        clearProductForm();
        const now = new Date(); 
        document.getElementById('productSystemId').textContent = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        updateProductTypeUI();
        updateProductFilamentSelect();
    }
}
function closeProductModal() { 
    document.getElementById('productModal').classList.remove('active'); 
    document.getElementById('productModal').removeAttribute('data-edit-id'); 
    clearProductForm(); 
}
function clearProductForm() {
    document.getElementById('productName').value = '';
    document.getElementById('productQuantity').value = 1;
    document.getElementById('productWeight').value = '';
    document.getElementById('productLength').value = '';
    document.getElementById('productPrintTimeHours').value = '';
    document.getElementById('productPrintTimeMinutes').value = '';
    document.getElementById('productType').value = 'Самостоятельное';
    document.getElementById('productDefective').checked = false;
    currentProductImage = null; currentProductFiles = []; renderProductImage(); renderProductFiles();
}

function updateProductTypeUI() {
    const type = document.getElementById('productType').value;
    const groups = { parent: document.getElementById('productParentGroup'), material: document.getElementById('materialSection'), children: document.getElementById('childrenTableGroup') };
    const inputs = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
    
    groups.parent.classList.add('hidden');
    groups.material.classList.remove('hidden');
    groups.children.classList.add('hidden');

    if (type === 'Составное') {
        groups.material.classList.add('hidden');
        groups.children.classList.remove('hidden');
        inputs.forEach(id => document.getElementById(id).disabled = true);
        updateChildrenTable();
        updateCompositeProductValues();
    } else if (type === 'Часть составного') {
        groups.parent.classList.remove('hidden');
        inputs.forEach(id => document.getElementById(id).disabled = false);
        updateParentSelect();
    } else {
        inputs.forEach(id => document.getElementById(id).disabled = false);
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

function copyProduct(id) {
    const p = db.products.find(x => x.id === id); if (!p) return;
    openProductModal();
    document.getElementById('productName').value = p.name + ' (Копия)';
    document.getElementById('productQuantity').value = p.quantity;
    document.getElementById('productWeight').value = p.weight;
    document.getElementById('productLength').value = p.length;
    document.getElementById('productPrintTimeHours').value = Math.floor(p.printTime/60);
    document.getElementById('productPrintTimeMinutes').value = p.printTime%60;
    if(p.printer) document.getElementById('productPrinter').value = p.printer.id;
    if(p.filament) document.getElementById('productFilament').value = p.filament.id;
    document.getElementById('productType').value = p.type;
    updateProductTypeUI();
}

function addChildPart(parentId) {
    openProductModal(); 
    document.getElementById('productType').value = 'Часть составного';
    updateProductTypeUI(); 
    document.getElementById('productParent').value = parentId;
    const parent = db.products.find(p => p.id == parentId);
    if (parent) document.getElementById('productQuantity').value = parent.quantity;
}

function editProduct(id) {
    const p = db.products.find(x => x.id === id); if (!p) return;
    openProductModal();
    document.getElementById('productModal').setAttribute('data-edit-id', id);
    document.getElementById('productSystemId').textContent = p.systemId || '-';
    
    document.getElementById('productName').value = p.name;
    document.getElementById('productDate').value = p.date;
    document.getElementById('productQuantity').value = p.quantity;
    document.getElementById('productWeight').value = p.weight;
    document.getElementById('productLength').value = p.length;
    document.getElementById('productPrintTimeHours').value = Math.floor((p.printTime||0)/60);
    document.getElementById('productPrintTimeMinutes').value = (p.printTime||0)%60;
    document.getElementById('productType').value = p.type;
    document.getElementById('productNote').value = p.note;
    document.getElementById('productDefective').checked = p.defective;
    if(p.printer) document.getElementById('productPrinter').value = p.printer.id;
    if(p.filament) document.getElementById('productFilament').value = p.filament.id;
    if(p.parentId) document.getElementById('productParent').value = p.parentId;
    
    currentProductImage = p.imageUrl || null;
    currentProductFiles = p.fileUrls || [];
    renderProductImage();
    renderProductFiles();
    updateProductTypeUI();
}

async function saveProduct(andThenWriteOff = false) {
    const saveBtn = document.getElementById('saveProductBtn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '⏳ Загрузка...'; saveBtn.disabled = true;
    
    // Uploads
    let imgUrl = currentProductImage;
    if(currentProductImage instanceof Blob) imgUrl = await uploadFileToCloud(currentProductImage);
    
    let files = [];
    for(let f of currentProductFiles) {
        if(f.url) files.push(f);
        else if(f.blob) { const u = await uploadFileToCloud(f.blob); if(u) files.push({name:f.name, url:u}); }
    }

    const modal = document.getElementById('productModal');
    const eid = modal.getAttribute('data-edit-id');
    const type = document.getElementById('productType').value;
    const qty = parseInt(document.getElementById('productQuantity').value)||1;
    const isDefective = document.getElementById('productDefective').checked;
    
    const p = {
        name: document.getElementById('productName').value,
        date: document.getElementById('productDate').value,
        type: type,
        quantity: qty,
        weight: parseFloat(document.getElementById('productWeight').value)||0,
        length: parseFloat(document.getElementById('productLength').value)||0,
        printTime: (parseInt(document.getElementById('productPrintTimeHours').value)||0)*60 + (parseInt(document.getElementById('productPrintTimeMinutes').value)||0),
        note: document.getElementById('productNote').value,
        defective: isDefective,
        imageUrl: imgUrl,
        fileUrls: files,
        systemId: eid ? document.getElementById('productSystemId').textContent : document.getElementById('productSystemId').textContent,
        printer: db.printers.find(p=>p.id == document.getElementById('productPrinter').value)
    };
    
    const filament = db.filaments.find(f=>f.id == document.getElementById('productFilament').value);
    if(filament) p.filament = filament;

    const writeoffs = db.writeoffs || [];
    const existingWriteoffs = (eid) ? writeoffs.filter(w => w.productId == eid).reduce((sum,w)=>sum+w.qty,0) : 0;
    p.inStock = isDefective ? 0 : Math.max(0, qty - existingWriteoffs);
    p.status = isDefective ? 'Брак' : (p.inStock > 0 ? (p.inStock < qty ? 'В наличии частично' : 'В наличии полностью') : 'Нет в наличии');

    if (type === 'Часть составного') p.parentId = parseInt(document.getElementById('productParent').value);
    
    // Cost Calculations (Restored logic)
    let energy = 0; 
    const costPerKw = getCostPerKwForDate(p.date);
    if(p.printer && p.printer.power) energy = (p.printTime/60) * p.printer.power * costPerKw;
    
    if (type === 'Составное') {
        const kids = eid ? db.products.filter(x => x.parentId === parseInt(eid)) : []; 
        p.costMarketPrice = kids.reduce((s,x)=>s+(x.costMarketPrice||0),0); 
        p.costActualPrice = kids.reduce((s,x)=>s+(x.costActualPrice||0),0); 
    } else if (filament) {
        const mkW = p.weight * (filament.avgCostPerGram || 0); 
        const mkL = p.length * (filament.avgCostPerMeter || 0); 
        const acW = p.weight * (filament.actualCostPerGram || 0); 
        const acL = p.length * (filament.actualCostPerMeter || 0); 
        p.costMarketPrice = Math.max(mkW, mkL) + energy; 
        p.costActualPrice = Math.max(acW, acL) + energy; 
    } else {
        p.costMarketPrice = energy; p.costActualPrice = energy;
    }
    p.costPer1Market = qty > 0 ? p.costMarketPrice / qty : 0; 
    p.costPer1Actual = qty > 0 ? p.costActualPrice / qty : 0;

    if(eid) {
        const idx = db.products.findIndex(x=>x.id==parseInt(eid));
        if(idx!==-1) {
             const old = db.products[idx];
             // Adjust filament stock if needed logic (simplified for web)
             Object.assign(old, p);
        }
    } else {
        p.id = Date.now();
        db.products.push(p);
    }
    
    await saveData();
    updateProductsTable(); updateDashboard(); 
    saveBtn.textContent = originalText; saveBtn.disabled = false;
    
    if (andThenWriteOff) {
        const pid = eid ? parseInt(eid) : p.id;
        closeProductModal();
        setTimeout(() => openWriteoffModalForProduct(pid), 150);
    } else {
        closeProductModal();
    }
}

function deleteProduct(id) {
    if (db.writeoffs.some(w => w.productId === id)) { alert('Нельзя удалить: есть списания.'); return; }
    if(confirm('Удалить изделие?')) {
        db.products = db.products.filter(p => p.id !== id && p.parentId !== id);
        saveToLocalStorage(); updateProductsTable(); updateDashboard();
    }
}

function buildProductRow(p, isChild) {
    let weight = p.weight, length = p.length, printTime = p.printTime;
    if (p.type === 'Составное') {
        const kids = db.products.filter(k => k.parentId === p.id);
        weight = kids.reduce((s,k) => s + (k.weight || 0), 0);
        length = kids.reduce((s,k) => s + (k.length || 0), 0);
        printTime = kids.reduce((s, k) => s + (k.printTime || 0), 0); 
    }
    const hours = Math.floor(printTime / 60);
    const minutes = printTime % 60;
    const formattedTime = `${hours}:${String(minutes).padStart(2, '0')}`;
    const icon = p.type === 'Составное' ? '📦' : (p.type === 'Часть составного' ? '↳' : '✓');
    
    let fil = '—';
    if (p.type !== 'Составное' && p.filament) {
        const fObj = (typeof p.filament === 'object') ? p.filament : db.filaments.find(f => f.id == p.filament);
        if(fObj && fObj.color) fil = `<span class="color-swatch" style="background:${fObj.color.hex}"></span>${escapeHtml(fObj.customId)}`;
    }
    const note = p.note ? `<span class="tooltip-container"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-right">${escapeHtml(p.note)}</span></span>` : '';
    let statusClass = 'badge-secondary';
    if (p.status === 'В наличии полностью') statusClass = 'badge-light-green';
    else if (p.status === 'В наличии частично') statusClass = 'badge-success';
    else if (p.status === 'Брак') statusClass = 'badge-danger';
    else if (p.status === 'Нет в наличии') statusClass = 'badge-gray';

    const statusHtml = `<span class="badge ${statusClass}">${escapeHtml(p.status)}</span>`;
    const costM = p.costPer1Market ? p.costPer1Market.toFixed(2) : '0.00';
    const costA = p.costPer1Actual ? p.costPer1Actual.toFixed(2) : '0.00';
    const fileIconHtml = (p.fileUrls && p.fileUrls.length > 0) ? '📎' : '';
    const linkHtml = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Модель</a>` : '';
    const nameEvents = `onmouseenter="showProductImagePreview(this, ${p.id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"`;
    
    let addPartButtonHtml = '';
    if (p.type === 'Составное') {
        addPartButtonHtml = `<button class="btn-secondary btn-small" title="Добавить часть изделия" onclick="addChildPart(${p.id})">+</button>`;
    }

    return `<tr class="${isChild ? 'product-child-row' : ''}">
        <td style="padding-left:12px;"><div class="product-name-cell ${isChild?'product-child-indent':''}"><div class="product-icon-wrapper"><strong>${icon}</strong></div><span ${nameEvents} style="cursor:default"><strong>${escapeHtml(p.name)}</strong></span>${note}</div></td>
        <td class="text-center">${fileIconHtml}</td>
        <td>${p.date}</td>
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
    document.querySelector('#childrenTable tbody').innerHTML = kids.map(k => `<tr><td>${k.name}</td><td>${k.quantity}</td><td>${k.weight}</td><td>${k.costActualPrice.toFixed(2)}</td></tr>`).join('');
}

function updateProductsTable() {
    const tbody = document.querySelector('#productsTable tbody');
    const term = document.getElementById('productSearch').value.toLowerCase();
    const filtered = db.products.filter(p => !p.parentId && p.name.toLowerCase().includes(term));
    const showChildren = document.getElementById('showProductChildren')?.checked;
    
    tbody.innerHTML = filtered.map(p => {
        let html = buildProductRow(p, false);
        if(showChildren) {
            db.products.filter(c => c.parentId == p.id).forEach(c => html += buildProductRow(c, true));
        }
        return html;
    }).join('');
}

function filterProducts() { updateProductsTable(); }
function resetProductFilters() { 
    document.getElementById('productSearch').value = ''; 
    document.getElementById('productAvailabilityFilter').value = '';
    updateProductsTable(); 
}

function showProductImagePreview(el, pid) {
    activePreviewProductId = pid;
    const p = db.products.find(x=>x.id==pid);
    if(!p || (!p.imageUrl && !p.imageBlob)) return;
    const img = document.getElementById('globalImageTooltipImg');
    const tip = document.getElementById('globalImageTooltip');
    const src = p.imageUrl || URL.createObjectURL(p.imageBlob);
    if(img.src !== src) {
        img.style.display = 'none';
        img.src = src;
        img.onload = () => { if(activePreviewProductId===pid) { img.style.display='block'; tip.style.display='block'; }};
    } else {
        if(activePreviewProductId===pid) { img.style.display='block'; tip.style.display='block'; }
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
    const def = document.getElementById('productDefective').checked;
    const statusField = document.getElementById('productAvailabilityField');
    const type = document.getElementById('productType').value;
    let statusText = def ? 'Брак' : 'В наличии полностью'; let statusClass = 'status-field-stocked';
    if (type === 'Часть составного') { statusText = def ? 'Брак' : 'Часть изделия'; statusClass = def ? 'status-field-defective' : 'status-field-part'; } else if (statusText === 'Брак') { statusClass = 'status-field-defective'; }
    statusField.textContent = statusText; statusField.className = 'calc-field ' + statusClass;
    updateProductStockDisplay();
}

function updateProductFilamentSelect() {
    const productModal = document.getElementById('productModal'); const editId = productModal.getAttribute('data-edit-id'); const currentProduct = editId ? db.products.find(p => p.id == parseInt(editId)) : null; const currentFilament = currentProduct?.filament; const filamentSelect = document.getElementById('productFilament'); if (!filamentSelect) return;
    const available = db.filaments.filter(f => f.availability === 'В наличии'); let options = []; if (!editId) options.push(`<option value="">-- Выберите филамент --</option>`);
    if (currentFilament && !available.find(f => f.id === currentFilament.id)) { const currentRemaining = Math.max(0, currentFilament.length - (currentFilament.usedLength||0)); options.push(`<option value="${currentFilament.id}">${escapeHtml(currentFilament.customId)} (ост. ${currentRemaining.toFixed(1)} м.) - текущий</option>`); }
    options.push(...available.map(f => { const remaining = Math.max(0, f.length - (f.usedLength||0)); return `<option value="${f.id}">${escapeHtml(f.customId)} (ост. ${remaining.toFixed(1)} м.)</option>`; })); filamentSelect.innerHTML = options.join(''); if (currentFilament) filamentSelect.value = currentFilament.id;
}

// ==================== WRITEOFFS (RESTORED LOGIC) ====================

function openWriteoffModal(systemId = null) {
    document.getElementById('writeoffModal').classList.add('active');
    document.getElementById('writeoffValidationMessage').classList.add('hidden');
    const isEdit = !!systemId;
    document.getElementById('writeoffModal').setAttribute('data-edit-group', isEdit ? systemId : '');
    
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
        addWriteoffItemSection(); 
    }
    updateWriteoffTypeUI();
}

function closeWriteoffModal() { document.getElementById('writeoffModal').classList.remove('active'); }

function updateWriteoffTypeUI() {
    const type = document.getElementById('writeoffType').value;
    const isSale = type === 'Продажа';
    document.getElementById('writeoffTotalSummary').classList.toggle('hidden', !isSale);
    document.querySelectorAll('.writeoff-item-section').forEach(sec => {
        const priceInput = sec.querySelector('.section-price');
        priceInput.disabled = !isSale;
        if (!isSale) priceInput.value = 0;
        const idx = sec.id.split('_')[1];
        updateWriteoffSection(idx);
    });
    calcWriteoffTotal();
    
    const el = document.getElementById('writeoffType');
    el.className = '';
    if (type === 'Продажа') el.classList.add('select-writeoff-sale');
    else if (type === 'Использовано') el.classList.add('select-writeoff-used');
    else if (type === 'Брак') el.classList.add('select-writeoff-defective');
}

function addWriteoffItemSection(data = null) {
    writeoffSectionCount++;
    const index = writeoffSectionCount;
    const container = document.getElementById('writeoffItemsContainer');
    const div = document.createElement('div');
    div.className = 'writeoff-item-section';
    div.id = `writeoffSection_${index}`;
    
    const availableProducts = db.products.filter(p => {
        const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
        const usedElsewhere = getWriteoffQuantityForProduct(p.id, editGroup);
        const currentStock = Math.max(0, p.quantity - usedElsewhere);
        const hasStock = currentStock > 0;
        const isSelected = data && data.productId === p.id;
        return (p.type !== 'Часть составного') && (isSelected || (!p.defective && hasStock)); 
    }).sort((a, b) => (b.systemId || '').localeCompare(a.systemId || ''));

    const options = availableProducts.map(p => {
        const isSelected = data && data.productId === p.id;
        return `<option value="${p.id}" ${isSelected?'selected':''}>${escapeHtml(p.name)} (${p.inStock} шт.)</option>`;
    }).join('');

    div.innerHTML = `
        <div class="writeoff-item-header"><span class="section-title">ИЗДЕЛИЕ ${index}</span><button class="btn-remove-section" onclick="removeWriteoffSection(${index})">✕</button></div>
        <div class="form-group"><label>Изделие:</label><select class="writeoff-product-select" onchange="updateWriteoffSection(${index})"><option value="">-- Выберите --</option>${options}</select></div>
        <div class="form-row-3">
            <div class="form-group"><label>Наличие:</label><div class="calc-field section-stock">0</div></div>
            <div class="form-group"><label>Списать (шт):</label><input type="number" class="section-qty" value="${data ? data.qty : ''}" min="1" oninput="updateWriteoffSection(${index})"></div>
            <div class="form-group"><label>Остаток:</label><div class="calc-field section-remaining">0</div></div>
        </div>
        <div class="form-row-3 writeoff-price-row">
            <div class="form-group"><label>Себест.:</label><div class="calc-field section-cost">0.00</div></div>
            <div class="form-group"><label>Цена (шт):</label><input type="number" class="section-price" value="${data ? data.price : ''}" step="0.01" oninput="updateWriteoffSection(${index})"></div>
            <div class="form-group"><label>Итого:</label><div class="calc-field section-total">0.00</div></div>
        </div>`;
    container.appendChild(div);
    updateWriteoffSection(index);
}

function removeWriteoffSection(index) {
    const el = document.getElementById(`writeoffSection_${index}`);
    if (el) el.remove();
    calcWriteoffTotal();
}

function updateWriteoffSection(index) {
    const section = document.getElementById(`writeoffSection_${index}`);
    if (!section) return;
    const pid = parseInt(section.querySelector('.writeoff-product-select').value);
    const qtyInput = section.querySelector('.section-qty');
    const priceInput = section.querySelector('.section-price');
    const product = db.products.find(p => p.id === pid);
    
    if (!product) { section.querySelector('.section-stock').textContent = '-'; return; }

    const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
    const usedElsewhere = getWriteoffQuantityForProduct(pid, editGroup);
    const currentStock = Math.max(0, product.quantity - usedElsewhere);
    section.querySelector('.section-stock').textContent = currentStock;
    
    const qty = parseInt(qtyInput.value) || 0;
    section.querySelector('.section-remaining').textContent = Math.max(0, currentStock - qty);
    
    section.querySelector('.section-cost').textContent = (product.costPer1Actual||0).toFixed(2);
    const price = parseFloat(priceInput.value) || 0;
    section.querySelector('.section-total').textContent = (price * qty).toFixed(2);
    calcWriteoffTotal();
}

function calcWriteoffTotal() {
    let totalSale = 0; let totalProfit = 0;
    document.querySelectorAll('.writeoff-item-section').forEach(sec => {
        const qty = parseInt(sec.querySelector('.section-qty').value) || 0;
        const price = parseFloat(sec.querySelector('.section-price').value) || 0;
        const pid = parseInt(sec.querySelector('.writeoff-product-select').value);
        const product = db.products.find(p => p.id === pid);
        const costA = product ? (product.costPer1Actual || 0) : 0;
        totalSale += (qty * price);
        totalProfit += (qty * price) - (qty * costA);
    });
    document.getElementById('writeoffTotalAmount').textContent = `${totalSale.toFixed(2)} ₽`;
    document.getElementById('writeoffTotalProfit').textContent = `${totalProfit.toFixed(2)} ₽`;
}

function saveWriteoff() {
    const systemId = document.getElementById('writeoffSystemId').textContent;
    const date = document.getElementById('writeoffDate').value;
    const type = document.getElementById('writeoffType').value;
    const note = document.getElementById('writeoffNote').value;
    const isEdit = !!document.getElementById('writeoffModal').getAttribute('data-edit-group');

    const sections = document.querySelectorAll('.writeoff-item-section');
    const newItems = [];
    
    // Проверка
    let valid = true;
    sections.forEach(sec => {
        const pid = sec.querySelector('.writeoff-product-select').value;
        const qty = parseInt(sec.querySelector('.section-qty').value);
        if(!pid || !qty || qty<=0) valid = false;
        else {
            const product = db.products.find(p => p.id == parseInt(pid));
            newItems.push({
                id: Date.now() + Math.random(), 
                systemId: systemId, date: date, productId: parseInt(pid), productName: product.name,
                type: type, qty: qty, price: parseFloat(sec.querySelector('.section-price').value)||0,
                total: qty * (parseFloat(sec.querySelector('.section-price').value)||0),
                note: note
            });
        }
    });

    if(!valid || newItems.length === 0) { alert('Заполните все поля!'); return; }

    // Возврат на склад старых
    if (isEdit) {
        const oldItems = db.writeoffs.filter(w => w.systemId === systemId);
        db.writeoffs = db.writeoffs.filter(w => w.systemId !== systemId);
        oldItems.forEach(old => {
            const p = db.products.find(x => x.id === old.productId);
            if(p) { p.inStock += old.qty; p.status = (p.inStock > 0 ? (p.inStock < p.quantity ? 'В наличии частично' : 'В наличии полностью') : 'Нет в наличии'); }
        });
    }

    // Списание новых
    newItems.forEach(item => {
        db.writeoffs.push(item);
        const p = db.products.find(x => x.id === item.productId);
        if(p) { 
            p.inStock -= item.qty; 
            p.status = (p.inStock > 0 ? (p.inStock < p.quantity ? 'В наличии частично' : 'В наличии полностью') : 'Нет в наличии');
        }
    });

    saveToLocalStorage();
    updateWriteoffTable(); updateProductsTable(); updateDashboard(); updateReports();
    closeWriteoffModal();
}

function deleteWriteoff(systemId) {
    if (!confirm('Удалить списание?')) return;
    const items = db.writeoffs.filter(w => w.systemId === systemId);
    items.forEach(item => {
        const p = db.products.find(x => x.id === item.productId);
        if(p) { p.inStock += item.qty; p.status = (p.inStock > 0 ? 'В наличии частично/полностью' : 'Нет в наличии'); } // Упрощенно
    });
    db.writeoffs = db.writeoffs.filter(w => w.systemId !== systemId);
    saveToLocalStorage(); updateWriteoffTable(); updateProductsTable(); updateDashboard();
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
    const sorted = [...db.writeoffs].sort((a,b) => b.systemId.localeCompare(a.systemId));
    // Группировка для отображения не нужна, так как таблица плоская, но для логики важно
    tbody.innerHTML = sorted.map(w => {
        return `<tr><td>${w.date}</td><td><small>${w.systemId}</small></td><td>${escapeHtml(w.productName)}</td><td>${w.type}</td><td>-</td><td>${w.qty}</td><td>${w.price.toFixed(2)}</td><td>${w.total.toFixed(2)}</td><td>${w.note}</td><td class="text-center"><button class="btn-secondary btn-small" onclick="editWriteoff('${w.systemId}')">✎</button><button class="btn-danger btn-small" onclick="deleteWriteoff('${w.systemId}')">✕</button></td></tr>`;
    }).join('');
}
function filterWriteoffs() { updateWriteoffTable(); } 
function resetWriteoffFilters() { updateWriteoffTable(); }

// ==================== REPORTS (FIXED LOGIC) ====================

function updateFinancialReport() {
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    if (!startInput || !endInput) return;

    const dStart = new Date(startInput.value);
    const dEnd = new Date(endInput.value);
    dEnd.setHours(23, 59, 59, 999); 

    const filamentsBought = db.filaments.filter(f => { const d = new Date(f.date); return d >= dStart && d <= dEnd; });
    const sumExpenses = filamentsBought.reduce((sum, f) => sum + (f.actualPrice || 0), 0);

    const writeoffsInRange = db.writeoffs.filter(w => { const d = new Date(w.date); return d >= dStart && d <= dEnd; });
    const sumRevenue = writeoffsInRange.filter(w => w.type === 'Продажа').reduce((sum, w) => sum + (w.total || 0), 0);

    let sumCOGS = 0; let sumCostUsedDefect = 0; 
    writeoffsInRange.forEach(w => {
        const product = db.products.find(p => p.id === w.productId);
        const costOne = product ? (product.costPer1Actual || 0) : 0;
        const totalCost = costOne * w.qty;
        if (w.type === 'Продажа') sumCOGS += totalCost;
        else sumCostUsedDefect += totalCost;
    });

    const defectiveProducts = db.products.filter(p => { const d = new Date(p.date); return p.defective === true && d >= dStart && d <= dEnd; });
    defectiveProducts.forEach(p => sumCostUsedDefect += (p.costActualPrice || 0));

    const tbody = document.querySelector('#financialTable tbody');
    if (!tbody) return;
    
    // Helper
    const row = (t, e, u, r, c, p) => `<tr><td>${t}</td><td>${e||''}</td><td>${u||''}</td><td>${r||''}</td><td>${c||''}</td><td>${p}</td><td></td><td></td></tr>`;
    
    const profit1 = -sumExpenses + sumRevenue;
    const profit4 = sumRevenue - sumCOGS - sumCostUsedDefect;

    tbody.innerHTML = 
        row('Cash Flow', sumExpenses.toFixed(2), null, sumRevenue.toFixed(2), null, profit1.toFixed(2)) +
        row('Чистая прибыль (Операционная)', null, sumCostUsedDefect.toFixed(2), sumRevenue.toFixed(2), sumCOGS.toFixed(2), profit4.toFixed(2));
}

function updateReports() { updateFinancialReport(); }


// ==================== REFERENCES UI ====================

function updateBrandsList(){ 
    const list = document.getElementById('brandsList');
    if(!list) return;
    list.innerHTML = db.brands.map((b,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>${escapeHtml(b)}</span><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editBrand(${i})">✎</button><button class="btn-danger btn-small" onclick="removeBrand(${i})">✕</button></div></div>`).join(''); 
}
function updateColorsList(){ 
    const list = document.getElementById('colorsList');
    if(!list) return;
    list.innerHTML = db.colors.map((c,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span><span class="color-swatch" style="background:${c.hex}"></span>${escapeHtml(c.name)}</span><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editColor(${c.id})">✎</button><button class="btn-danger btn-small" onclick="removeColor(${c.id})">✕</button></div></div>`).join(''); 
}
function updateFilamentTypeList(){ 
    const list = document.getElementById('filamentTypeList');
    if(!list) return;
    list.innerHTML = db.plasticTypes.map((t,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>${escapeHtml(t)}</span><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilamentType(${i})">✎</button><button class="btn-danger btn-small" onclick="removeFilamentType(${i})">✕</button></div></div>`).join(''); 
}
function updateFilamentStatusList(){ 
    const list = document.getElementById('filamentStatusList');
    if(!list) return;
    list.innerHTML = db.filamentStatuses.map((s,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>${escapeHtml(s)}</span><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilamentStatus(${i})">✎</button><button class="btn-danger btn-small" onclick="removeFilamentStatus(${i})">✕</button></div></div>`).join(''); 
}
function updatePrintersList(){ 
    const list = document.getElementById('printersList');
    if(!list) return;
    list.innerHTML = db.printers.map((p,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>${escapeHtml(p.model)} (${p.power}кВт)</span><div class="action-buttons"><button class="btn-secondary btn-small" onclick="editPrinter(${p.id})">✎</button><button class="btn-danger btn-small" onclick="removePrinter(${p.id})">✕</button></div></div>`).join(''); 
}
function updateElectricityCostList() {
    const listDiv = document.getElementById('electricityCostList'); 
    if (!listDiv) return; 
    const sorted = [...db.electricityCosts].sort((a, b) => new Date(b.date) - new Date(a.date));
    listDiv.innerHTML = sorted.map(c => `<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;"><span>С <strong>${escapeHtml(c.date)}</strong> — <strong>${c.cost} ₽/кВт</strong></span><div class="action-buttons"><button class="btn-danger btn-small" onclick="removeElectricityCost(${c.id})">✕</button></div></div>`).join('');
}

// Функции управления (Add/Remove/Edit)
function addBrand(){ const v=document.getElementById('newBrand').value.trim(); if(v && !db.brands.includes(v)){ db.brands.push(v); document.getElementById('newBrand').value=''; saveToLocalStorage(); updateAllSelects(); }}
function removeBrand(i){ const val = db.brands[i]; if(db.filaments.some(f => f.brand === val)) { alert('Нельзя удалить: используется.'); return; } db.brands.splice(i,1); saveToLocalStorage(); updateAllSelects(); }
function editBrand(i) { const newVal = prompt("Изменить:", db.brands[i]); if(newVal && newVal.trim()) { const oldVal = db.brands[i]; db.brands[i] = newVal.trim(); db.filaments.forEach(f => { if(f.brand === oldVal) f.brand = newVal.trim(); }); saveToLocalStorage(); updateAllSelects(); } }

function addColor(){ const n=document.getElementById('newColor').value.trim(); const h=document.getElementById('newColorCode').value; if(n){ db.colors.push({id:Date.now(),name:n,hex:h}); document.getElementById('newColor').value=''; saveToLocalStorage(); updateAllSelects(); }}
function removeColor(id){ if(db.filaments.some(f => f.color && f.color.id === id)) { alert('Нельзя удалить: используется.'); return; } db.colors=db.colors.filter(c=>c.id!==id); saveToLocalStorage(); updateAllSelects(); }
function editColor(id) { const c = db.colors.find(x => x.id === id); if(!c) return; const newName = prompt("Изменить:", c.name); if(newName && newName.trim()) { c.name = newName.trim(); saveToLocalStorage(); updateAllSelects(); } }

function addFilamentType(){ const v=document.getElementById('newFilamentType').value.trim(); if(v && !db.plasticTypes.includes(v)){ db.plasticTypes.push(v); document.getElementById('newFilamentType').value=''; saveToLocalStorage(); updateAllSelects(); }}
function removeFilamentType(i){ const val = db.plasticTypes[i]; if(db.filaments.some(f => f.type === val)) { alert('Нельзя удалить: используется.'); return; } db.plasticTypes.splice(i,1); saveToLocalStorage(); updateAllSelects(); }
function editFilamentType(i) { const newVal = prompt("Изменить:", db.plasticTypes[i]); if(newVal && newVal.trim()) { const oldVal = db.plasticTypes[i]; db.plasticTypes[i] = newVal.trim(); db.filaments.forEach(f => { if(f.type === oldVal) f.type = newVal.trim(); }); saveToLocalStorage(); updateAllSelects(); } }

function addFilamentStatus(){ const v=document.getElementById('newFilamentStatus').value.trim(); if(v && !db.filamentStatuses.includes(v)){ db.filamentStatuses.push(v); document.getElementById('newFilamentStatus').value=''; saveToLocalStorage(); updateAllSelects(); }}
function removeFilamentStatus(i){ const val = db.filamentStatuses[i]; if(db.filaments.some(f => f.availability === val)) { alert('Нельзя удалить: используется.'); return; } db.filamentStatuses.splice(i,1); saveToLocalStorage(); updateAllSelects(); }
function editFilamentStatus(i) { const newVal = prompt("Изменить:", db.filamentStatuses[i]); if(newVal && newVal.trim()) { const oldVal = db.filamentStatuses[i]; db.filamentStatuses[i] = newVal.trim(); db.filaments.forEach(f => { if(f.availability === oldVal) f.availability = newVal.trim(); }); saveToLocalStorage(); updateAllSelects(); } }

function addPrinter(){ const m=document.getElementById('newPrinterModel').value.trim(); const p=parseFloat(document.getElementById('newPrinterPower').value); if(m){ db.printers.push({id:Date.now(),model:m,power:p||0}); document.getElementById('newPrinterModel').value=''; saveToLocalStorage(); updateAllSelects(); }}
function removePrinter(id){ if(db.products.some(p => p.printer && p.printer.id === id)) { alert('Нельзя удалить: используется.'); return; } db.printers=db.printers.filter(p=>p.id!==id); saveToLocalStorage(); updateAllSelects(); }
function editPrinter(id) { const p = db.printers.find(x => x.id === id); if(!p) return; const newModel = prompt("Модель:", p.model); if(newModel && newModel.trim()) { const newPowerStr = prompt("Мощность (кВт):", p.power); const newPower = parseFloat(newPowerStr); p.model = newModel.trim(); if(!isNaN(newPower)) p.power = newPower; saveToLocalStorage(); updateAllSelects(); } }

function addElectricityCost() { const date = document.getElementById('newElectricityDate').value; const cost = parseFloat(document.getElementById('newElectricityCost').value); if (!date || isNaN(cost) || cost <= 0) { alert('Ошибка ввода.'); return; } if (db.electricityCosts.some(c => c.date === date)) { alert('Тариф на эту дату уже есть.'); return; } db.electricityCosts.push({ id: Date.now(), date: date, cost: cost }); document.getElementById('newElectricityDate').value=''; document.getElementById('newElectricityCost').value=''; recalculateAllProductCosts(); saveToLocalStorage(); updateAllSelects(); updateProductsTable(); }
function removeElectricityCost(id) { if (db.electricityCosts.length <= 1) { alert('Нельзя удалить последний тариф.'); return; } if(confirm('Удалить?')){ db.electricityCosts = db.electricityCosts.filter(c => c.id !== id); recalculateAllProductCosts(); saveToLocalStorage(); updateAllSelects(); updateProductsTable(); } }

function moveReferenceItemUp(arrayName, index) { if (index === 0) return; const arr = db[arrayName]; [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]]; saveToLocalStorage(); updateAllSelects(); }
function moveReferenceItemDown(arrayName, index) { const arr = db[arrayName]; if (index >= arr.length - 1) return; [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]; saveToLocalStorage(); updateAllSelects(); }

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Nav
    document.querySelectorAll('.menu-item[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    document.getElementById('exportBtn')?.addEventListener('click', exportData);
    document.getElementById('importFile')?.addEventListener('change', function() { importData(this); });
    
    // Filament
    document.getElementById('addFilamentBtn')?.addEventListener('click', openFilamentModal);
    document.getElementById('saveFilamentBtn')?.addEventListener('click', saveFilament);
    document.getElementById('closeFilamentModalBtn')?.addEventListener('click', closeFilamentModal);
    document.getElementById('filamentSearch')?.addEventListener('input', filterFilaments);
    
    // Products
    document.getElementById('addProductBtn')?.addEventListener('click', openProductModal);
    document.getElementById('saveProductBtn')?.addEventListener('click', () => saveProduct(false));
    document.getElementById('btnWriteOffProduct')?.addEventListener('click', () => saveProduct(true));
    document.getElementById('closeProductModalBtn')?.addEventListener('click', closeProductModal);
    document.getElementById('productSearch')?.addEventListener('input', filterProducts);
    document.getElementById('resetProductFiltersBtn')?.addEventListener('click', resetProductFilters);
    document.getElementById('productType')?.addEventListener('change', updateProductTypeUI);
    document.getElementById('productParent')?.addEventListener('change', onParentProductChange);
    
    // Writeoffs
    document.getElementById('writeoffSearch')?.addEventListener('input', filterWriteoffs);
    document.getElementById('writeoffTypeFilter')?.addEventListener('change', filterWriteoffs);
    document.getElementById('resetWriteoffFiltersBtn')?.addEventListener('click', resetWriteoffFilters);
    
    // Reports
    document.getElementById('generateReportBtn')?.addEventListener('click', updateFinancialReport);
    
    // Files UI
    document.querySelector('.image-upload-container')?.addEventListener('click', () => document.getElementById('productImageInput').click());
    document.getElementById('productImageInput')?.addEventListener('change', function() { handleImageUpload(this); });
    document.getElementById('btnAddFile')?.addEventListener('click', () => document.getElementById('productFileInput').click());
    document.getElementById('productFileInput')?.addEventListener('change', function() { handleFileUpload(this); });
}
