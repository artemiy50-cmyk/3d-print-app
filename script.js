console.log("Version: 4.6 (Restored Logic9-55)");

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


// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
function updateFilamentsTable() {
    const tbody = document.querySelector('#filamentsTable tbody');
    const sortBy = document.getElementById('filamentSortBy').value;

    const sortedFilaments = [...db.filaments].sort((a, b) => {
        switch (sortBy) {
            case 'date-desc': return new Date(b.date) - new Date(a.date);
            case 'date-asc': return new Date(a.date) - new Date(b.date);
            default: return 0;
        }
    });

    tbody.innerHTML = sortedFilaments.map(f => {
        const badge = f.availability === 'В наличии' ? 'badge-success' : 'badge-gray';
        const note = f.note ? `<span class="tooltip-container" style="display:inline-flex; vertical-align:middle;"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-left" style="width:200px; white-space:normal; line-height:1.2;">${escapeHtml(f.note)}</span></span>` : '';
        const link = f.link ? `<a href="${escapeHtml(f.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Товар</a>` : '';
        
        let rowClass = '';
        if (f.availability === 'Израсходовано') rowClass = 'row-bg-gray';
        
        let remainingHtml = f.remainingLength.toFixed(1);
        if (f.availability === 'В наличии' && f.remainingLength < 50) {
            remainingHtml = `<span class="badge badge-danger">${remainingHtml}</span>`;
            rowClass = 'row-bg-danger';
        }

        return `<tr class="${rowClass}">
            <td><strong>${escapeHtml(f.customId)}</strong></td>
            <td>${f.date}</td>
            <td><span class="badge ${badge}">${escapeHtml(f.availability)}</span></td>
            <td><span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}</td>
            <td>${escapeHtml(f.brand)}</td>
            <td>${escapeHtml(f.type)}</td>
            <td>${f.length.toFixed(1)}</td>
            <td>${remainingHtml} ${note}</td>
            <td>${(f.usedLength||0).toFixed(1)}</td>
            <td>${(f.usedWeight||0).toFixed(1)}</td>
            <td>${f.actualPrice.toFixed(2)}</td>
            <td>${f.avgPrice.toFixed(2)}</td>
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


// ДОБАВИТЬ эти 2 функции
function captureProductSnapshot() {
    const type = document.getElementById('productType').value;
    const snapshot = {
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

// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
function clearProductForm() {
    const setVal = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    const setCheck = (id, v) => { const el = document.getElementById(id); if(el) el.checked = v; };
    
    setVal('productName', ''); 
    setVal('productLink', ''); 
    setVal('productQuantity', '1'); 
    setVal('productWeight', ''); 
    setVal('productLength', ''); 
    setVal('productPrintTimeHours', ''); 
    setVal('productPrintTimeMinutes', ''); 
    setVal('productNote', ''); 
    setCheck('productDefective', false);
    setVal('productFilament', ''); 
    setVal('productPrinter', db.printers.length > 0 ? db.printers[0].id : ''); 
    setVal('productDate', new Date().toISOString().split('T')[0]);
    
    // Сброс валидации
    const msg = document.getElementById('productValidationMessage');
    if(msg) msg.classList.add('hidden'); 
    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));
    
    // Сброс файлов
    currentProductImage = null; 
    currentProductFiles = []; 
    renderProductImage(); 
    renderProductFiles();

    // Сброс UI
    setVal('productType', 'Самостоятельное'); 
    updateProductTypeUI();
    updateProductColorDisplay();
    updateProductCosts();
}



// ЗАМЕНИТЕ эту функцию целиком
function updateProductTypeUI() {
    const type = document.getElementById('productType').value;
    const groups = { parent: document.getElementById('productParentGroup'), allParts: document.getElementById('productAllPartsCreatedContainer'), material: document.getElementById('materialSection'), children: document.getElementById('childrenTableGroup'), linkContainer: document.getElementById('productLinkFieldContainer'), fileSection: document.getElementById('fileUploadSection') };
    const inputs = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
    
    const costNote = document.getElementById('compositeCostNote');
    if(costNote) costNote.classList.toggle('hidden', type !== 'Составное');

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
    
    // ВОССТАНОВЛЕНА ЛОГИКА ОТОБРАЖЕНИЯ КНОПКИ "СПИСАТЬ"
    const btnWriteOff = document.getElementById('btnWriteOffProduct');
    if (btnWriteOff) {
        const isExistingProduct = !!document.getElementById('productModal').getAttribute('data-edit-id');
        if (isExistingProduct && type !== 'Часть составного') {
            btnWriteOff.style.display = 'flex';
        } else {
            btnWriteOff.style.display = 'none';
        }
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

// ЗАМЕНИТЬ эту функцию целиком
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

    document.getElementById('productValidationMessage').classList.add('hidden');
    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));

    const fieldsToFill = [ { id: 'productName', value: p.name }, { id: 'productLink', value: p.link || '' }, { id: 'productDate', value: p.date }, { id: 'productQuantity', value: p.quantity }, { id: 'productWeight', value: p.weight || '' }, { id: 'productLength', value: p.length || '' }, { id: 'productPrintTimeHours', value: Math.floor((p.printTime || 0) / 60) }, { id: 'productPrintTimeMinutes', value: (p.printTime || 0) % 60 }, { id: 'productNote', value: p.note || '' }, { id: 'productType', value: p.type || 'Самостоятельное' } ];
    fieldsToFill.forEach(field => {
        const el = document.getElementById(field.id);
        if (el) el.value = field.value;
    });

    currentProductImage = p.imageUrl || null; 
    currentProductFiles = p.fileUrls || []; 
    renderProductImage();
    renderProductFiles();
    
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
    }

    if (p.type === 'Составное') {
        const allPartsEl = document.getElementById('productAllPartsCreated');
        if(allPartsEl) allPartsEl.checked = p.allPartsCreated || false;
    }

    updateProductCosts();

    // ВОССТАНОВЛЕНА ЛОГИКА БЛОКИРОВКИ ПОЛЕЙ
    const allInputs = document.querySelectorAll('#productModal input, #productModal select, #productModal textarea');
    const validationMessage = document.getElementById('productValidationMessage');
    allInputs.forEach(el => el.disabled = false);

    let hasWriteoffs = db.writeoffs && db.writeoffs.some(w => w.productId === id);
    let lockReason = '';

    if (hasWriteoffs) {
        lockReason = 'Редактирование ограничено: есть списания.';
        allInputs.forEach(el => { if (el.id !== 'productNote') el.disabled = true; });
    } else if (p.defective) {
        lockReason = 'Редактирование ограничено: изделие в браке.';
        allInputs.forEach(el => { if (el.id !== 'productNote' && el.id !== 'productDefective') el.disabled = true; });
    }

    if(lockReason) {
        validationMessage.textContent = lockReason;
        validationMessage.classList.remove('hidden');
    }

    productSnapshotForDirtyCheck = captureProductSnapshot();
}


// ДОБАВЬТЕ ЭТУ ФУНКЦИЮ
function validateProductForm() {
    let valid = true;
    const t = document.getElementById('productType').value;
    const req = ['productDate', 'productQuantity', 'productName'];
    if (t !== 'Составное') {
        req.push('productFilament', 'productPrinter', 'productWeight', 'productLength');
    }
    if (t === 'Часть составного') {
        req.push('productParent');
    }

    document.getElementById('productValidationMessage').classList.add('hidden');
    document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));

    req.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value || (el.type === 'number' && parseFloat(el.value) === 0)) {
            el.classList.add('error');
            valid = false;
        }
    });

    if (t !== 'Составное') {
        const h = parseInt(document.getElementById('productPrintTimeHours').value) || 0;
        const m = parseInt(document.getElementById('productPrintTimeMinutes').value) || 0;
        if (h === 0 && m === 0) {
            document.getElementById('productPrintTimeHours').classList.add('error');
            document.getElementById('productPrintTimeMinutes').classList.add('error');
            valid = false;
        }
    }

    if (!valid) {
        document.getElementById('productValidationMessage').textContent = 'Не все обязательные поля заполнены';
        document.getElementById('productValidationMessage').classList.remove('hidden');
    }
    return valid;
}




// ЗАМЕНИТЬ эту функцию целиком
async function saveProduct(andThenWriteOff = false) {
    if (!validateProductForm()) return;

    const saveBtn = document.getElementById('saveProductBtn');
    saveBtn.textContent = '⏳ Сохраняю...'; saveBtn.disabled = true;

    const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
    const type = document.getElementById('productType').value; 
    
    // Сначала загружаем файлы в облако
    let imgUrl = currentProductImage;
    if(currentProductImage instanceof Blob) {
        imgUrl = await uploadFileToCloud(currentProductImage);
    }
    
    let fileUrls = [];
    for(let f of currentProductFiles) {
        if(f.url) fileUrls.push(f);
        else if(f.blob) { 
            const u = await uploadFileToCloud(f.blob); 
            if(u) fileUrls.push({name:f.name, url:u}); 
        }
    }
    
    // Теперь собираем объект для сохранения, как в v3.7
    const qty = parseInt(document.getElementById('productQuantity').value) || 0;
    const isDefective = document.getElementById('productDefective').checked;
    
    const p = { 
        name: document.getElementById('productName').value, 
        systemId: eid ? document.getElementById('productModal').getAttribute('data-system-id') : document.getElementById('productSystemId').textContent, 
        date: document.getElementById('productDate').value, 
        link: document.getElementById('productLink').value, 
        quantity: qty, 
        weight: parseFloat(document.getElementById('productWeight').value) || 0, 
        length: parseFloat(document.getElementById('productLength').value) || 0, 
        printTime: (parseInt(document.getElementById('productPrintTimeHours').value)||0)*60 + (parseInt(document.getElementById('productPrintTimeMinutes').value)||0), 
        printer: db.printers.find(x => x.id == document.getElementById('productPrinter').value), 
        type: type, 
        note: document.getElementById('productNote').value, 
        defective: isDefective,
        imageUrl: imgUrl,      // Используем URL из облака
        fileUrls: fileUrls,  // Используем URL-ы из облака
    };
    
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
        p.filament = filament; 
    }
    
    // Расчеты себестоимости
    recalculateAllProductCosts();
    const tempProdForCost = { ...p, costActualPrice: 0, costMarketPrice: 0 };
    const { costActualPrice, costMarketPrice } = calculateSingleProductCost(tempProdForCost);
    p.costActualPrice = costActualPrice;
    p.costMarketPrice = costMarketPrice;
    p.costPer1Actual = qty > 0 ? p.costActualPrice / qty : 0;
    p.costPer1Market = qty > 0 ? p.costMarketPrice / qty : 0;


    // Логика сохранения (добавление/обновление)
    if (eid) {
        const oldIndex = db.products.findIndex(x => x.id == parseInt(eid));
        if (oldIndex !== -1) {
            const old = db.products[oldIndex];
            if (old.filament && old.type !== 'Составное') { 
                const oldFil = db.filaments.find(f => f.id === old.filament.id);
                if(oldFil) {
                    oldFil.usedLength -= old.length || 0; 
                    oldFil.usedWeight -= old.weight || 0; 
                }
            }
            Object.assign(old, p);
            p.id = old.id;
        }
    } else {
        p.id = Date.now(); 
        db.products.push(p);
    }

    // Обновление расхода филамента
    if (filament && type !== 'Составное') { 
        const currentFil = db.filaments.find(f => f.id === filament.id);
        if (currentFil) {
            currentFil.usedLength += p.length; 
            currentFil.usedWeight += p.weight; 
        }
    }
    
    // Пересчет родителя, если это дочерний элемент
    if (type === 'Часть составного' && p.parentId) { 
        const parent = db.products.find(x => x.id === p.parentId); 
        if (parent) recalculateAllProductCosts(); // Пересчитываем всё для надежности
    }
    
    recalculateAllProductCosts();
    await saveData(); 
    
    updateAllSelects(); 
    updateProductsTable(); 
    updateDashboard(); 
    updateFilamentsTable(); 
    updateReports();
    
    saveBtn.textContent = 'Сохранить и закрыть'; saveBtn.disabled = false;
    
    if (andThenWriteOff) {
        const productIdToPass = p.id;
        closeProductModal();
        setTimeout(() => openWriteoffModalForProduct(productIdToPass), 150); 
    } else {
        closeProductModal();
    }
}

// Вспомогательная функция, которая должна быть где-то в коде
function determineProductStatus(p) { 
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


function deleteProduct(id) {
    const p = db.products.find(x => x.id === id); 
    if (!p) return;
    if (db.writeoffs && db.writeoffs.some(w => w.productId === id)) { 
        alert('Нельзя удалить изделие, по которому уже есть списания!'); 
        return; 
    }
    if (!confirm(`Удалить изделие "${p.name}" и вернуть филамент?`)) return;
    
    if (p.filament && p.type !== 'Составное') { 
        const dbFilament = db.filaments.find(f => f.id === p.filament.id);
        if (dbFilament) {
            dbFilament.usedLength -= p.length; 
            dbFilament.usedWeight -= p.weight; 
            dbFilament.remainingLength = Math.max(0, dbFilament.length - dbFilament.usedLength); 
            if (dbFilament.remainingLength > 0) dbFilament.availability = 'В наличии'; 
        }
    }
    
    if (p.type === 'Составное') { 
        const kids = db.products.filter(k => k.parentId === id); 
        kids.forEach(k => { 
            if (k.filament) { 
                const dbFilament = db.filaments.find(f => f.id === k.filament.id);
                if (dbFilament) {
                    dbFilament.usedLength -= k.length; 
                    dbFilament.usedWeight -= k.weight; 
                    dbFilament.remainingLength = Math.max(0, dbFilament.length - dbFilament.usedLength); 
                    if (dbFilament.remainingLength > 0) dbFilament.availability = 'В наличии'; 
                }
            } 
        }); 
        db.products = db.products.filter(x => x.parentId !== id && x.id !== id); 
    } else { 
        db.products = db.products.filter(x => x.id !== id); 
    }
    
    if (p.type === 'Часть составного' && p.parentId) { 
        const parent = db.products.find(x => x.id === p.parentId); 
        if (parent) { 
            recalculateAllProductCosts(); // Пересчитываем все для надежности
        } 
    }
    
    saveToLocalStorage(); 
    updateAllSelects(); 
    updateProductsTable(); 
    updateDashboard(); 
    updateReports(); 
    updateFilamentsTable();
}



// ЗАМЕНИТЬ эту функцию целиком
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

    // ВОССТАНОВЛЕНО: Логика иконки для собранных/несобранных
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
        // ВОССТАНОВЛЕНО: Тултип со списком списаний
        const productWriteoffs = db.writeoffs.filter(w => w.productId === p.id);
        if ((p.status === 'Нет в наличии' || p.status === 'В наличии частично') && productWriteoffs.length > 0) {
            const linksHtml = productWriteoffs
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .map(w => {
                    const plainType = `<strong>${escapeHtml(w.type)}</strong>`;
                    let linkText = w.type === 'Продажа' 
                        ? `${w.date} ${plainType}: ${w.qty} шт. х ${w.price.toFixed(2)} ₽ = ${w.total.toFixed(2)} ₽`
                        : `${w.date} ${plainType}: ${w.qty} шт.`;
                    return `<a onclick="editWriteoff('${w.systemId}')">${linkText}</a>`;
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

    // ВОССТАНОВЛЕНО: Логика кнопки "Добавить часть"
    let addPartButtonHtml = '';
    if (p.type === 'Составное') {
        const hasWriteoffs = db.writeoffs.some(w => w.productId === p.id);
        const isDisabled = hasWriteoffs || p.defective || p.allPartsCreated;
        addPartButtonHtml = `<button class="btn-secondary btn-small" title="Добавить часть изделия" onclick="addChildPart(${p.id})" ${isDisabled ? 'disabled' : ''}>+</button>`;
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



// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
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
        
        const btn = sec.querySelector('.btn-remove-section');
        btn.setAttribute('onclick', `removeWriteoffSection(${newIndex})`);
        
        sec.querySelector('.writeoff-product-select').setAttribute('onchange', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-qty').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-price').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
    });
}



function renumberWriteoffSections() {
    writeoffSectionCount = 0; // Reset counter
    const sections = document.querySelectorAll('.writeoff-item-section');
    sections.forEach((sec, i) => {
        writeoffSectionCount++;
        const newIndex = writeoffSectionCount;
        sec.id = `writeoffSection_${newIndex}`;
        sec.querySelector('.section-title').textContent = `ИЗДЕЛИЕ ${newIndex}`;
        
        const btn = sec.querySelector('.btn-remove-section');
        btn.setAttribute('onclick', `removeWriteoffSection(${newIndex})`);
        
        sec.querySelector('.writeoff-product-select').setAttribute('onchange', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-qty').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
        sec.querySelector('.section-price').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
    });
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
        const label = generateProductOptionLabel(p);
        return `<option value="${p.id}" ${isSelected?'selected':''}>${label}</option>`;
    }).join('');

    div.innerHTML = `
        <div class="writeoff-item-header">
            <span class="section-title">ИЗДЕЛИЕ ${index}</span>
            <button class="btn-remove-section" onclick="removeWriteoffSection(${index})">✕</button>
        </div>
        <div class="form-group">
            <label>Наименование изделия:</label>
            <select class="writeoff-product-select" onchange="updateWriteoffSection(${index})">
                <option value="">-- Выберите изделие --</option>
                ${options}
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
        <div class="form-row-3 writeoff-price-row">
            <div class="form-group">
                <label class="label-with-tooltip" style="justify-content:center;">
                    Рынок. себест. за 1 шт.
                    <span class="tooltip-container"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-center section-tooltip">Расчет с реальной стоимостью: -</span></span>
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
    
    updateRemoveButtons();
    updateWriteoffSection(index);
    
    const type = document.getElementById('writeoffType').value;
    div.querySelector('.section-price').disabled = (type !== 'Продажа');
}





function updateWriteoffSection(index) {
    const section = document.getElementById(`writeoffSection_${index}`);
    if (!section) return;

    const pid = parseInt(section.querySelector('.writeoff-product-select').value);
    const qtyInput = section.querySelector('.section-qty');
    const priceInput = section.querySelector('.section-price');
    
    const product = db.products.find(p => p.id === pid);
    
    if (!product) {
        section.querySelector('.section-stock').textContent = '-';
        section.querySelector('.section-remaining').textContent = '-';
        section.querySelector('.section-cost').textContent = '-';
        section.querySelector('.section-tooltip').textContent = 'Расчет с реальной стоимостью: -';
        return;
    }

    const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
    const usedElsewhere = getWriteoffQuantityForProduct(pid, editGroup);
    const currentStock = Math.max(0, product.quantity - usedElsewhere);
    
    section.querySelector('.section-stock').textContent = currentStock + ' шт.';
    
    const qty = parseInt(qtyInput.value) || 0;
    const remaining = Math.max(0, currentStock - qty); 
    section.querySelector('.section-remaining').textContent = remaining + ' шт.';
    
    const costM = product.costPer1Market || 0;
    const costA = product.costPer1Actual || 0;
    section.querySelector('.section-cost').textContent = costM.toFixed(2) + ' ₽';
    section.querySelector('.section-tooltip').textContent = `Расчет с реальной стоимостью: ${costA.toFixed(2)} ₽`;
    
    const price = parseFloat(priceInput.value) || 0;
    section.querySelector('.section-total').textContent = (price * qty).toFixed(2) + ' ₽';
    
    // Markup Calculation
    const type = document.getElementById('writeoffType').value;
    const markupContainer = section.querySelector('.markup-info');
	const profitContainer = section.querySelector('.profit-info');
    
    if (type === 'Продажа') {
        if (markupContainer) markupContainer.classList.remove('hidden');
		if (profitContainer) profitContainer.classList.remove('hidden');
        
        const markupM_money = price - costM;
        const markupM_percent = costM > 0 ? (markupM_money / costM) * 100 : 0;
        section.querySelector('.markup-market-val').textContent = `${markupM_money.toFixed(2)} ₽ (${markupM_percent.toFixed(1)}%)`;

        const markupA_money = price - costA;
        const markupA_percent = costA > 0 ? (markupA_money / costA) * 100 : 0;
        section.querySelector('.markup-actual-val').textContent = `${markupA_money.toFixed(2)} ₽ (${markupA_percent.toFixed(1)}%)`;
        
        section.querySelector('.markup-market-val').style.color = markupM_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';
        section.querySelector('.markup-actual-val').style.color = markupA_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';

        const itemProfit = (price * qty) - (costA * qty);
        const profitValSpan = section.querySelector('.profit-val');
        if (profitValSpan) {
            profitValSpan.textContent = `${itemProfit.toFixed(2)} ₽`;
            profitValSpan.style.color = itemProfit < 0 ? 'var(--color-danger)' : 'var(--color-success)';
        }

    } else {
        if (markupContainer) markupContainer.classList.add('hidden');
		if (profitContainer) profitContainer.classList.add('hidden');
    }
    
    calcWriteoffTotal();
}




function removeWriteoffSection(index) {
    const el = document.getElementById(`writeoffSection_${index}`);
    if (el) el.remove();
    renumberWriteoffSections();
    updateRemoveButtons();
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
    let totalSale = 0;
    let totalProfit = 0;
    
    document.querySelectorAll('.writeoff-item-section').forEach(sec => {
        const qty = parseInt(sec.querySelector('.section-qty').value) || 0;
        const price = parseFloat(sec.querySelector('.section-price').value) || 0;
        const pid = parseInt(sec.querySelector('.writeoff-product-select').value);
        const product = db.products.find(p => p.id === pid);
        const costA = product ? (product.costPer1Actual || 0) : 0;

        totalSale += (qty * price);
        totalProfit += (qty * price) - (qty * costA);
    });

    const amountSpan = document.getElementById('writeoffTotalAmount');
    const profitSpan = document.getElementById('writeoffTotalProfit');

    amountSpan.textContent = `${totalSale.toFixed(2)} ₽`;
    profitSpan.textContent = `${totalProfit.toFixed(2)} ₽`;
    profitSpan.style.color = totalProfit < 0 ? 'var(--color-danger)' : 'var(--color-success)';
}


// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
function saveWriteoff() {
    const systemId = document.getElementById('writeoffSystemId').textContent;
    const date = document.getElementById('writeoffDate').value;
    const type = document.getElementById('writeoffType').value;
    const note = document.getElementById('writeoffNote').value;
    const isEdit = !!document.getElementById('writeoffModal').getAttribute('data-edit-group');

    const sections = document.querySelectorAll('.writeoff-item-section');
    const newItems = [];
    let globalValid = true; 
    
    document.getElementById('writeoffValidationMessage').classList.add('hidden');
    document.getElementById('writeoffValidationMessage').textContent = 'Не все обязательные поля заполнены';
    
    sections.forEach(sec => {
        sec.querySelector('.writeoff-product-select').classList.remove('error');
        sec.querySelector('.section-qty').classList.remove('error');
        sec.querySelector('.section-price').classList.remove('error');
    });

    if (sections.length === 0) {
        globalValid = false;
    }
    
    const productUsageMap = {}; 

    for (let i = 0; i < sections.length; i++) {
        const sec = sections[i];
        let sectionValid = true;

        const pid = sec.querySelector('.writeoff-product-select').value;
        if (!pid) {
            sec.querySelector('.writeoff-product-select').classList.add('error');
            sectionValid = false;
        }
        
        const qtyInput = sec.querySelector('.section-qty');
        const qty = parseInt(qtyInput.value);
        
        if (!qty || qty <= 0) { 
            qtyInput.classList.add('error');
            sectionValid = false;
        }
        
        if (pid && qty > 0) {
            const product = db.products.find(p => p.id == parseInt(pid));
            if (!product) { 
                sectionValid = false; 
            } else {
                if (!productUsageMap[pid]) productUsageMap[pid] = 0;
                productUsageMap[pid] += qty;
                
                const editGroup = document.getElementById('writeoffModal').getAttribute('data-edit-group');
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
        if (type === 'Продажа') {
            const priceInput = sec.querySelector('.section-price');
            const priceVal = priceInput.value.trim(); 
            const priceNum = parseFloat(priceVal);
            
            if (priceVal === '' || isNaN(priceNum) || priceNum <= 0) { 
                priceInput.classList.add('error');
                sectionValid = false; 
            } else {
                price = priceNum;
            }
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
                hasDeductedParts: (product && product.type === 'Составное') 
            });
        } else {
            globalValid = false;
        }
    }

    if (!globalValid) {
        if(document.getElementById('writeoffValidationMessage').classList.contains('hidden')) {
             document.getElementById('writeoffValidationMessage').classList.remove('hidden');
        }
        return;
    }
    
    if (newItems.length === 0) { alert('Нет данных для сохранения'); return; }

    try {
        if (isEdit) {
            const oldItems = db.writeoffs.filter(w => w.systemId === systemId);
            db.writeoffs = db.writeoffs.filter(w => w.systemId !== systemId);
            oldItems.forEach(old => {
                const p = db.products.find(x => x.id === old.productId);
                if(p) { 
                    p.inStock += old.qty; 
                    p.status = determineProductStatus(p); 
                    p.availability = p.status; 
                }
            });
        }

        newItems.forEach(item => {
            db.writeoffs.push(item);
            const p = db.products.find(x => x.id === item.productId);
            if(p) { 
                p.inStock -= item.qty; 
                p.status = determineProductStatus(p); 
                p.availability = p.status; 
            }
        });

        saveToLocalStorage();
        updateWriteoffTable(); 
        updateProductsTable(); 
        updateDashboard(); 
        updateReports(); 
        
        closeWriteoffModal();
    } catch (e) {
        alert("Ошибка при сохранении: " + e.message);
        console.error(e);
    }
}



function deleteWriteoff(systemId) {
    if (!confirm('Удалить списание? Изделия будут возвращены на склад.')) return;
    
    const items = db.writeoffs.filter(w => w.systemId === systemId);
    
    items.forEach(item => {
        const p = db.products.find(x => x.id === item.productId);
        if(p) {
            p.inStock += item.qty;
            p.status = determineProductStatus(p); // Использование правильной функции
            p.availability = p.status;

            if (p.type === 'Составное' && item.hasDeductedParts === true) {
                const children = db.products.filter(child => child.parentId == p.id && !child.defective);
                const parentTotalQty = p.quantity || 1; 

                children.forEach(child => {
                    const ratio = (child.quantity || 1) / parentTotalQty;
                    child.inStock += (ratio * item.qty);
                    child.status = determineProductStatus(child);
                    child.availability = child.status;
                });
            }
        }
    });
    
    db.writeoffs = db.writeoffs.filter(w => w.systemId !== systemId);
    
    saveToLocalStorage();
    updateWriteoffTable();
    updateProductsTable();
    updateDashboard();
    updateReports();
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
    // Используем slice() для создания копии массива перед сортировкой
    const sorted = [...db.writeoffs].sort((a,b) => b.systemId.localeCompare(a.systemId));
    
    tbody.innerHTML = sorted.map(w => {
        let statusBadge = 'badge-secondary';
        if (w.type === 'Продажа') statusBadge = 'badge-success';
        else if (w.type === 'Использовано') statusBadge = 'badge-purple';
        else if (w.type === 'Брак') statusBadge = 'badge-danger';

        // Находим продукт для отображения себестоимости (как в эталоне)
        const product = db.products.find(p => p.id === w.productId);
        const actualCost = product ? (product.costPer1Actual || 0).toFixed(2) : '0.00';

        return `<tr>
            <td>${w.date}</td>
            <td><small>${w.systemId}</small></td>
            <td><strong>${escapeHtml(w.productName)}</strong></td>
            <td><span class="badge ${statusBadge}">${escapeHtml(w.type)}</span></td>
            <td>${actualCost} ₽</td>
            <td>${w.qty}</td>
            <td>${w.type === 'Продажа' ? w.price.toFixed(2) : '-'}</td>
            <td>${w.type === 'Продажа' ? w.total.toFixed(2) : '-'}</td>
            <td>${escapeHtml(w.note || '')}</td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn-secondary btn-small" title="Редактировать группу" onclick="editWriteoff('${w.systemId}')">✎</button>
                    <button class="btn-secondary btn-small" title="Копировать строку" onclick="copyWriteoffItem(${w.id})">❐</button>
                    <button class="btn-danger btn-small" title="Удалить группу" onclick="deleteWriteoff('${w.systemId}')">✕</button>
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
    document.getElementById('writeoffNote').value = item.note || '';
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

// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
function updateFinancialReport() {
    const dStart = new Date(document.getElementById('reportStartDate').value);
    const dEnd = new Date(document.getElementById('reportEndDate').value);
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
        else if (w.type === 'Использовано' || w.type === 'Брак') sumCostUsedDefect += totalCost;
    });
    const defectiveProducts = db.products.filter(p => { const d = new Date(p.date); return p.defective === true && d >= dStart && d <= dEnd; });
    defectiveProducts.forEach(p => sumCostUsedDefect += (p.costActualPrice || 0));

    const createRowHtml = (title, desc, expenses, costUsed, revenue, cogs, profit) => {
        const ros = revenue > 0 ? (profit / revenue) * 100 : 0;
        const markup = cogs > 0 ? (profit / cogs) * 100 : 0;
        const fmtMoney = (v) => v !== null ? v.toLocaleString('ru-RU', {style: 'currency', currency: 'RUB'}) : '';
        const fmt = (v) => v ? v.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
        const pColor = profit > 0 ? 'val-positive' : (profit < 0 ? 'val-negative' : 'val-neutral');

        return `
        <tr>
            <td style="text-align:left; padding: 12px 16px;">
                <div class="tooltip-container" style="display: inline-block; position: relative;">
                    <div class="report-row-title">${title}</div>
                    <span class="tooltip-text">${desc}</span>
                </div>
            </td>
            <td class="report-val val-neutral">${expenses !== null ? fmtMoney(expenses) : ''}</td>
            <td class="report-val val-neutral">${costUsed !== null ? fmtMoney(costUsed) : ''}</td>
            <td class="report-val val-neutral">${revenue !== null ? fmtMoney(revenue) : ''}</td>
            <td class="report-val val-neutral">${cogs !== null ? fmtMoney(cogs) : ''}</td>
            <td class="report-val ${pColor} col-profit">${fmtMoney(profit)}</td>
            <td class="report-val col-ros">${revenue !== null && cogs !== null ? fmt(ros) : ''}%</td>
            <td class="report-val col-markup">${cogs !== null ? fmt(markup) : ''}%</td>
        </tr>`;
    };

    const tbody = document.querySelector('#financialTable tbody');
    let html = '';
    const profit1 = -sumExpenses + sumRevenue;
    html += createRowHtml('Прибыль (Cash Flow)', '<b>Формула:</b><br>Выручка с продаж<br>− Затраты на покупку филамента (в этот период)<br><br>Сколько денег пришло минус сколько ушло на закупку.', sumExpenses, null, sumRevenue, null, profit1);
    const profit2 = -sumExpenses + sumRevenue + sumCostUsedDefect;
    html += createRowHtml('Прибыль (Скорректированная)', '<b>Формула:</b><br>Cash Flow + Себестоимость (Использовано для себя + Брак)<br><br>Показывает реальный результат, если бы вы не тратили пластик на себя.', sumExpenses, sumCostUsedDefect, sumRevenue, null, profit2);
    const profit3 = sumRevenue - sumCOGS;
    html += createRowHtml('Валовая прибыль (Торговая)', '<b>Формула:</b><br>Выручка с продаж<br>− Себестоимость проданных товаров<br><br>Эффективность именно продаж (без учета закупок на склад).', null, null, sumRevenue, sumCOGS, profit3);
    const profit4 = sumRevenue - sumCOGS - sumCostUsedDefect;
    html += createRowHtml('Чистая прибыль (Операционная)', '<b>Формула:</b><br>Валовая прибыль<br>− Убытки (Использовано + Брак)<br><br>Итоговый финансовый результат деятельности.', null, sumCostUsedDefect, sumRevenue, sumCOGS, profit4);

    tbody.innerHTML = html;
}


// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
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

// ЗАМЕНИТЕ ЭТУ ФУНКЦИЮ
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
    document.getElementById('filamentAvailability')?.addEventListener('change', updateFilamentStatusUI);
    document.getElementById('filamentColor')?.addEventListener('change', updateFilamentColorPreview);

    // Products
    document.getElementById('addProductBtn')?.addEventListener('click', openProductModal);
    document.getElementById('saveProductBtn')?.addEventListener('click', () => saveProduct(false));
    document.getElementById('closeProductModalBtn')?.addEventListener('click', closeProductModal);
    document.getElementById('productSearch')?.addEventListener('input', filterProducts);
    document.getElementById('resetProductFiltersBtn')?.addEventListener('click', resetProductFilters);
    document.getElementById('productType')?.addEventListener('change', updateProductTypeUI);
    document.getElementById('productParent')?.addEventListener('change', onParentProductChange);
    if(document.getElementById('showProductChildren')) {
        document.getElementById('showProductChildren').addEventListener('change', filterProducts);
    }
    document.getElementById('productDefective')?.addEventListener('change', updateProductAvailability);
    document.getElementById('productFilament')?.addEventListener('change', () => {
        updateProductColorDisplay();
        updateProductCosts();
    });

    // Writeoffs
    document.getElementById('addWriteoffBtn')?.addEventListener('click', () => openWriteoffModal());
    document.getElementById('addProductPageWriteoffBtn')?.addEventListener('click', () => openWriteoffModal());
    document.getElementById('saveWriteoffBtn')?.addEventListener('click', saveWriteoff);
    document.getElementById('closeWriteoffModalBtn')?.addEventListener('click', closeWriteoffModal);
    document.getElementById('addWriteoffItemBtn')?.addEventListener('click', () => addWriteoffItemSection());
    document.getElementById('writeoffType')?.addEventListener('change', updateWriteoffTypeUI);
    
    // Reports
    document.getElementById('generateReportBtn')?.addEventListener('click', updateFinancialReport);
    
    // Files UI
    document.querySelector('.image-upload-container')?.addEventListener('click', () => document.getElementById('productImageInput').click());
    document.getElementById('productImageInput')?.addEventListener('change', function() { handleImageUpload(this); });
    document.getElementById('btnDeleteImage')?.addEventListener('click', function(event) { event.stopPropagation(); removeProductImage(); });
    document.getElementById('btnAddFile')?.addEventListener('click', () => document.getElementById('productFileInput').click());
    document.getElementById('productFileInput')?.addEventListener('change', function() { handleFileUpload(this); });
}



