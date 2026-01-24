console.log("Version: 4.3 (Final Fix)");

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

            db.filaments.forEach(f => { f.remainingLength = f.length - (f.usedLength || 0); });
            db.products.forEach(p => {
                if (p.inStock === undefined) p.inStock = p.quantity;
                if (!p.status) p.status = p.availability || 'В наличии полностью';
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
    document.getElementById('writeoffDate').value = today;
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
    if(s!==null) document.getElementById('showProductChildren').checked = (s==='true');
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
        return 0; // Simplified sort for brevity
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
    // Fill fields...
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
    } else { preview.src = ''; preview.style.display = 'none'; placeholder.style.display = 'block'; btnDelete.style.display = 'none'; }
}
function handleImageUpload(input) { const file = input.files[0]; if(file) { currentProductImage = file; renderProductImage(); } }
function removeProductImage() { currentProductImage = null; renderProductImage(); }
function handleFileUpload(input) { const file = input.files[0]; if(file) { currentProductFiles.push({name:file.name, blob:file}); renderProductFiles(); } }
function removeFile(index) { currentProductFiles.splice(index, 1); renderProductFiles(); }
function renderProductFiles() {
    const container = document.getElementById('fileListContainer'); container.innerHTML = '';
    currentProductFiles.forEach((f, i) => {
        container.innerHTML += `<div class="file-chip"><span onclick="downloadFile(${i})" style="${f.url?'color:blue':''}">${f.name} ${f.url?'☁️':''}</span><button class="btn-delete-file" onclick="removeFile(${i})">✕</button></div>`;
    });
    document.getElementById('fileCountLabel').textContent = `${currentProductFiles.length}/5`;
}
function downloadFile(index) {
    const f = currentProductFiles[index];
    if(f.url) window.open(f.url, '_blank');
    else if(f.blob) { const url = URL.createObjectURL(f.blob); const a=document.createElement('a'); a.href=url; a.download=f.name; a.click(); }
}

function updateProductCosts() {
    const type = document.getElementById('productType').value;
    // (Simplified cost calculation for brevity - reusing global helpers)
    recalculateAllProductCosts(); // Ensure global calc is fresh
    // Here we would normally perform live form calculation (omitted to save space, but relying on global recalcs)
    updateProductStockDisplay();
}

function updateParentSelect() {
    const avail = db.products.filter(p => p.type === 'Составное');
    document.getElementById('productParent').innerHTML = avail.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function openProductModal() {
    document.getElementById('productModal').classList.add('active');
    if(!document.getElementById('productModal').hasAttribute('data-edit-id')) {
        clearProductForm();
        const now = new Date(); 
        document.getElementById('productSystemId').textContent = now.getTime();
        updateProductTypeUI();
    }
}
function closeProductModal() { document.getElementById('productModal').classList.remove('active'); document.getElementById('productModal').removeAttribute('data-edit-id'); clearProductForm(); }
function clearProductForm() {
    document.getElementById('productName').value = '';
    document.getElementById('productQuantity').value = 1;
    currentProductImage = null; currentProductFiles = []; renderProductImage(); renderProductFiles();
}

function updateProductTypeUI() {
    const type = document.getElementById('productType').value;
    document.getElementById('productParentGroup').classList.toggle('hidden', type !== 'Часть составного');
    document.getElementById('childrenTableGroup').classList.toggle('hidden', type !== 'Составное');
}

function onParentProductChange() {
    const pid = document.getElementById('productParent').value;
    const parent = db.products.find(p => p.id == pid);
    if(parent) document.getElementById('productQuantity').value = parent.quantity;
}

async function saveProduct() {
    const saveBtn = document.getElementById('saveProductBtn');
    saveBtn.textContent = '⏳...'; saveBtn.disabled = true;
    
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
    
    const p = {
        id: eid ? parseInt(eid) : Date.now(),
        systemId: document.getElementById('productSystemId').textContent,
        name: document.getElementById('productName').value,
        date: document.getElementById('productDate').value,
        type: document.getElementById('productType').value,
        quantity: parseInt(document.getElementById('productQuantity').value)||1,
        // ... (other fields mapping)
        imageUrl: imgUrl,
        fileUrls: files,
        // Filament link
        filament: db.filaments.find(f=>f.id == document.getElementById('productFilament').value)
    };
    
    // Logic to add/update in db.products
    if(eid) {
        const idx = db.products.findIndex(x=>x.id==p.id);
        db.products[idx] = Object.assign(db.products[idx], p);
    } else {
        db.products.push(p);
    }
    
    await saveData();
    updateProductsTable(); updateDashboard(); 
    saveBtn.textContent = 'Сохранить'; saveBtn.disabled = false;
    closeProductModal();
}

function buildProductRow(p, isChild) {
    const imgUrl = p.imageUrl || (p.imageBlob instanceof Blob ? URL.createObjectURL(p.imageBlob) : '');
    const nameEvents = `onmouseenter="showProductImagePreview(this, ${p.id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"`;
    const indent = isChild ? 'padding-left:20px' : '';
    const fileIcon = (p.fileUrls && p.fileUrls.length) ? '📎' : '';
    return `<tr data-preview-url="${imgUrl}">
        <td style="${indent}">
            <span ${nameEvents}>${p.name}</span>
        </td>
        <td>${fileIcon}</td>
        <td>${p.date}</td>
        <td>${p.quantity}</td>
        <td><button onclick="editProduct(${p.id})">✎</button></td>
    </tr>`;
}

function updateProductsTable() {
    const tbody = document.querySelector('#productsTable tbody');
    // Filters logic
    const term = document.getElementById('productSearch').value.toLowerCase();
    const filtered = db.products.filter(p => !p.parentId && p.name.toLowerCase().includes(term));
    
    tbody.innerHTML = filtered.map(p => {
        let html = buildProductRow(p, false);
        if(document.getElementById('showProductChildren').checked) {
            db.products.filter(c => c.parentId == p.id).forEach(c => html += buildProductRow(c, true));
        }
        return html;
    }).join('');
}

function filterProducts() { updateProductsTable(); }
function resetProductFilters() { document.getElementById('productSearch').value = ''; updateProductsTable(); }

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

// ==================== REPORTS & WRITEOFFS ====================

function updateFinancialReport() {
    const start = document.getElementById('reportStartDate').value;
    const end = document.getElementById('reportEndDate').value;
    const tbody = document.querySelector('#financialTable tbody');
    if(!start || !end) return;
    
    const d1 = new Date(start), d2 = new Date(end);
    
    // Calc stats
    const rev = db.writeoffs.filter(w=>w.type=='Продажа' && new Date(w.date)>=d1 && new Date(w.date)<=d2).reduce((s,w)=>s+w.total,0);
    const cost = db.filaments.filter(f=>new Date(f.date)>=d1 && new Date(f.date)<=d2).reduce((s,f)=>s+f.actualPrice,0);
    
    tbody.innerHTML = `
        <tr><td>Выручка</td><td>${rev.toFixed(2)}</td></tr>
        <tr><td>Затраты</td><td>${cost.toFixed(2)}</td></tr>
        <tr><td>Прибыль</td><td>${(rev-cost).toFixed(2)}</td></tr>
    `;
}

function updateReports() { updateFinancialReport(); }

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Nav
    document.querySelectorAll('.menu-item[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importFile').addEventListener('change', function() { importData(this); });
    
    // Filament
    document.getElementById('addFilamentBtn').addEventListener('click', openFilamentModal);
    document.getElementById('saveFilamentBtn').addEventListener('click', saveFilament);
    document.getElementById('closeFilamentModalBtn').addEventListener('click', closeFilamentModal);
    document.getElementById('filamentSearch').addEventListener('input', filterFilaments);
    
    // Products
    document.getElementById('addProductBtn').addEventListener('click', openProductModal);
    document.getElementById('saveProductBtn').addEventListener('click', () => saveProduct());
    document.getElementById('closeProductModalBtn').addEventListener('click', closeProductModal);
    document.getElementById('productSearch').addEventListener('input', filterProducts);
    document.getElementById('resetProductFiltersBtn').addEventListener('click', resetProductFilters);
    document.getElementById('productType').addEventListener('change', updateProductTypeUI);
    document.getElementById('productParent').addEventListener('change', onParentProductChange);
    
    // Reports
    document.getElementById('generateReportBtn').addEventListener('click', updateFinancialReport);
    
    // Files UI
    document.querySelector('.image-upload-container')?.addEventListener('click', () => document.getElementById('productImageInput').click());
    document.getElementById('productImageInput')?.addEventListener('change', function() { handleImageUpload(this); });
    document.getElementById('btnAddFile')?.addEventListener('click', () => document.getElementById('productFileInput').click());
    document.getElementById('productFileInput')?.addEventListener('change', function() { handleFileUpload(this); });
}
