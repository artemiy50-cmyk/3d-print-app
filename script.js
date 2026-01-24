	    function getCostPerKwForDate(productDateStr) {
            if (!db.electricityCosts || db.electricityCosts.length === 0) return 6; // Fallback
            if (!productDateStr) productDateStr = '2020-01-01'; // Fallback for new products
            
            const productDate = new Date(productDateStr);

            const applicableTariffs = db.electricityCosts
                .filter(tariff => new Date(tariff.date) <= productDate)
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            if (applicableTariffs.length > 0) {
                return applicableTariffs[0].cost;
            }

            const oldestTariff = db.electricityCosts.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            return oldestTariff ? oldestTariff.cost : 6;
        }


        function recalculateAllProductCosts() {
            if (!db.products || db.products.length === 0) return;

            // Pass 1: Пересчет простых изделий
            db.products.forEach(p => {
                if (p.type === 'Самостоятельное' || p.type === 'Часть составного') {
                    const printer = p.printer;
                    
                    // FIX: Добавлена проверка (f && ...), чтобы не упало, если в массиве филаментов есть "дырки" (null)
                    const filament = (p.filament && db.filaments) 
                        ? db.filaments.find(f => f && f.id === p.filament.id) 
                        : null;
                        
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
                    } else {
                        p.costActualPrice = energy;
                        p.costMarketPrice = energy;
                    }
                    
                    // Защита от деления на 0
                    p.costPer1Actual = (p.quantity > 0) ? p.costActualPrice / p.quantity : 0;
                    p.costPer1Market = (p.quantity > 0) ? p.costMarketPrice / p.quantity : 0;
                }
            });

            // Pass 2: Пересчет составных изделий (сумма детей)
            db.products.forEach(p => {
                if (p.type === 'Составное') {
                    // Используем нестрогое сравнение (==) для ID на случай разницы типов (строка/число)
                    const children = db.products.filter(child => child.parentId == p.id);
                    
                    const totalActualCost = children.reduce((sum, child) => sum + (child.costActualPrice || 0), 0);
                    p.costActualPrice = totalActualCost;
                    p.costPer1Actual = (p.quantity > 0) ? p.costActualPrice / p.quantity : 0;

                    const totalMarketCost = children.reduce((sum, child) => sum + (child.costMarketPrice || 0), 0);
                    p.costMarketPrice = totalMarketCost;
                    p.costPer1Market = (p.quantity > 0) ? p.costMarketPrice / p.quantity : 0;
                }
            });
        }



	
        // ==================== SECURITY & HELPERS ====================
        function escapeHtml(text) {
            if (text === null || text === undefined) return '';
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return String(text).replace(/[&<>"']/g, m => map[m]);
        }

        function toggleClearButton(input) {
            const clearBtn = input.nextElementSibling;
            if (clearBtn) {
                clearBtn.style.display = input.value ? 'inline' : 'none';
            }
        }

        function clearSearch(inputId, filterFunctionName) {
            const input = document.getElementById(inputId);
            input.value = '';
            toggleClearButton(input);
            // Динамически вызываем нужную функцию фильтрации
            if(typeof window[filterFunctionName] === 'function') {
                window[filterFunctionName]();
            }
        }



        // ==================== DATA STORAGE ====================
        const db = {
            filaments: [], products: [], writeoffs: [], brands: ['Prusament', 'MatterHackers', 'Prusament Pro'],
            colors: [ { id: 1, name: 'Белый', hex: '#ffffff' }, { id: 2, name: 'Чёрный', hex: '#000000' }, { id: 3, name: 'Красный', hex: '#ff0000' }, { id: 4, name: 'Синий', hex: '#0000ff' }, { id: 5, name: 'Зелёный', hex: '#00ff00' } ],
            plasticTypes: ['PLA', 'ABS', 'PETG', 'TPU', 'Nylon', 'ASA', 'PC', 'PVA'],
            filamentStatuses: ['В наличии', 'Израсходовано'],
            printers: [ { id: 1, model: 'Creality Ender 3', power: 0.35 } ],
            electricityCosts: [{ id: 1, date: '2020-01-01', cost: 6 }]
        };

		let productSnapshotForDirtyCheck = '';


        // Временные хранилища для файлов текущего редактируемого изделия
        let currentProductImage = null; // Blob or null
        let currentProductFiles = [];   // Array of { name: string, blob: Blob }

        // --- Image Handling ---
        function handleImageUpload(input) {
            const file = input.files[0];
            if (!file) return;
            currentProductImage = file;
            renderProductImage();
            input.value = ''; // Reset
        }

        function removeProductImage() {
            currentProductImage = null;
            renderProductImage();
        }

        function renderProductImage() {
            const preview = document.getElementById('productImagePreview');
            const placeholder = document.getElementById('imagePlaceholder');
            const btnDelete = document.getElementById('btnDeleteImage');

            if (currentProductImage) {
                const url = URL.createObjectURL(currentProductImage);
                preview.src = url;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
                btnDelete.style.display = 'flex';
                // Clean up object URL when image loads to free memory
                preview.onload = () => URL.revokeObjectURL(url);
            } else {
                preview.src = '';
                preview.style.display = 'none';
                placeholder.style.display = 'block';
                btnDelete.style.display = 'none';
            }
        }

        // --- File Handling ---
		function handleFileUpload(input) {
            // Проверка лимита - макс 5 файлов (Изменено в v3.4)
            if (currentProductFiles.length >= 5) {
                alert('Максимум 5 файлов.');
                input.value = '';
                return;
            }
            
            const file = input.files[0];
            if (!file) return;
            
            if (currentProductFiles.some(f => f.name === file.name)) {
                alert('Файл с таким именем уже добавлен.');
                input.value = '';
                return;
            }
            
            currentProductFiles.push({ name: file.name, blob: file });
            renderProductFiles();
            input.value = '';
        }


        function removeFile(index) {
            currentProductFiles.splice(index, 1);
            renderProductFiles();
        }

        function downloadFile(index) {
            const fileData = currentProductFiles[index];
            if (!fileData) return;
            
            const url = URL.createObjectURL(fileData.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileData.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        }

		function renderProductFiles() {
            const container = document.getElementById('fileListContainer');
            const btnAdd = document.getElementById('btnAddFile');
            const countLabel = document.getElementById('fileCountLabel');
            container.innerHTML = '';

            currentProductFiles.forEach((f, index) => {
                const div = document.createElement('div');
                div.className = 'file-chip';
                let displayName = f.name; // CSS handles truncation
                div.innerHTML = `
                    <span onclick="downloadFile(${index})" title="${escapeHtml(f.name)}">${escapeHtml(displayName)}</span>
                    <button class="btn-delete-file" onclick="removeFile(${index})">✕</button>
                `;
                container.appendChild(div);
            });

            if (countLabel) countLabel.textContent = `${currentProductFiles.length} / 5`;

            if (currentProductFiles.length >= 5) {
                btnAdd.disabled = true;
                btnAdd.style.opacity = '0.5';
                btnAdd.style.cursor = 'not-allowed';
            } else {
                btnAdd.disabled = false;
                btnAdd.style.opacity = '1';
                btnAdd.style.cursor = 'pointer';
            }
        }




        // ==================== INITIALIZATION ====================
        window.addEventListener('DOMContentLoaded', initializeApp);


        async function initializeApp() {
			try {
                // Ждем загрузки данных из IndexedDB
                await loadData();
                
                // После загрузки выполняем все расчеты и рендер
                recalculateAllProductCosts(); 
                loadShowChildren();
                updateAllDates();
                updateAllSelects();
                
                // Рендеринг и сортировка
                try {
                    updateFilamentsTable();
                } catch(e) { console.warn('Filament render issue', e); }

                try { updateProductsTable(); } catch(e) { console.warn('Product render issue', e); }
                try { updateWriteoffTable(); } catch(e) { console.warn('Writeoff render issue', e); }
                try { updateReports(); } catch(e) { console.warn('Reports render issue', e); }
                try { updateDashboard(); } catch(e) { console.warn('Dashboard render issue', e); }
				
				setupEventListeners();
                
            } catch (e) {
                console.error("Critical initialization error:", e);
                alert("Ошибка инициализации приложения. Данные могут отображаться некорректно.");
            }
        }



        function updateAllDates() {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('filamentDate').value = today;
            document.getElementById('productDate').value = today;
            document.getElementById('writeoffDate').value = today;
            document.getElementById('currentDate').textContent = new Date().toLocaleDateString('ru-RU');
            
            // Установка года в копирайте
            const yearEl = document.getElementById('copyrightYear');
            if(yearEl) yearEl.textContent = new Date().getFullYear();
        }


        // ==================== DASHBOARD & BACKUP ====================

        function updateDashboard() {
            const nameEvents = (id) => id ? `onmouseenter="showProductImagePreview(this, ${id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"` : '';

            // 1. Filaments
            const filamentsInStock = db.filaments.filter(f => f.availability === 'В наличии');
            const filamentsSorted = [...filamentsInStock].sort((a, b) => new Date(a.date) - new Date(b.date));
            document.getElementById('dashFilamentCount').textContent = filamentsInStock.length;
            
            const lowStockFilaments = filamentsInStock.filter(f => f.remainingLength < 50);
            const warningContainer = document.getElementById('dashFilamentWarnings');
            if (lowStockFilaments.length > 0) {
                warningContainer.innerHTML = lowStockFilaments.map(f => 
                    `<div class="warning-item"><span>⚠️</span><span>Филамента <b>${escapeHtml(f.customId)}</b> осталось всего <b>${f.remainingLength.toFixed(1)}</b> метров.</span></div>`
                ).join('');
                warningContainer.classList.remove('hidden');
            } else {
                warningContainer.innerHTML = '';
                warningContainer.classList.add('hidden');
            }

            document.querySelector('#dashFilamentTable tbody').innerHTML = filamentsSorted.map(f => {
                const rowClass = (f.remainingLength < 50) ? 'row-bg-danger' : '';
                return `
                <tr class="${rowClass}">
                    <td><span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}</td>
                    <td>${f.date}</td>
                    <td>${escapeHtml(f.brand)}</td>
                    <td>${escapeHtml(f.type)}</td>
                    <td>${f.remainingLength.toFixed(1)}</td>
                    <td>${f.actualPrice.toFixed(2)} ₽</td>
                </tr>`;
            }).join('');

            // 2. Products
            const independentProducts = db.products.filter(p => p.type !== 'Часть составного');
            const lastProducts = [...independentProducts].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
            const stockProducts = independentProducts.filter(p => p.status === 'В наличии полностью' || p.status === 'В наличии частично');
            document.getElementById('dashProductCountRecord').textContent = stockProducts.length;
            document.getElementById('dashProductCountStock').textContent = stockProducts.reduce((sum, p) => sum + (p.inStock || 0), 0);

            document.querySelector('#dashProductTable tbody').innerHTML = lastProducts.map(p => {
                let badgeClass = 'badge-secondary', statusStyle = 'font-weight: 400;';
                if (p.status === 'В наличии полностью') { badgeClass = 'badge-light-green'; statusStyle = 'font-weight: 700;'; }
                else if (p.status === 'В наличии частично') { badgeClass = 'badge-success'; statusStyle = 'font-weight: 700;'; }
                else if (p.status === 'Брак') { badgeClass = 'badge-danger'; }
                else if (p.status === 'Нет в наличии') { badgeClass = 'badge-gray'; }
                
                let colorHtml = '—';
                if (p.type === 'Составное') {
                    const children = db.products.filter(k => k.parentId === p.id);
                    const uniqueColors = new Map();
                    children.forEach(child => { if (child.filament && child.filament.color) uniqueColors.set(child.filament.color.id, child.filament.color); });
                    if (uniqueColors.size > 0) colorHtml = Array.from(uniqueColors.values()).map(c => `<span class="color-swatch" style="background:${c.hex}" title="${escapeHtml(c.name)}"></span>`).join('');
                } else if (p.filament) {
                    colorHtml = `<span class="color-swatch" style="background:${p.filament.color.hex}"></span>${escapeHtml(p.filament.color.name)}`;
                }
                
                return `<tr>
                    <td ${nameEvents(p.id)}><strong>${escapeHtml(p.name)}</strong></td>
                    <td>${p.date}</td>
                    <td>${colorHtml}</td>
                    <td>${p.inStock}</td>
                    <td><span class="badge ${badgeClass}" style="${statusStyle}">${escapeHtml(p.status)}</span></td>
                </tr>`;
            }).join('');


            // 3. Sales
            const sales = db.writeoffs.filter(w => w.type === 'Продажа');
            const lastSales = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
            document.getElementById('dashSoldCount').textContent = sales.reduce((sum, w) => sum + w.qty, 0);
            
            document.querySelector('#dashSalesTable tbody').innerHTML = lastSales.map(w => `
                <tr>
                    <td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td>
                    <td>${w.date}</td>
                    <td>${w.qty}</td>
                    <td>${w.price.toFixed(2)}</td>
                    <td>${w.total.toFixed(2)}</td>
                    <td><span class="badge badge-success">Продажа</span></td>
                </tr>`).join('');

            // 4. Used
            const used = db.writeoffs.filter(w => w.type === 'Использовано');
            const lastUsed = [...used].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
            document.getElementById('dashUsedCount').textContent = used.reduce((sum, w) => sum + w.qty, 0);
            
            document.querySelector('#dashUsedTable tbody').innerHTML = lastUsed.map(w => `
                <tr>
                    <td ${nameEvents(w.productId)}>${escapeHtml(w.productName)}</td>
                    <td>${w.date}</td>
                    <td>${w.qty}</td>
                    <td>${escapeHtml(w.note || '')}</td>
                    <td><span class="badge badge-purple">Использовано</span></td>
                </tr>`).join('');

            // 5. Defective
            const defectiveProds = independentProducts.filter(p => p.defective);
            const defectiveWriteoffs = db.writeoffs.filter(w => w.type === 'Брак');
            
            const allDefective = [
                ...defectiveProds.map(p => ({
                    productId: p.id, name: p.name, date: p.date, qty: p.quantity, note: p.note, ts: new Date(p.date).getTime()
                })),
                ...defectiveWriteoffs.map(w => ({
                    productId: w.productId, name: w.productName, date: w.date, qty: w.qty, note: w.note, ts: new Date(w.date).getTime()
                }))
            ];
            
            const lastDefective = allDefective.sort((a, b) => b.ts - a.ts).slice(0, 5);
            document.getElementById('dashDefectiveCount').textContent = allDefective.reduce((s, item) => s + item.qty, 0);
            
            document.querySelector('#dashDefectiveTable tbody').innerHTML = lastDefective.map(item => `
                <tr>
                    <td ${nameEvents(item.productId)}>${escapeHtml(item.name)}</td>
                    <td>${item.date}</td>
                    <td>${item.qty}</td>
                    <td>${escapeHtml(item.note || '')}</td>
                    <td><span class="badge badge-danger">Брак</span></td>
                </tr>`).join('');
        }




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
            
            // Обратите внимание на async перед (e)
            r.onload = async (e) => {
                try {
                    const loaded = JSON.parse(e.target.result);
                    if (loaded.filaments && loaded.products) {
                        if (confirm('Внимание! Текущие данные будут заменены. Продолжить?')) {
                            // Очистка текущих массивов
                            db.filaments = []; 
                            db.products = []; 
                            db.writeoffs = []; 
                            db.brands = []; 
                            db.colors = []; 
                            db.plasticTypes = []; 
                            db.filamentStatuses = []; 
                            db.printers = [];
                            
                            // Присвоение новых данных
                            Object.assign(db, loaded);
                            
                            // ВАЖНОЕ ИЗМЕНЕНИЕ: 
                            // Используем await saveData(), чтобы гарантировать запись на диск
                            // перед перезагрузкой страницы.
                            await saveData();
                            
                            alert('База успешно восстановлена!');
                            window.location.reload();
                        }
                    } else {
                        alert('Ошибка формата файла: не найдены обязательные поля.');
                    }
                } catch(err) { 
                    alert('Ошибка чтения файла: ' + err); 
                    console.error(err);
                }
            };
            r.readAsText(file);
            // Сбрасываем value инпута, чтобы можно было выбрать тот же файл повторно
            input.value = ''; 
        }


        // ==================== FILAMENT ====================
        function updatePriceTooltip() {
            const avg = parseFloat(document.getElementById('filamentAvgPrice').value) || 0;
            const act = parseFloat(document.getElementById('filamentActualPrice').value) || 0;
            document.getElementById('priceTooltip').textContent = `Коэффициент цены катушки по отношению к рыночной: ${avg > 0 ? (act / avg).toFixed(3) : '-'}`;
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
                const remW = Math.max(0, f.weight - f.usedWeight);
                const remL = Math.max(0, f.length - f.usedLength);
                document.getElementById('weightUsedCalc').textContent = `${f.usedWeight.toFixed(1)} г`;
                document.getElementById('weightRemainingCalc').textContent = `${remW.toFixed(1)} г`;
                document.getElementById('lengthUsedCalc').textContent = `${f.usedLength.toFixed(1)} м`;
                document.getElementById('lengthRemainingCalc').textContent = `${remL.toFixed(1)} м`;
            } else {
                document.getElementById('weightUsedCalc').textContent = '0 г';
                document.getElementById('weightRemainingCalc').textContent = `${Math.round(w)} г`;
                document.getElementById('lengthUsedCalc').textContent = '0.0 м';
                document.getElementById('lengthRemainingCalc').textContent = `${l.toFixed(1)} м`;
            }
        }

        function openFilamentModal() { document.getElementById('filamentModal').classList.add('active'); clearFilamentForm(); setTimeout(() => document.getElementById('filamentCustomId').focus(), 100); }
        
		function closeFilamentModal() { 
            document.getElementById('filamentModal').classList.remove('active'); 
            document.getElementById('filamentModal').removeAttribute('data-edit-id'); 
            // Обновленный селектор для новой шапки
            document.querySelector('#filamentModal .modal-header-title').textContent = 'Добавить филамент'; 
            clearFilamentForm(); 
        } 
		
        function clearFilamentForm() {
            document.getElementById('filamentCustomId').value = ''; document.getElementById('filamentName').value = ''; document.getElementById('filamentLink').value = ''; document.getElementById('filamentType').value = 'PLA';
            document.getElementById('filamentAvgPrice').value = ''; document.getElementById('filamentActualPrice').value = ''; document.getElementById('filamentNote').value = '';
            document.getElementById('filamentBrand').value = '0'; document.getElementById('filamentColorPreview').style.background = '#ffffff'; document.getElementById('filamentAvailability').value = 'В наличии';
            document.getElementById('filamentWeight').value = '1000'; document.getElementById('filamentLength').value = '330'; document.getElementById('filamentDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('priceTooltip').textContent = 'Коэффициент цены катушки по отношению к рыночной: -'; document.getElementById('weightTooltip').textContent = 'Граммов в метре: -';
            
            // Сброс сообщений
            const msg = document.getElementById('filamentValidationMessage');
            msg.classList.add('hidden'); 
            msg.textContent = 'Не все обязательные поля заполнены';
            document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
            document.querySelectorAll('#filamentModal input, #filamentModal select').forEach(el => el.classList.remove('error'));
			
            // --- НОВОЕ: Сброс блокировки полей (разблокируем всё) ---
            const allInputs = document.querySelectorAll('#filamentModal input, #filamentModal select, #filamentModal textarea');
            allInputs.forEach(el => el.disabled = false);
            // -------------------------------------------------------

			updateFilamentCalcFields();
			updateFilamentStatusUI(); 
        }

		
        function validateFilamentForm() {
            let valid = true; const req = ['filamentCustomId','filamentDate','filamentName','filamentActualPrice','filamentAvgPrice','filamentWeight','filamentLength','filamentColor'];
            req.forEach(id => document.getElementById(id).classList.remove('error')); document.getElementById('filamentValidationMessage').classList.add('hidden'); document.getElementById('filamentUniqueIdMessage').classList.add('hidden');
            req.forEach(id => { const el = document.getElementById(id); if (!el.value || (el.type === 'number' && parseFloat(el.value) === 0)) { el.classList.add('error'); valid = false; } });
            const cid = document.getElementById('filamentCustomId').value.trim(); const eid = document.getElementById('filamentModal').getAttribute('data-edit-id');
            if (valid && cid) { if (db.filaments.some(f => f.customId === cid && (!eid || f.id != eid))) { document.getElementById('filamentCustomId').classList.add('error'); document.getElementById('filamentUniqueIdMessage').classList.remove('hidden'); valid = false; } }
            if (!valid && document.getElementById('filamentUniqueIdMessage').classList.contains('hidden')) document.getElementById('filamentValidationMessage').classList.remove('hidden');
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
            
            saveToLocalStorage(); 
            updateAllSelects(); 
            try { updateFilamentsTable(); } catch(e){ console.error(e); }
            try { updateDashboard(); } catch(e){ console.error(e); }
            closeFilamentModal();
        }


		
        function deleteFilament(id) {
            if (db.products.some(p => p.filament && p.filament.id === id)) { alert('Удаление невозможно. Филамент использован в изделиях'); return; }
            if (!confirm('Удалить филамент?')) return; db.filaments = db.filaments.filter(f => f.id !== id); saveToLocalStorage(); updateAllSelects(); updateFilamentsTable(); updateDashboard();
        }
		
        function updateFilamentsTable() {
            const tbody = document.querySelector('#filamentsTable tbody');
            const sortBy = document.getElementById('filamentSortBy').value;

            // Сортируем копию данных перед отрисовкой
            const sortedFilaments = [...db.filaments].sort((a, b) => {
                switch (sortBy) {
                    case 'date-desc': return new Date(b.date) - new Date(a.date);
                    case 'date-asc': return new Date(a.date) - new Date(b.date);
                    case 'availability': return (a.availability || '').localeCompare(b.availability || '');
                    case 'brand': return (a.brand || '').localeCompare(b.brand || '');
                    case 'color': return (a.color?.name || '').localeCompare(b.color?.name || '');
                    case 'id': return (a.customId || '').localeCompare(b.customId || '');
                    case 'length': return (b.remainingLength || 0) - (a.remainingLength || 0);
                    case 'price': return (b.actualPrice || 0) - (a.actualPrice || 0);
                    default: return 0;
                }
            });

            tbody.innerHTML = sortedFilaments.map(f => {
                const badge = f.availability === 'В наличии' ? 'badge-success' : 'badge-gray';
                const note = f.note ? `<span class="tooltip-container" style="display:inline-flex; vertical-align:middle;"><span class="tooltip-icon">ℹ</span><span class="tooltip-text tooltip-top-left" style="width:200px; white-space:normal; line-height:1.2;">${escapeHtml(f.note)}</span></span>` : '';
                const link = f.link ? `<div class="tooltip-container"><a href="${escapeHtml(f.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Товар</a></div>` : '';
                
                // --> ИСПРАВЛЕНИЕ: Убран cursor:help <--
                const iconHtml = `<span class="tooltip-container" style="margin-right:6px; cursor:default;"><span style="font-size:16px;">🧵</span><span class="tooltip-text tooltip-top-right">${escapeHtml(f.name)}</span></span>`;

                let rowClass = '';
                if (f.availability === 'Израсходовано') { rowClass = 'row-bg-gray'; }
                
                let remainingHtml = f.remainingLength.toFixed(1);
                if (f.availability === 'В наличии' && f.remainingLength < 50) {
                    remainingHtml = `<span class="badge badge-danger">${remainingHtml}</span>`;
                    rowClass = 'row-bg-danger';
                }

                return `<tr class="${rowClass}">
                    <td>${iconHtml}<strong>${escapeHtml(f.customId)}</strong></td>
                    <td>${f.date}</td>
                    <td><span class="badge ${badge}">${escapeHtml(f.availability)}</span></td>
                    <td><span class="color-swatch" style="background:${f.color.hex}"></span>${escapeHtml(f.color.name)}</td>
                    <td>${escapeHtml(f.brand)}</td>
                    <td>${escapeHtml(f.type)}</td>
                    <td>${f.length.toFixed(1)}</td>
                    <td>${remainingHtml} ${note}</td>
                    <td>${f.usedLength.toFixed(1)}</td>
                    <td>${f.usedWeight.toFixed(1)}</td>
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
            
            filterFilaments(); // Применяем фильтры к уже отсортированной и отрисованной таблице
        }


		
		
        function filterFilaments() {
            const term = document.getElementById('filamentSearch').value.toLowerCase(); const status = document.getElementById('filamentStatusFilter').value;
            document.querySelectorAll('#filamentsTable tbody tr').forEach(row => { const text = row.textContent.toLowerCase(); const matchTerm = text.includes(term); const matchStatus = !status || row.children[2].textContent.includes(status); row.style.display = matchTerm && matchStatus ? '' : 'none'; });
        }

		function resetFilamentFilters() {
			document.getElementById('filamentSearch').value = '';
			document.getElementById('filamentStatusFilter').value = '';
			document.getElementById('filamentSortBy').value = 'date-desc';
			updateFilamentsTable(); // Это вызовет перерисовку с правильной сортировкой и фильтрами
		}

        function copyFilament(id) {
            const f = db.filaments.find(x => x.id === id); if (!f) return;
            openFilamentModal(); // Открывает чистую форму с новым ID
            
            // Заполняем поля данными из копируемого объекта
            document.getElementById('filamentCustomId').value = f.customId + ' (Копия)';
            document.getElementById('filamentName').value = f.name;
            document.getElementById('filamentLink').value = f.link || '';
            document.getElementById('filamentBrand').value = db.brands.indexOf(f.brand);
            document.getElementById('filamentType').value = f.type;
            document.getElementById('filamentColor').value = f.color.id;
            
            // Цены и вес
            document.getElementById('filamentAvgPrice').value = f.avgPrice;
            document.getElementById('filamentActualPrice').value = f.actualPrice;
            document.getElementById('filamentWeight').value = f.weight;
            document.getElementById('filamentLength').value = f.length;
            document.getElementById('filamentNote').value = f.note;
            document.getElementById('filamentAvailability').value = 'В наличии'; // При копировании логично ставить в наличие
            document.getElementById('filamentDate').value = new Date().toISOString().split('T')[0]; // Дата текущая

            // Обновляем UI
            updateFilamentColorPreview();
            updateFilamentCalcFields();
            updatePriceTooltip();
            updateWeightTooltip();
            
            document.querySelector('#filamentModal .modal-header').textContent = 'Копирование филамента';
        }

 
		function editFilament(id) {
            const f = db.filaments.find(x => x.id === id); if (!f) return;
            document.getElementById('filamentCustomId').value = f.customId; 
            document.getElementById('filamentBrand').value = db.brands.indexOf(f.brand); 
            document.getElementById('filamentType').value = f.type;
            document.getElementById('filamentColor').value = f.color.id; 
            document.getElementById('filamentColorPreview').style.background = f.color.hex; 
            document.getElementById('filamentDate').value = f.date;
            document.getElementById('filamentName').value = f.name; 
            document.getElementById('filamentLink').value = f.link || ''; 
            document.getElementById('filamentAvgPrice').value = f.avgPrice;
            document.getElementById('filamentActualPrice').value = f.actualPrice; 
            document.getElementById('filamentWeight').value = f.weight; 
            document.getElementById('filamentLength').value = f.length;
            document.getElementById('filamentNote').value = f.note; 
            document.getElementById('filamentAvailability').value = f.availability;
            
            document.getElementById('filamentModal').setAttribute('data-edit-id', id); 
            updateFilamentCalcFields(); 
            updatePriceTooltip(); 
            updateWeightTooltip(); 
            
            document.querySelector('#filamentModal .modal-header-title').textContent = 'Редактировать филамент'; 
			updateFilamentStatusUI(); 

            // --- НОВАЯ ЛОГИКА БЛОКИРОВКИ ПОЛЕЙ ---
            const isDepleted = f.availability === 'Израсходовано';
            const validationMsg = document.getElementById('filamentValidationMessage');
            const allInputs = document.querySelectorAll('#filamentModal input, #filamentModal select, #filamentModal textarea');
            
            // Список ID полей, которые МОЖНО менять
            const allowedFields = ['filamentAvailability', 'filamentNote'];

            allInputs.forEach(el => {
                if (isDepleted && !allowedFields.includes(el.id)) {
                    el.disabled = true;
                } else {
                    el.disabled = false;
                }
            });

            if (isDepleted) {
                validationMsg.textContent = 'Редактирование ограничено: филамент израсходован.';
                validationMsg.classList.remove('hidden');
            } else {
                validationMsg.classList.add('hidden');
                // Сброс текста ошибки на дефолтный для валидации
                validationMsg.textContent = 'Не все обязательные поля заполнены';
            }
            // -------------------------------------

            document.getElementById('filamentModal').classList.add('active');
        }


        function updateFilamentStatusUI() {
            const el = document.getElementById('filamentAvailability');
            if (!el) return;
            
            // Сбрасываем классы
            el.classList.remove('select-status-stock', 'select-status-used');
            
            // Применяем класс в зависимости от значения
            if (el.value === 'В наличии') {
                el.classList.add('select-status-stock');
            } else {
                el.classList.add('select-status-used');
            }
        }

        // ==================== PRODUCT ====================
		
		
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
			// Мы не сравниваем файлы и изображения, т.к. их изменение - отдельный процесс.
			return JSON.stringify(snapshot);
		}

		function initiateWriteOff() {
			const currentSnapshot = captureProductSnapshot();
			const productId = document.getElementById('productModal').getAttribute('data-edit-id');

			if (currentSnapshot !== productSnapshotForDirtyCheck) {
				if (!confirm('Вы вносили изменения. Сохранить их перед переходом к списанию?')) {
					return; // Пользователь отменил действие
				}
			}
			
			// Вызываем сохранение с флагом, указывающим на последующее списание
			saveProduct(true); 
		}
		
		
		
        function updateProductFilamentSelect() {
            const productModal = document.getElementById('productModal'); const editId = productModal.getAttribute('data-edit-id'); const currentProduct = editId ? db.products.find(p => p.id == parseInt(editId)) : null; const currentFilament = currentProduct?.filament; const filamentSelect = document.getElementById('productFilament'); if (!filamentSelect) return;
            const available = db.filaments.filter(f => f.availability === 'В наличии'); let options = []; if (!editId) options.push(`<option value="">-- Выберите филамент --</option>`);
            if (currentFilament && !available.find(f => f.id === currentFilament.id)) { const currentRemaining = Math.max(0, currentFilament.length - currentFilament.usedLength); options.push(`<option value="${currentFilament.id}">${escapeHtml(currentFilament.customId)} (ост. ${currentRemaining.toFixed(1)} м.) - текущий</option>`); }
            options.push(...available.map(f => { const remaining = Math.max(0, f.length - f.usedLength); return `<option value="${f.id}">${escapeHtml(f.customId)} (ост. ${remaining.toFixed(1)} м.)</option>`; })); filamentSelect.innerHTML = options.join(''); if (currentFilament) filamentSelect.value = currentFilament.id;
        }
        function updateAllSelects() {
            document.querySelectorAll('#filamentBrand').forEach(s => s.innerHTML = db.brands.map((b, i) => `<option value="${i}">${escapeHtml(b)}</option>`).join(''));
            document.querySelectorAll('#filamentColor').forEach(s => { const editId = document.getElementById('filamentModal')?.getAttribute('data-edit-id'); let opts = !editId ? [`<option value="">-- Выберите цвет --</option>`] : []; opts.push(...db.colors.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)); s.innerHTML = opts.join(''); });
            document.querySelectorAll('#filamentType').forEach(s => s.innerHTML = db.plasticTypes.map(p => `<option value="${p}">${escapeHtml(p)}</option>`).join(''));
            document.querySelectorAll('#filamentAvailability').forEach(s => s.innerHTML = db.filamentStatuses.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join(''));
            const fs = document.getElementById('filamentStatusFilter'); if(fs) { const v=fs.value; fs.innerHTML = '<option value="">— Все статусы —</option>' + db.filamentStatuses.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join(''); fs.value=v; }
            document.querySelectorAll('#productPrinter').forEach(s => s.innerHTML = db.printers.map(p => `<option value="${p.id}">${escapeHtml(p.model)}</option>`).join(''));
             updateProductFilamentSelect(); updateBrandsList(); updateColorsList(); updateFilamentTypeList(); updateFilamentStatusList(); updatePrintersList(); updateElectricityCostList();

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


		function updateProductTypeUI() {
			const type = document.getElementById('productType').value;
			const groups = { parent: document.getElementById('productParentGroup'), allParts: document.getElementById('productAllPartsCreatedContainer'), material: document.getElementById('materialSection'), children: document.getElementById('childrenTableGroup'), linkContainer: document.getElementById('productLinkFieldContainer'), fileSection: document.getElementById('fileUploadSection') };
			const inputs = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
			
			const costNote = document.getElementById('compositeCostNote');
			if(costNote) costNote.classList.toggle('hidden', type !== 'Составное');

			groups.parent.classList.add('hidden');
			groups.allParts.style.display = 'none';
			groups.material.classList.remove('hidden');
			groups.children.classList.add('hidden');
			groups.linkContainer.style.display = 'block';
			if(groups.fileSection) groups.fileSection.classList.remove('hidden');

			if (type === 'Составное') {
				groups.allParts.style.display = 'flex';
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
			
			// --- ИСПРАВЛЕНИЕ: Возвращена логика видимости кнопки "Списать" ---
			const btnWriteOff = document.getElementById('btnWriteOffProduct');
			if (btnWriteOff) {
				const isExistingProduct = !!document.getElementById('productModal').getAttribute('data-edit-id');
				if (isExistingProduct && type !== 'Часть составного') {
					btnWriteOff.style.display = 'flex';
				} else {
					btnWriteOff.style.display = 'none';
				}
			}
			// ----------------------------------------------------------------

			updateProductCosts();
			updateProductAvailability();
		}




		
        function updateCompositeProductValues() {
            const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
            if (!eid) return;
            
            // Используем нестрогое сравнение '==' для надежности (ID может быть строкой или числом)
            const children = db.products.filter(p => p.parentId == eid && p.type === 'Часть составного'); 
            
            const totalTime = children.reduce((s, p) => s + (p.printTime || 0), 0);
            document.getElementById('productPrintTimeHours').value = Math.floor(totalTime / 60);
            document.getElementById('productPrintTimeMinutes').value = totalTime % 60;
            
            const totalWeight = children.reduce((s, p) => s + (p.weight || 0), 0);
            // Округляем вес до 1 знака после запятой
            document.getElementById('productWeight').value = totalWeight.toFixed(1);

            const totalLength = children.reduce((s, p) => s + (p.length || 0), 0);
            // Округляем длину до 2 знаков после запятой, как вы и просили
            document.getElementById('productLength').value = totalLength.toFixed(2);
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

            // --- ИСПРАВЛЕННЫЙ БЛОК v4: Объединены строки ---
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



		
		function updateParentSelect(ensureParentId = null) {
			const eid = document.getElementById('productModal')?.getAttribute('data-edit-id');
			const cp = eid ? db.products.find(p => p.id == parseInt(eid)) : null;
			let currentParent = cp?.parentId ? db.products.find(p => p.id == cp.parentId) : null;
			
			// Если мы копируем, ID родителя передается через ensureParentId
			if (!currentParent && ensureParentId) {
				currentParent = db.products.find(p => p.id == ensureParentId);
			}
			
			// --- ИСПРАВЛЕНИЕ: Добавлено условие !p.defective ---
			// Находим всех доступных для выбора родителей (не завершенных и не бракованных)
			const avail = db.products.filter(p => p.type === 'Составное' && !p.allPartsCreated && !p.defective);
			
			let opts = [];
			// Если у нас есть текущий родитель (из редактирования или копирования) И его нет в списке доступных,
			// мы принудительно добавляем его в начало списка. Это нужно, чтобы не терять связь, если родитель стал браком ПОСЛЕ привязки.
			if (currentParent && !avail.some(p => p.id === currentParent.id)) {
				opts.push(`<option value="${currentParent.id}">${escapeHtml(currentParent.name)} (текущий)</option>`);
			}

			// Добавляем всех остальных доступных родителей
			opts.push(...avail.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`));
			document.getElementById('productParent').innerHTML = opts.join('');
			
			// Устанавливаем текущего родителя как выбранного
			if (currentParent) {
				document.getElementById('productParent').value = currentParent.id;
			}
		}



		
		/**
		 * Открывает модальное окно для добавления нового изделия.
		 * Если окно уже подготовлено для редактирования (имеет атрибут data-edit-id),
		 * то сброс формы и установка заголовка "Добавить" не происходят.
		 */
		function openProductModal() {
			const modal = document.getElementById('productModal');
			if (!modal) {
				console.error('Модальное окно продукта не найдено!');
				return;
			}
			const isPreparedForEdit = modal.hasAttribute('data-edit-id');
			modal.classList.add('active');

			if (!isPreparedForEdit) {
				modal.removeAttribute('data-edit-id');
				modal.removeAttribute('data-system-id');
				const modalHeaderTitle = document.querySelector('#productModal .modal-header-title');
				if (modalHeaderTitle) {
					modalHeaderTitle.textContent = 'Добавить изделие';
				}
				const validationMessage = document.getElementById('productValidationMessage');
				if (validationMessage) {
					validationMessage.classList.add('hidden');
				}
				clearProductForm();
				const typeSelect = document.getElementById('productType');
				if (typeSelect) {
					typeSelect.value = 'Самостоятельное';
					updateProductTypeUI(); 
				}
				const now = new Date();
				const systemIdEl = document.getElementById('productSystemId');
				if (systemIdEl) {
					systemIdEl.textContent = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
				}
				updateProductFilamentSelect();
				setTimeout(() => {
					const productNameInput = document.getElementById('productName');
					if (productNameInput) {
						productNameInput.focus();
					}
				}, 100);
				
				// Запоминаем состояние "чистой" формы
				productSnapshotForDirtyCheck = captureProductSnapshot();
			}
		}

    
	
	    function closeProductModal() { 
            const modal = document.getElementById('productModal');
            if(!modal) return;

            try {
                clearProductForm(); 
            } catch(e) {
                console.warn("Ошибка при очистке формы, но окно будет закрыто:", e);
            }
            
            // === ИСПРАВЛЕНИЕ: Очищаем атрибуты редактирования ===
            // Это гарантирует, что при следующем нажатии "Добавить изделие"
            // форма откроется как новая, а не как продолжение редактирования.
            modal.removeAttribute('data-edit-id');
            modal.removeAttribute('data-system-id');
            // ====================================================

            modal.classList.remove('active'); 
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
            
            // Сброс специфичных полей
            if(document.getElementById('productAllPartsCreated')) 
                document.getElementById('productAllPartsCreated').checked = false;

            // Очистка таблицы дочерних элементов
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
            
            // === ИСПРАВЛЕНИЕ П.2: Корректный сброс статуса (ID и Класс) ===
            const statusField = document.getElementById('productAvailabilityField');
            if (statusField) {
                statusField.textContent = 'В наличии полностью';
                statusField.className = 'calc-field status-field-stocked'; // Возвращаем зеленый цвет
            }
            // =============================================================
            
            const msg = document.getElementById('productValidationMessage');
            if(msg) {
                msg.classList.add('hidden'); 
                msg.textContent = 'Не все обязательные поля заполнены';
            }

            document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));
            
            const allInputs = document.querySelectorAll('#productModal input, #productModal select, #productModal textarea, #productModal button.btn-primary'); 
            allInputs.forEach(el => { 
                el.disabled = false; 
                el.style.opacity = ''; 
                el.style.cursor = ''; 
                if(el.tagName === 'BUTTON') el.title = ""; 
            });
            
            // Сброс загруженных файлов и картинок
            removeProductImage();
            currentProductFiles = [];
            renderProductFiles();
        }

	
	
		function updateProductAvailability() {
			const def = document.getElementById('productDefective').checked;
			const statusField = document.getElementById('productAvailabilityField');
			const type = document.getElementById('productType').value;
			let statusText = def ? 'Брак' : 'В наличии полностью';
			let statusClass = 'status-field-stocked';

			if (type === 'Часть составного') {
			statusText = def ? 'Брак' : 'Часть изделия';
			statusClass = def ? 'status-field-defective' : 'status-field-part';
			} else if (statusText === 'Брак') {
			statusClass = 'status-field-defective';
			}

			statusField.textContent = statusText;
			statusField.className = 'calc-field ' + statusClass;
			updateProductStockDisplay();
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
                    <td>
                        <span class="color-swatch" style="background:${colorHex}" title="${colorName}"></span>
                    </td>
                    <td>${k.quantity}</td>
                    <td>${k.weight.toFixed(1)}</td>
                    <td>${k.length.toFixed(2)}</td>
                    <td>${k.costMarketPrice.toFixed(2)}</td>
                    <td>${k.costActualPrice.toFixed(2)}</td>
                </tr>`;
            }).join(''); 
        }

        
		function validateProductForm() {
            let valid = true; const t = document.getElementById('productType').value; const req = ['productDate','productQuantity','productName']; if(t!=='Составное') req.push('productFilament','productPrinter','productWeight','productLength'); if(t==='Часть составного') req.push('productParent');
            document.getElementById('productValidationMessage').classList.add('hidden'); document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));
            req.forEach(id => { const el = document.getElementById(id); if(!el.value || (el.type==='number' && parseFloat(el.value)===0)) { el.classList.add('error'); valid=false; } });
            if(t!=='Составное') { const h = parseInt(document.getElementById('productPrintTimeHours').value)||0; const m = parseInt(document.getElementById('productPrintTimeMinutes').value)||0; if(h===0 && m===0) { document.getElementById('productPrintTimeHours').classList.add('error'); document.getElementById('productPrintTimeMinutes').classList.add('error'); valid=false; } }
            if(!valid) { document.getElementById('productValidationMessage').textContent = 'Не все обязательные поля заполнены'; document.getElementById('productValidationMessage').classList.remove('hidden'); } return valid;
        }
        function determineProductStatus(p) { if (p.defective) return 'Брак'; if (p.type === 'Часть составного') return 'Часть изделия'; if (p.inStock === 0) return 'Нет в наличии'; if (p.inStock < p.quantity) return 'В наличии частично'; return 'В наличии полностью'; }
        
 
		function saveProduct(andThenWriteOff = false) {
			try {
				if (!validateProductForm()) return;
				const modal = document.getElementById('productModal');
				if (!modal.classList.contains('active')) {
					console.error('Модаль не активна');
					return;
				}
				
				const eid = document.getElementById('productModal').getAttribute('data-edit-id'); 
				const type = document.getElementById('productType').value; 
				const isDefective = document.getElementById('productDefective').checked; 
				const qty = parseInt(document.getElementById('productQuantity').value) || 0;
				const printerObj = db.printers.find(x => x.id == document.getElementById('productPrinter').value) || (db.printers.length > 0 ? db.printers[0] : null);

				const p = { 
					name: document.getElementById('productName').value, 
					systemId: eid ? document.getElementById('productModal').getAttribute('data-system-id') : document.getElementById('productSystemId').textContent, 
					date: document.getElementById('productDate').value, 
					link: document.getElementById('productLink').value, 
					quantity: qty, 
					weight: parseFloat(document.getElementById('productWeight').value) || 0, 
					length: parseFloat(document.getElementById('productLength').value) || 0, 
					printTime: (parseInt(document.getElementById('productPrintTimeHours').value)||0)*60 + (parseInt(document.getElementById('productPrintTimeMinutes').value)||0), 
					printer: printerObj, 
					type: type, 
					note: document.getElementById('productNote').value, 
					defective: isDefective,
					imageBlob: currentProductImage,
					attachedFiles: currentProductFiles
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
					p.marketCostByLength = mkL; p.marketCostByWeight = mkW; 
					p.costActualByLength = acL; p.costActualByWeight = acW; 
					p.costMarketPrice = Math.max(mkW, mkL) + energy; 
					p.costActualPrice = Math.max(acW, acL) + energy; 
				} else {
					p.costMarketPrice = energy; p.costActualPrice = energy;
				}
				
				p.costPer1Market = qty > 0 ? p.costMarketPrice / qty : 0; 
				p.costPer1Actual = qty > 0 ? p.costActualPrice / qty : 0;

				if (eid) {
					const oldIndex = db.products.findIndex(x => x.id == parseInt(eid));
					if (oldIndex !== -1) {
						const old = db.products[oldIndex];
						if (old.filament && old.type !== 'Составное') { 
							const oldFil = db.filaments.find(f => f.id === old.filament.id);
							if(oldFil) {
								oldFil.usedLength -= old.length || 0; 
								oldFil.usedWeight -= old.weight || 0; 
								oldFil.remainingLength = Math.max(0, oldFil.length - oldFil.usedLength);
							}
						}
						Object.assign(old, p);
						p.id = old.id;
					}
				} else {
					p.id = Date.now(); 
					db.products.push(p);
				}

				if (filament && type !== 'Составное') { 
					const currentFil = db.filaments.find(f => f.id === filament.id);
					if (currentFil) {
						currentFil.usedLength += p.length; 
						currentFil.usedWeight += p.weight; 
						currentFil.remainingLength = Math.max(0, currentFil.length - currentFil.usedLength); 
					}
				}

				if (type === 'Часть составного' && p.parentId) { 
					const parent = db.products.find(x => x.id === p.parentId); 
					if (parent) { 
						const siblings = db.products.filter(k => k.parentId === parent.id); 
						parent.costMarketPrice = siblings.reduce((s, k) => s + (k.costMarketPrice || 0), 0); 
						parent.costActualPrice = siblings.reduce((s, k) => s + (k.costActualPrice || 0), 0); 
						parent.costPer1Market = parent.quantity > 0 ? parent.costMarketPrice / parent.quantity : 0; 
						parent.costPer1Actual = parent.quantity > 0 ? parent.costActualPrice / parent.quantity : 0; 
					} 
				}
				
				recalculateAllProductCosts(); 
				saveToLocalStorage(); 
				
				try { updateAllSelects(); updateProductsTable(); updateDashboard(); updateFilamentsTable(); updateReports(); } catch(e){ console.error("Error during UI refresh after save:", e); }
				
				// --- Логика закрытия/перехода ---
				if (andThenWriteOff) {
					const productIdToPass = p.id;
					closeProductModal();
					setTimeout(() => openWriteoffModalForProduct(productIdToPass), 150); 
				} else {
					closeProductModal();
				}

			} catch (err) {
				alert("Критическая ошибка при сохранении: " + err.message);
				console.error(err);
			}
		}

		function openWriteoffModalForProduct(productId) {
			if (!productId) return;
			openWriteoffModal(); 
			
			// Небольшая задержка, чтобы модальное окно успело полностью отрисоваться
			setTimeout(() => {
				const productSelect = document.querySelector('#writeoffItemsContainer .writeoff-product-select');
				if (productSelect) {
					productSelect.value = productId;
					// Имитируем событие, чтобы обновить зависимые поля
					updateWriteoffSection(1); 
				}
			}, 100);
		}


	
        function deleteProduct(id) {
            const p = db.products.find(x => x.id === id); if (!p) return;
            if (db.writeoffs && db.writeoffs.some(w => w.productId === id)) { alert('Нельзя удалить изделие, по которому уже есть списания!'); return; }
                  if (!confirm(`Удалить изделие "${p.name}" и вернуть филамент?`)) return;
            
            // FIX: Ищем катушку в основной базе db.filaments по ID, а не меняем копию в p.filament
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
                        // FIX: То же самое для частей составного - ищем в основной базе
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
                    const siblings = db.products.filter(k => k.parentId === parent.id); 
                    parent.costMarketPrice = siblings.reduce((s, k) => s + (k.costMarketPrice || 0), 0); 
                    parent.costActualPrice = siblings.reduce((s, k) => s + (k.costActualPrice || 0), 0); 
                    parent.costPer1Market = parent.quantity > 0 ? parent.costMarketPrice / parent.quantity : 0; 
                    parent.costPer1Actual = parent.quantity > 0 ? parent.costActualPrice / parent.quantity : 0; 
                } 
            }
            
            saveToLocalStorage(); 
            updateAllSelects(); 
            updateProductsTable(); 
            updateDashboard(); 
            updateReports(); 
            updateFilamentsTable();
        }

        
		// --- HELPERS (Restore missing functions) ---
        function getWriteoffQuantityForProduct(productId, excludeWriteoffId = null) {
            if (!db.writeoffs) return 0;
            return db.writeoffs
                .filter(w => w.productId === productId && (!excludeWriteoffId || w.systemId !== excludeWriteoffId))
                .reduce((sum, w) => sum + w.qty, 0);
        }

        function updateProductStockDisplay() {
            const qty = parseInt(document.getElementById('productQuantity').value) || 0;
            const isDefective = document.getElementById('productDefective').checked;
            const eid = document.getElementById('productModal').getAttribute('data-edit-id');
            const pid = eid ? parseInt(eid) : null;
            let currentStock = isDefective ? 0 : Math.max(0, qty - getWriteoffQuantityForProduct(pid));
            document.getElementById('productStockCalc').textContent = currentStock + ' шт.';
        }

		function copyProduct(id) {
			const p = db.products.find(x => x.id === id); 
			if (!p) return;

			if (p.type === 'Составное') {
				if (!confirm('Это составное изделие. Будут скопированы все его части. Продолжить?')) {
					return;
				}
				const newParent = JSON.parse(JSON.stringify(p));
				const now = new Date();
				newParent.id = now.getTime();
				newParent.systemId = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
				newParent.name = p.name + ' (Копия)';
				newParent.date = now.toISOString().split('T')[0];
				newParent.inStock = p.quantity;
				newParent.allPartsCreated = false;
				newParent.defective = false;
				newParent.status = determineProductStatus(newParent);
				newParent.imageBlob = p.imageBlob;
				newParent.attachedFiles = [];
				db.products.push(newParent);

				const children = db.products.filter(child => child.parentId === p.id);
				children.forEach((child, index) => {
					const newChild = JSON.parse(JSON.stringify(child));
					const childNow = new Date();
					newChild.id = childNow.getTime() + index + 1;
					newChild.systemId = `${childNow.getFullYear()}${String(childNow.getMonth()+1).padStart(2,'0')}${String(childNow.getDate()).padStart(2,'0')}${String(childNow.getHours()).padStart(2,'0')}${String(childNow.getMinutes()).padStart(2,'0')}${String(childNow.getSeconds()+index+1).padStart(2,'0')}`;
					newChild.parentId = newParent.id;
					newChild.date = now.toISOString().split('T')[0];
					newChild.inStock = newChild.quantity;
					newChild.defective = false;
					newChild.status = determineProductStatus(newChild);
					newChild.imageBlob = child.imageBlob;
					newChild.attachedFiles = [];
					db.products.push(newChild);
				});
				saveToLocalStorage();
				updateProductsTable();
				updateDashboard();
				alert(`Составное изделие "${newParent.name}" и ${children.length} его частей успешно скопированы.`);

			} else {
				openProductModal();
				document.getElementById('productName').value = p.name + ' (Копия)';
				document.getElementById('productLink').value = p.link || '';
				document.getElementById('productDate').value = new Date().toISOString().split('T')[0];
				document.getElementById('productWeight').value = p.weight;
				document.getElementById('productLength').value = p.length;
				document.getElementById('productPrintTimeHours').value = Math.floor(p.printTime/60);
				document.getElementById('productPrintTimeMinutes').value = p.printTime%60;
				document.getElementById('productPrinter').value = p.printer ? p.printer.id : '';
				document.getElementById('productType').value = p.type;
				document.getElementById('productNote').value = p.note;
				document.getElementById('productDefective').checked = false;
				
				updateProductTypeUI();
				
				if (p.type === 'Часть составного') { 
					updateParentSelect(p.parentId);
					document.getElementById('productParent').value = p.parentId;
					
					// --> НОВАЯ ЛОГИКА: Наследуем количество от родителя <--
					const parent = db.products.find(x => x.id == p.parentId);
					if (parent) {
						document.getElementById('productQuantity').value = parent.quantity;
					} else {
						document.getElementById('productQuantity').value = p.quantity;
					}
					// ---------------------------------------------------
				} else {
					document.getElementById('productQuantity').value = p.quantity;
				}

				if (p.type !== 'Составное' && p.filament) { 
					document.getElementById('productFilament').value = p.filament.id; 
				}
				
				currentProductImage = p.imageBlob || null;
				renderProductImage();
				
				updateProductFilamentSelect();
				if (p.type !== 'Составное' && p.filament) updateProductColorDisplay();
				updateProductCosts();
				
				document.querySelector('#productModal .modal-header-title').textContent = 'Копирование изделия';
			}
		}


		function addChildPart(parentId) {
			openProductModal(); // Открываем пустую форму
			document.getElementById('productType').value = 'Часть составного';
			updateProductTypeUI(); 
			document.getElementById('productParent').value = parentId;
			
			// --> НОВАЯ ЛОГИКА: Наследуем количество от родителя <--
			const parent = db.products.find(p => p.id == parentId);
			if (parent) {
				document.getElementById('productQuantity').value = parent.quantity;
			}
			// ----------------------------------------------------

			setTimeout(() => document.getElementById('productName').focus(), 100);
		}


		function editProduct(id) {
			const productId = parseInt(id);
			const p = db.products.find(x => x.id === productId);
			if (!p) {
				console.error('Продукт не найден:', id);
				return;
			}

			document.getElementById('productSystemId').textContent = p.systemId || '-';
			document.getElementById('productModal').setAttribute('data-edit-id', id);
			document.getElementById('productModal').setAttribute('data-system-id', p.systemId);

			openProductModal();

			const titleEl = document.querySelector('#productModal .modal-header-title');
			if (titleEl) titleEl.textContent = 'Редактировать изделие';
			
			const defCheckbox = document.getElementById('productDefective');
			if (defCheckbox) {
				defCheckbox.checked = p.defective;
				if (typeof updateProductAvailability === 'function') {
					updateProductAvailability();
				}
			}

			const validationMessage = document.getElementById('productValidationMessage');
			if (validationMessage) validationMessage.classList.add('hidden');
			document.querySelectorAll('#productModal input, #productModal select').forEach(el => el.classList.remove('error'));

			const fieldsToFill = [ { id: 'productName', value: p.name }, { id: 'productLink', value: p.link || '' }, { id: 'productDate', value: p.date }, { id: 'productQuantity', value: p.quantity }, { id: 'productWeight', value: p.weight || '' }, { id: 'productLength', value: p.length || '' }, { id: 'productPrintTimeHours', value: Math.floor((p.printTime || 0) / 60) }, { id: 'productPrintTimeMinutes', value: (p.printTime || 0) % 60 }, { id: 'productNote', value: p.note || '' }, { id: 'productType', value: p.type || 'Самостоятельное' } ];
			fieldsToFill.forEach(field => {
				const el = document.getElementById(field.id);
				if (el) el.value = field.value;
			});

			currentProductImage = p.imageBlob || null;
			renderProductImage();
			currentProductFiles = p.attachedFiles || []; 
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
			if (printerSelect) {
				if (p.printer && db.printers.some(pr => pr.id === p.printer.id)) printerSelect.value = p.printer.id;
				else if (db.printers.length > 0) printerSelect.value = db.printers[0].id;
			}

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

			const allInputs = document.querySelectorAll('#productModal input, #productModal select, #productModal textarea');
			const saveBtn = document.querySelector('#productModal .modal-footer .btn-primary');
			if (saveBtn) saveBtn.disabled = false;
			allInputs.forEach(el => el.disabled = false);

			if (p.type === 'Составное') {
				const compositeLockedFields = ['productFilament','productPrinter','productPrintTimeHours','productPrintTimeMinutes','productWeight','productLength'];
				compositeLockedFields.forEach(id => {
					const el = document.getElementById(id);
					if(el) el.disabled = true;
				});
			}

			let hasWriteoffs = db.writeoffs && db.writeoffs.some(w => w.productId === id);
			if (!hasWriteoffs && p.type === 'Часть составного' && p.parentId) {
				if (db.writeoffs.some(w => w.productId === p.parentId)) hasWriteoffs = true;
			}

			let isChildOfDefectiveParent = false;
			let isChildOfCompletedParent = false; 

			if (p.type === 'Часть составного' && p.parentId) {
				const parent = db.products.find(x => x.id === p.parentId);
				if (parent) {
					if(parent.defective) isChildOfDefectiveParent = true;
					if(parent.allPartsCreated) isChildOfCompletedParent = true;
				}
			}

			let fieldsToEnable = [];
			let lockReason = '';

			const mediaFields = ['productImageInput', 'productFileInput'];

			if (hasWriteoffs) {
				fieldsToEnable = ['productNote', ...mediaFields]; 
				lockReason = 'Редактирование ограничено: есть списания. Можно изменить примечание, фото и файлы.';
			} else if (p.defective) {
				fieldsToEnable = ['productNote', 'productDefective', ...mediaFields];
				lockReason = 'Редактирование ограничено: изделие в браке.';
			} else if (isChildOfDefectiveParent) {
				fieldsToEnable = ['productNote', ...mediaFields];
				lockReason = 'Редактирование ограничено: родительское изделие в браке.';
			} else if (isChildOfCompletedParent) {
				fieldsToEnable = ['productNote', 'productDefective', ...mediaFields];
				lockReason = 'Редактирование ограничено: родительское изделие завершено.';
			}

			if (lockReason) {
				allInputs.forEach(el => {
					if (!fieldsToEnable.includes(el.id)) el.disabled = true;
				});
				
				if (validationMessage) {
					validationMessage.textContent = lockReason;
					validationMessage.classList.remove('hidden');
				}
			}
			
			// Запоминаем состояние формы после ее заполнения
			productSnapshotForDirtyCheck = captureProductSnapshot();
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

            let rootProducts;

            // Единая логика для всех фильтров
            rootProducts = db.products.filter(p => {
                if (p.type === 'Часть составного') return false; // Всегда начинаем с "корневых"
                if (term && !p.name.toLowerCase().includes(term)) return false;

                if (availFilter) {
                    if (availFilter === 'Брак') {
                        if (!p.defective) return false;
                    } else if (availFilter === 'InStock') {
                        if ((p.inStock || 0) <= 0) return false;
                    } else if (p.status !== availFilter) {
                        return false;
                    }
                }
                return true;
            });
            
            rootProducts.sort(sortFn);

            let html = '';
            rootProducts.forEach(root => {
                html += buildProductRow(root, false); // Рендерим родителя
                
                // Если это составной и нужно показать детей
                if (root.type === 'Составное' && showChildren) {
                    const children = db.products.filter(k => k.parentId === root.id);
                    children.sort((a, b) => (a.systemId || '').localeCompare(b.systemId || ''));
                    children.forEach(child => html += buildProductRow(child, true));
                }
            });

            tbody.innerHTML = html;
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
            
            const fil = p.filament && p.type !== 'Составное' ? `<span class="color-swatch" style="background:${p.filament.color.hex}"></span>${escapeHtml(p.filament.customId)}` : '—';
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
                const productWriteoffs = db.writeoffs.filter(w => w.productId === p.id);
                if ((p.status === 'Нет в наличии' || p.status === 'В наличии частично') && productWriteoffs.length > 0) {
                    
					const linksHtml = productWriteoffs
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .map(w => {
                            // --- ИСПРАВЛЕНИЕ 2: Убираем цвет из тултипа, оставляем только жирный текст ---
                            const plainType = `<strong>${escapeHtml(w.type)}</strong>`;
                            // -------------------------------------------------------------------------
                            
                            let linkText = '';
                            if (w.type === 'Продажа') {
                                linkText = `${w.date} ${plainType}: ${w.qty} шт. х ${w.price.toFixed(2)} ₽ = ${w.total.toFixed(2)} ₽`;
                            } else {
                                linkText = `${w.date} ${plainType}: ${w.qty} шт.`;
                            }
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
			
            let fileIconHtml = '';
            if (p.attachedFiles && p.attachedFiles.length > 0) {
                const fileCount = p.attachedFiles.length;
                fileIconHtml = `
                    <div class="tooltip-container">
                        <span style="font-size: 16px; cursor: default;">📎</span>
                        <span class="tooltip-text tooltip-top-right">Прикреплено ${fileCount} файлов</span>
                    </div>
                `;
            }
            
            const linkHtml = p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" style="color:#1e40af;text-decoration:underline;">Модель</a>` : '';

            // Hover events for preview
            const nameEvents = `onmouseenter="showProductImagePreview(this, ${p.id})" onmousemove="moveProductImagePreview(event)" onmouseleave="hideProductImagePreview(this)"`;

            let nameHtml = isChild 
                ? `<div class="product-name-cell product-child-indent"><div class="product-icon-wrapper"><strong>${icon}</strong></div><span ${nameEvents} style="cursor:default">${escapeHtml(p.name)}</span>${note}</div>`
                : `<div class="product-name-cell"><div class="product-icon-wrapper"><strong>${icon}</strong></div><span ${nameEvents} style="cursor:default"><strong>${escapeHtml(p.name)}</strong></span>${note}</div>`;

            // --- ИЗМЕНЕНИЕ 1: Логика кнопки "Добавить часть" ---
            let addPartButtonHtml = '';
            if (p.type === 'Составное') {
                const hasWriteoffs = db.writeoffs.some(w => w.productId === p.id);
                const isDisabled = hasWriteoffs || p.defective || p.allPartsCreated;
                addPartButtonHtml = `<button class="btn-secondary btn-small" title="Добавить часть изделия" onclick="addChildPart(${p.id})" ${isDisabled ? 'disabled' : ''}>+</button>`;
            }
            // ------------------------------------------------

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


		function onParentProductChange() {
			const parentId = document.getElementById('productParent').value;
			if (parentId) {
				const parent = db.products.find(p => p.id == parentId);
				if (parent) {
					document.getElementById('productQuantity').value = parent.quantity;
				}
			}
			updateProductCosts(); // Затем вызываем пересчет стоимостей
		}

        
        function filterProducts() { updateProductsTable(); }
        
        function resetProductFilters() {
            document.getElementById('productSearch').value = '';
            document.getElementById('productAvailabilityFilter').value = '';
            document.getElementById('productSortBy').value = 'systemId-desc'; // Changed default
            document.getElementById('showProductChildren').checked = true;
            updateProductsTable();
        }
       

        // ==================== NEW WRITEOFF MANAGEMENT ====================
        let writeoffSectionCount = 0;

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


        function openWriteoffModal(systemId = null) {
            document.getElementById('writeoffModal').classList.add('active');
            document.getElementById('writeoffValidationMessage').classList.add('hidden');
            
            // Generate or Set System ID
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
                document.querySelector('#writeoffModal .modal-header-title').textContent = 'Добавить списание изделия';
                const now = new Date();
                const genId = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                document.getElementById('writeoffSystemId').textContent = genId;
                document.getElementById('writeoffDate').value = now.toISOString().split('T')[0];
                document.getElementById('writeoffType').value = 'Продажа';
                document.getElementById('writeoffNote').value = '';
                
                document.getElementById('writeoffItemsContainer').innerHTML = '';
                writeoffSectionCount = 0;
                addWriteoffItemSection(); // Add one empty section
            }
            
            updateWriteoffTypeUI();
            calcWriteoffTotal();
			updateWriteoffTypeColor();
        }

        function closeWriteoffModal() {
            document.getElementById('writeoffModal').classList.remove('active');
        }

        function updateWriteoffTypeColor() {
            const el = document.getElementById('writeoffType');
            if (!el) return;
            
            // Сброс предыдущих классов
            el.classList.remove('select-writeoff-sale', 'select-writeoff-used', 'select-writeoff-defective');
            
            // Применение нового класса в зависимости от значения
            switch (el.value) {
                case 'Продажа':
                    el.classList.add('select-writeoff-sale');
                    break;
                case 'Использовано':
                    el.classList.add('select-writeoff-used');
                    break;
                case 'Брак':
                    el.classList.add('select-writeoff-defective');
                    break;
            }
        }


        function updateWriteoffTypeUI() {
            const type = document.getElementById('writeoffType').value;
            const isSale = type === 'Продажа';
            document.getElementById('writeoffTotalSummary').classList.toggle('hidden', !isSale);
            
            // Update visibility/state of Price fields in all sections
            document.querySelectorAll('.writeoff-item-section').forEach(sec => {
                const priceInput = sec.querySelector('.section-price');
                priceInput.disabled = !isSale;
                if (!isSale) priceInput.value = 0;
                // Trigger update to recalc totals
                const idx = sec.id.split('_')[1];
                updateWriteoffSection(idx);
            });
            calcWriteoffTotal();
			updateWriteoffTypeColor(); 
        }

        function addWriteoffItemSection(data = null) {
            writeoffSectionCount++;
            const index = writeoffSectionCount;
            const container = document.getElementById('writeoffItemsContainer');
            
            const div = document.createElement('div');
            div.className = 'writeoff-item-section';
            div.id = `writeoffSection_${index}`;
            
            // ИСПРАВЛЕНИЕ: Добавлена сортировка .sort()
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
            const priceInput = div.querySelector('.section-price');
            priceInput.disabled = (type !== 'Продажа');
        }





        function removeWriteoffSection(index) {
            const el = document.getElementById(`writeoffSection_${index}`);
            if (el) el.remove();
            renumberWriteoffSections();
            updateRemoveButtons();
            calcWriteoffTotal();
        }
        
        function renumberWriteoffSections() {
            writeoffSectionCount = 0; // Reset counter
            const sections = document.querySelectorAll('.writeoff-item-section');
            sections.forEach((sec, i) => {
                writeoffSectionCount++;
                const newIndex = writeoffSectionCount;
                sec.id = `writeoffSection_${newIndex}`;
                sec.querySelector('.section-title').textContent = `ИЗДЕЛИЕ ${newIndex}`;
                
                // Update onclick handlers for remove button
                const btn = sec.querySelector('.btn-remove-section');
                btn.setAttribute('onclick', `removeWriteoffSection(${newIndex})`);
                
                // Update onchange handlers
                sec.querySelector('.writeoff-product-select').setAttribute('onchange', `updateWriteoffSection(${newIndex})`);
                sec.querySelector('.section-qty').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
                sec.querySelector('.section-price').setAttribute('oninput', `updateWriteoffSection(${newIndex})`);
            });
        }
        
        function updateRemoveButtons() {
            const sections = document.querySelectorAll('.writeoff-item-section');
            sections.forEach(sec => {
                const btn = sec.querySelector('.btn-remove-section');
                if (sections.length === 1) btn.style.display = 'none';
                else btn.style.display = 'block';
            });
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

            // Calculate current stock ignoring THIS writeoff group if editing
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
                
                // Market Markup
                const markupM_money = price - costM;
                const markupM_percent = costM > 0 ? (markupM_money / costM) * 100 : 0;
                section.querySelector('.markup-market-val').textContent = `${markupM_money.toFixed(2)} ₽ (${markupM_percent.toFixed(1)}%)`;

                // Actual Markup
                const markupA_money = price - costA;
                const markupA_percent = costA > 0 ? (markupA_money / costA) * 100 : 0;
                section.querySelector('.markup-actual-val').textContent = `${markupA_money.toFixed(2)} ₽ (${markupA_percent.toFixed(1)}%)`;
                
                // Окраска (опционально, для удобства: плюс зеленый, минус красный)
                section.querySelector('.markup-market-val').style.color = markupM_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';
                section.querySelector('.markup-actual-val').style.color = markupA_money < 0 ? 'var(--color-danger)' : 'var(--color-success)';

				// БЛОК ДЛЯ РАСЧЕТА ПРИБЫЛИ
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

            if (amountSpan) amountSpan.textContent = `${totalSale.toFixed(2)} ₽`;
            if (profitSpan) {
                profitSpan.textContent = `${totalProfit.toFixed(2)} ₽`;
                profitSpan.style.color = totalProfit < 0 ? 'var(--color-danger)' : 'var(--color-success)';
            }
        }


       
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

            if (sections.length === 0) globalValid = false;
            
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

                            if (p.type === 'Составное' && old.hasDeductedParts === true) {
                                const children = db.products.filter(child => child.parentId == p.id && !child.defective);
                                const parentTotalQty = p.quantity || 1; 
                                
                                children.forEach(child => {
                                    const ratio = (child.quantity || 1) / parentTotalQty;
                                    child.inStock += (ratio * old.qty);
                                    child.status = determineProductStatus(child);
                                    child.availability = child.status;
                                });
                            }
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
                        
                        if (p.type === 'Составное') {
                            p.allPartsCreated = true;

                            const children = db.products.filter(child => child.parentId == p.id && !child.defective);
                            const parentTotalQty = p.quantity || 1; 

                            children.forEach(child => {
                                const ratio = (child.quantity || 1) / parentTotalQty;
                                child.inStock -= (ratio * item.qty);
                                child.status = determineProductStatus(child);
                                child.availability = child.status;
                            });
                        }
                    }
                });

                saveToLocalStorage();
                try { updateWriteoffTable(); } catch(e) { console.error(e); }
                try { updateProductsTable(); } catch(e) { console.error(e); }
                try { updateDashboard(); } catch(e) { console.error(e); }
                try { updateReports(); } catch(e){} 
                
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
                    p.status = determineProductStatus(p); 
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
   
        function copyWriteoffItem(rowId) {
            // Находим конкретную запись по её внутреннему ID
            const item = db.writeoffs.find(w => w.id === rowId); 
            if (!item) return;

            openWriteoffModal(); // Открывает модалку с новым SystemID и пустой секцией
            
            // Очищаем пустую секцию, созданную при открытии
            const container = document.getElementById('writeoffItemsContainer');
            container.innerHTML = '';
            writeoffSectionCount = 0;

            // Заполняем общие поля
            document.getElementById('writeoffType').value = item.type;
            document.getElementById('writeoffNote').value = item.note || '';
            document.getElementById('writeoffDate').value = new Date().toISOString().split('T')[0];
            
            updateWriteoffTypeUI(); // Обновляем UI (показать/скрыть итоги)

            // Добавляем секцию с данными из копируемой строки
            addWriteoffItemSection({
                productId: item.productId,
                qty: item.qty,
                price: item.price
            });
            
            document.querySelector('#writeoffModal .modal-header').textContent = 'Копирование записи списания';
        }


        function editWriteoff(systemId) {
            openWriteoffModal(systemId);
        }

        function updateWriteoffTable() {
            const tbody = document.querySelector('#writeoffTable tbody');
            const filterType = document.getElementById('writeoffTypeFilter').value;
            // Переименовали в search
            const search = document.getElementById('writeoffSearch').value.toLowerCase();
            const sortBy = document.getElementById('writeoffSortBy').value;
            
            let list = db.writeoffs || [];
            
            if (filterType) list = list.filter(w => w.type === filterType);
            if (search) list = list.filter(w => (w.productName && w.productName.toLowerCase().includes(search)) || (w.systemId && w.systemId.includes(search)));

            list.forEach(w => { if(!w.systemId) w.systemId = String(w.id); });

            list.sort((a,b) => {
                if (sortBy === 'systemId-desc') return b.systemId.localeCompare(a.systemId);
                if (sortBy === 'systemId-asc') return a.systemId.localeCompare(b.systemId);
                if (sortBy === 'date-desc') return new Date(b.date) - new Date(a.date);
                if (sortBy === 'date-asc') return new Date(a.date) - new Date(b.date);
                if (sortBy === 'product') return a.productName.localeCompare(b.productName);
                if (sortBy === 'total') return b.total - a.total;
                return 0;
            });

            tbody.innerHTML = list.map(w => {
                let statusBadge = 'badge-secondary';
                if (w.type === 'Продажа') statusBadge = 'badge-success';
                else if (w.type === 'Использовано') statusBadge = 'badge-purple';
                else if (w.type === 'Брак') statusBadge = 'badge-danger';

                // Находим продукт, чтобы получить его себестоимость
                const product = db.products.find(p => p.id === w.productId);
                const actualCost = product ? (product.costPer1Actual || 0).toFixed(2) : '0.00';

                return `
                <tr>
					<td>${w.date}</td>
                    <td><small>${w.systemId}</small></td>
                    <td><strong>${escapeHtml(w.productName)}</strong></td>
                    <td><span class="badge ${statusBadge}">${escapeHtml(w.type)}</span></td>
                    <td>${actualCost} ₽</td>
                    <td>${w.qty}</td>
                    <td>${w.type === 'Продажа' ? w.price.toFixed(2) : '-'}</td>
                    <td>${w.type === 'Продажа' ? w.total.toFixed(2) : '-'}</td>
                    <td>${escapeHtml(w.note)}</td>
                    <td class="text-center">
                        <div class="action-buttons">
                            <button class="btn-secondary btn-small" title="Редактировать группу" onclick="editWriteoff('${w.systemId}')">✎</button>
                            <button class="btn-secondary btn-small" title="Копировать строку в новый документ" onclick="copyWriteoffItem(${w.id})">❐</button>
                            <button class="btn-danger btn-small" title="Удалить группу" onclick="deleteWriteoff('${w.systemId}')">✕</button>
                        </div>
                    </td>           
                </tr>
            `}).join('');

        }


        
        function filterWriteoffs() { updateWriteoffTable(); }
        function sortWriteoffs() { updateWriteoffTable(); }
        function resetWriteoffFilters() {
            document.getElementById('writeoffSearch').value = '';
            document.getElementById('writeoffTypeFilter').value = '';
            document.getElementById('writeoffSortBy').value = 'systemId-desc'; // Changed default
            updateWriteoffTable();
        }
      

		// ==================== REFERENCES ====================
        
        // --- Brands ---
        function addBrand(){ const v=document.getElementById('newBrand').value.trim(); if(v && !db.brands.includes(v)){ db.brands.push(v); document.getElementById('newBrand').value=''; saveToLocalStorage(); updateAllSelects(); }}
        function removeBrand(i){ 
            const val = db.brands[i];
            if(db.filaments.some(f => f.brand === val)) { alert('Нельзя удалить: Бренд используется в филаментах.'); return; }
            db.brands.splice(i,1); saveToLocalStorage(); updateAllSelects(); 
        }
        function editBrand(i) {
            const newVal = prompt("Изменить название бренда:", db.brands[i]);
            if(newVal && newVal.trim() !== "") {
                const oldVal = db.brands[i];
                db.brands[i] = newVal.trim();
                // Обновляем ссылки в филаментах (так как там хранится строка)
                db.filaments.forEach(f => { if(f.brand === oldVal) f.brand = newVal.trim(); });
                saveToLocalStorage(); updateAllSelects();
            }
        }

        // --- Colors ---
        function addColor(){ const n=document.getElementById('newColor').value.trim(); const h=document.getElementById('newColorCode').value; if(n){ db.colors.push({id:Date.now(),name:n,hex:h}); document.getElementById('newColor').value=''; saveToLocalStorage(); updateAllSelects(); }}
        function removeColor(id){ 
            if(db.filaments.some(f => f.color && f.color.id === id)) { alert('Нельзя удалить: Цвет используется в филаментах.'); return; }
            db.colors=db.colors.filter(c=>c.id!==id); saveToLocalStorage(); updateAllSelects(); 
        }
        function editColor(id) {
            const c = db.colors.find(x => x.id === id);
            if(!c) return;
            const newName = prompt("Изменить название цвета:", c.name);
            if(newName && newName.trim() !== "") {
                c.name = newName.trim();
                // Цвет в филаментах хранится как объект, ссылка обновится, но для надежности пересохраняем
                saveToLocalStorage(); updateAllSelects();
            }
        }

        // --- Types ---
        function addFilamentType(){ const v=document.getElementById('newFilamentType').value.trim(); if(v && !db.plasticTypes.includes(v)){ db.plasticTypes.push(v); document.getElementById('newFilamentType').value=''; saveToLocalStorage(); updateAllSelects(); }}
        function removeFilamentType(i){ 
            const val = db.plasticTypes[i];
            if(db.filaments.some(f => f.type === val)) { alert('Нельзя удалить: Тип пластика используется в филаментах.'); return; }
            db.plasticTypes.splice(i,1); saveToLocalStorage(); updateAllSelects(); 
        }
        function editFilamentType(i) {
            const newVal = prompt("Изменить тип пластика:", db.plasticTypes[i]);
            if(newVal && newVal.trim() !== "") {
                const oldVal = db.plasticTypes[i];
                db.plasticTypes[i] = newVal.trim();
                db.filaments.forEach(f => { if(f.type === oldVal) f.type = newVal.trim(); });
                saveToLocalStorage(); updateAllSelects();
            }
        }

        // --- Statuses ---
        function addFilamentStatus(){ const v=document.getElementById('newFilamentStatus').value.trim(); if(v && !db.filamentStatuses.includes(v)){ db.filamentStatuses.push(v); document.getElementById('newFilamentStatus').value=''; saveToLocalStorage(); updateAllSelects(); }}
        function removeFilamentStatus(i){ 
             const val = db.filamentStatuses[i];
             if(db.filaments.some(f => f.availability === val)) { alert('Нельзя удалить: Статус используется в филаментах.'); return; }
             db.filamentStatuses.splice(i,1); saveToLocalStorage(); updateAllSelects(); 
        }
        function editFilamentStatus(i) {
            const newVal = prompt("Изменить статус:", db.filamentStatuses[i]);
             if(newVal && newVal.trim() !== "") {
                const oldVal = db.filamentStatuses[i];
                db.filamentStatuses[i] = newVal.trim();
                db.filaments.forEach(f => { if(f.availability === oldVal) f.availability = newVal.trim(); });
                saveToLocalStorage(); updateAllSelects();
            }
        }

        // --- Printers ---
        function addPrinter(){ const m=document.getElementById('newPrinterModel').value.trim(); const p=parseFloat(document.getElementById('newPrinterPower').value); if(m){ db.printers.push({id:Date.now(),model:m,power:p||0}); document.getElementById('newPrinterModel').value=''; saveToLocalStorage(); updateAllSelects(); }}
        function removePrinter(id){ 
             if(db.products.some(p => p.printer && p.printer.id === id)) { alert('Нельзя удалить: Принтер используется в изделиях.'); return; }
             db.printers=db.printers.filter(p=>p.id!==id); saveToLocalStorage(); updateAllSelects(); 
        }
        function editPrinter(id) {
             const p = db.printers.find(x => x.id === id);
             if(!p) return;
             const newModel = prompt("Изменить модель принтера:", p.model);
             if(newModel && newModel.trim() !== "") {
                 const newPowerStr = prompt("Изменить мощность (кВт):", p.power);
                 const newPower = parseFloat(newPowerStr);
                 p.model = newModel.trim();
                 if(!isNaN(newPower)) p.power = newPower;
                 saveToLocalStorage(); updateAllSelects();
             }
        }

        // --- Electricity Costs ---
        function addElectricityCost() {
            const dateInput = document.getElementById('newElectricityDate');
            const costInput = document.getElementById('newElectricityCost');
            const date = dateInput.value;
            const cost = parseFloat(costInput.value);

            if (!date || isNaN(cost) || cost <= 0) {
                alert('Пожалуйста, введите корректную дату и стоимость.');
                return;
            }
            if (db.electricityCosts.some(c => c.date === date)) {
                alert('Тариф на эту дату уже существует. Удалите старый, чтобы добавить новый.');
                return;
            }
            db.electricityCosts.push({ id: Date.now(), date: date, cost: cost });
            dateInput.value = '';
            costInput.value = '';
            
            recalculateAllProductCosts(); // Пересчитываем все
            saveToLocalStorage();
            updateElectricityCostList();
            updateProductsTable(); // Обновляем таблицу, чтобы показать новые цены
        }


        function removeElectricityCost(id) {
            if (db.electricityCosts.length <= 1) {
                alert('Нельзя удалить последний действующий тариф.');
                return;
            }
            if(confirm('Удалить этот тариф?')){
                db.electricityCosts = db.electricityCosts.filter(c => c.id !== id);
                recalculateAllProductCosts(); // Пересчитываем все
                saveToLocalStorage();
                updateElectricityCostList();
                updateProductsTable(); // Обновляем таблицу, чтобы показать новые цены
            }
        }


        function updateElectricityCostList() {
            const listDiv = document.getElementById('electricityCostList');
            if (!listDiv) return;
            
            // Защита: создаем массив, если он отсутствует
            if (!db.electricityCosts) db.electricityCosts = [];

            // Сортировка по дате
            db.electricityCosts.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            listDiv.innerHTML = db.electricityCosts.map(c => {
                // FIX: Принудительно превращаем в число перед .toFixed()
                // Это предотвращает ошибку "c.cost.toFixed is not a function" если там строка
                const val = parseFloat(c.cost); 
                const displayVal = isNaN(val) ? "0.00" : val.toFixed(2);
                
                return `
                <div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
                    <span>С <strong>${escapeHtml(c.date)}</strong> — <strong>${displayVal} ₽/кВт</strong></span>
                    <div class="action-buttons">
                        <button class="btn-danger btn-small" title="Удалить тариф" onclick="removeElectricityCost(${c.id})">✕</button>
                    </div>
                </div>
            `}).join('');
        }


 

        // --- Render Functions with Edit Buttons ---
        
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

        
		function updateFilamentStatusList(){ document.getElementById('filamentStatusList').innerHTML = db.filamentStatuses.map((s,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid #eee;align-items:center;">
            <div style="display:flex; align-items:center;">
                <div class="sort-buttons">
                    <button class="btn-sort" onclick="moveReferenceItemUp('filamentStatuses', ${i})" ${i===0?'disabled':''}>▲</button>
                    <button class="btn-sort" onclick="moveReferenceItemDown('filamentStatuses', ${i})" ${i===db.filamentStatuses.length-1?'disabled':''}>▼</button>
                </div>
                <span>${escapeHtml(s)}</span>
            </div>
            <div class="action-buttons"><button class="btn-secondary btn-small" onclick="editFilamentStatus(${i})">✎</button><button class="btn-danger btn-small" onclick="removeFilamentStatus(${i})">✕</button></div>
        </div>`).join(''); }

        
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



		// ==================== СОРТИРОВКА ====================

		function moveReferenceItemUp(arrayName, index) {
            if (index === 0) return; // Already at the top
            const arr = db[arrayName];
            [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]]; // Swap
            saveToLocalStorage();
            updateAllSelects(); // This will re-render everything
        }

        function moveReferenceItemDown(arrayName, index) {
            const arr = db[arrayName];
            if (index >= arr.length - 1) return; // Already at the bottom
            [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]; // Swap
            saveToLocalStorage();
            updateAllSelects(); // This will re-render everything
        }



        // ==================== REPORTS ====================
        function updateReports() {
            // 1. Init Dates if empty (Default: Start of previous year -> Today)
            const startInput = document.getElementById('reportStartDate');
            const endInput = document.getElementById('reportEndDate');
            
            if (!startInput.value) {
                const prevYear = new Date().getFullYear() - 1;
                startInput.value = `${prevYear}-01-01`;
            }
            if (!endInput.value) {
                endInput.value = new Date().toISOString().split('T')[0];
            }

            // 2. Generate Financial Report
            updateFinancialReport();
            
            // Устаревшие таблицы инвентаризации удалены из HTML, код для них больше не нужен.
        }



		function updateFinancialReport() {
            const dStart = new Date(document.getElementById('reportStartDate').value);
            const dEnd = new Date(document.getElementById('reportEndDate').value);
            dEnd.setHours(23, 59, 59, 999); 

            // --- DATA GATHERING ---
            const filamentsBought = db.filaments.filter(f => {
                const d = new Date(f.date); return d >= dStart && d <= dEnd;
            });
            const sumExpenses = filamentsBought.reduce((sum, f) => sum + (f.actualPrice || 0), 0);

            const writeoffsInRange = db.writeoffs.filter(w => {
                const d = new Date(w.date); return d >= dStart && d <= dEnd;
            });

            const sumRevenue = writeoffsInRange
                .filter(w => w.type === 'Продажа')
                .reduce((sum, w) => sum + (w.total || 0), 0);

            let sumCOGS = 0; 
            let sumCostUsedDefect = 0; 

            writeoffsInRange.forEach(w => {
                const product = db.products.find(p => p.id === w.productId);
                const costOne = product ? (product.costPer1Actual || 0) : 0;
                const totalCost = costOne * w.qty;
                if (w.type === 'Продажа') sumCOGS += totalCost;
                else if (w.type === 'Использовано' || w.type === 'Брак') sumCostUsedDefect += totalCost;
            });

            const defectiveProducts = db.products.filter(p => {
                const d = new Date(p.date); return p.defective === true && d >= dStart && d <= dEnd;
            });
            defectiveProducts.forEach(p => sumCostUsedDefect += (p.costActualPrice || 0));

            // --- ROW GENERATOR ---
            const createRowHtml = (title, desc, expenses, costUsed, revenue, cogs, profit) => {
                const ros = revenue > 0 ? (profit / revenue) * 100 : 0;
                const markup = cogs > 0 ? (profit / cogs) * 100 : 0;
                const fmtMoney = (v) => v !== null ? v.toLocaleString('ru-RU', {style: 'currency', currency: 'RUB'}) : '';
                const fmt = (v) => v ? v.toLocaleString('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
                const pColor = profit > 0 ? 'val-positive' : (profit < 0 ? 'val-negative' : 'val-neutral');

                // ТУТ ВАЖНО: position: relative для td уже задан в CSS.
                // tooltip-container получает ширину auto, чтобы облегать текст.
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
                    <td class="report-val col-ros">${revenue !== null && cogs !== null ? fmt(ros) : ''}</td>
                    <td class="report-val col-markup">${cogs !== null ? fmt(markup) : ''}</td>
                </tr>
                `;
            };

            const tbody = document.querySelector('#financialTable tbody');
            let html = '';

            const profit1 = -sumExpenses + sumRevenue;
            html += createRowHtml(
                'Прибыль, неочищенная от собственных расходов (включая брак и использовано)',
                '<b>Формула:</b><br>Выручка с продаж<br>− Затраты на покупку филамента (в этот период)<br><br>Показывает баланс денежного потока.',
                sumExpenses, null, sumRevenue, null, profit1
            );

            const profit2 = -sumExpenses + sumRevenue + sumCostUsedDefect;
            html += createRowHtml(
                'Прибыль, очищенная от собственных расходов (за минусом брака и использовано)',
                '<b>Формула:</b><br>Выручка с продаж<br>− Затраты на покупку филамента<br>+ Реальная себестоимость (Использовано + Брак)<br><br>Корректирует баланс на сумму внутреннего потребления.',
                sumExpenses, sumCostUsedDefect, sumRevenue, null, profit2
            );

            const profit3 = sumRevenue - sumCOGS;
            html += createRowHtml(
                'Прибыль, только от проданных изделий',
                '<b>Формула:</b><br>Выручка с продаж<br>− Реальная себестоимость проданных изделий<br><br>Валовая прибыль от торговых операций.',
                null, null, sumRevenue, sumCOGS, profit3
            );

            const profit4 = sumRevenue - sumCOGS - sumCostUsedDefect;
            html += createRowHtml(
                'Прибыль, с учетом всех напечатанных изделий',
                '<b>Формула:</b><br>Выручка с продаж<br>− Реальная себестоимость проданных<br>− Реальная себестоимость (Использовано + Брак)<br><br>Чистый результат с учетом всех потерь.',
                null, sumCostUsedDefect, sumRevenue, sumCOGS, profit4
            );

            tbody.innerHTML = html;
        }



        // ==================== STORAGE & UTILS ====================
        
        // Настройка базы данных
        //localforage.config({
        //    driver: localforage.INDEXEDDB, // Принудительно используем IndexedDB
        //   name: '3D_Filament_Manager',
        //    version: 1.0,
        //    storeName: 'main_store', 
        //    description: 'Storage for filament and products data'
        //});

        // Асинхронное сохранение
        async function saveData() {
            try {
                // Создаем глубокую копию, чтобы избежать проблем с ссылками, если нужно
                // Но localForage отлично справляется с JS-объектами
                await localforage.setItem('db_data', db);
                console.log('Данные успешно сохранены в IndexedDB');
            } catch (err) {
                console.error('Ошибка сохранения в IndexedDB:', err);
                alert('Ошибка сохранения данных! Проверьте консоль.');
            }
        }

        // Асинхронная загрузка с миграцией
        async function loadData() {
            try {
                // 1. Попытка загрузить из IndexedDB
                let loadedData = await localforage.getItem('db_data');

                // 2. Если в IndexedDB пусто, проверяем старый localStorage (Миграция)
                if (!loadedData) {
                    console.log('IndexedDB пуста, проверяем localStorage...');
                    const lsData = localStorage.getItem('3d_filament_db');
                    if (lsData) {
                        try {
                            loadedData = JSON.parse(lsData);
                            console.log('Нашли данные в localStorage, выполняем миграцию...');
                            // Сразу сохраняем в новую базу
                            await localforage.setItem('db_data', loadedData);
                            // Опционально: можно очистить localStorage, но для безопасности пока оставим
                            // localStorage.removeItem('3d_filament_db'); 
                        } catch (e) {
                            console.error('Ошибка парсинга localStorage:', e);
                        }
                    }
                }

                // 3. Применение загруженных данных
                if (loadedData) {
                    // Гарантируем, что массивы существуют (восстановление структуры)
                    db.filaments = Array.isArray(loadedData.filaments) ? loadedData.filaments : [];
                    db.products = Array.isArray(loadedData.products) ? loadedData.products : [];
                    db.writeoffs = Array.isArray(loadedData.writeoffs) ? loadedData.writeoffs : [];
                    db.brands = Array.isArray(loadedData.brands) ? loadedData.brands : (db.brands || []);
                    db.colors = Array.isArray(loadedData.colors) ? loadedData.colors : (db.colors || []);
                    db.plasticTypes = Array.isArray(loadedData.plasticTypes) ? loadedData.plasticTypes : (db.plasticTypes || []);
                    db.filamentStatuses = Array.isArray(loadedData.filamentStatuses) ? loadedData.filamentStatuses : (db.filamentStatuses || []);
                    db.printers = Array.isArray(loadedData.printers) ? loadedData.printers : (db.printers || []);
                    
                    // Миграция тарифов электроэнергии (если их не было)
                    if (loadedData.electricityCosts && Array.isArray(loadedData.electricityCosts) && loadedData.electricityCosts.length > 0) {
                        db.electricityCosts = loadedData.electricityCosts;
                    } else {
                        db.electricityCosts = [{ id: Date.now(), date: '2020-01-01', cost: loadedData.costPerKw || 6 }];
                    }

                    // Пересчет вычисляемых полей филамента (на случай сбоев)
                    db.filaments.forEach(f => {
                        if (f.usedLength === undefined) f.usedLength = 0;
                        if (f.usedWeight === undefined) f.usedWeight = 0;
                        f.remainingLength = f.length - f.usedLength;
                    });
                    
                    // Пересчет ID списаний
                    db.writeoffs.forEach(w => {
                        if (!w.systemId) w.systemId = String(w.id);
                    });

                    // Восстановление статусов продуктов
                    db.products.forEach(p => {
                        if (p.inStock === undefined) p.inStock = p.quantity;
                        if (!p.status) p.status = p.availability || 'В наличии полностью';
                        if (!p.type && p.parentId) p.type = 'Часть составного';
                        if (!p.type && !p.parentId) p.type = 'Самостоятельное';
                    });
                    
                    console.log('Данные успешно загружены и применены.');
                } else {
                    console.log('База данных пуста, используем значения по умолчанию.');
                }
            } catch (err) {
                console.error("Критическая ошибка загрузки данных:", err);
                alert("Не удалось загрузить базу данных.");
            }
        }
        
        // Функция-обертка для совместимости, чтобы не менять вызовы по всему коду
        // ВАЖНО: Теперь это просто алиас для новой функции
        function saveToLocalStorage() {
            saveData();
        }

        
        function loadShowChildren() {
            const s = localStorage.getItem('showProductChildren');
            if(s!==null) document.getElementById('showProductChildren').checked = (s==='true');
        }
        function showPage(id) {
            document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
            document.querySelectorAll('.menu-item').forEach(m=>m.classList.remove('active'));
            document.getElementById(id).classList.add('active');
            
            // Find sidebar button to activate (simple approach)
            const menuBtns = document.querySelectorAll('.sidebar .menu-item');
            if (id === 'dashboard') menuBtns[0].classList.add('active');
            if (id === 'filament') menuBtns[1].classList.add('active');
            if (id === 'products') menuBtns[2].classList.add('active');
            if (id === 'writeoff') menuBtns[3].classList.add('active');
            if (id === 'reports') menuBtns[4].classList.add('active');
            if (id === 'references') menuBtns[5].classList.add('active');
        }
		
		
        // --- Image Preview Functions ---
        function showProductImagePreview(element, productId) {
            const product = db.products.find(p => p.id === productId);
            // Проверяем, что картинка есть и это настоящий Blob (бинарные данные)
            if (!product || !product.imageBlob || !(product.imageBlob instanceof Blob)) return;

            const tooltip = document.getElementById('globalImageTooltip');
            const img = document.getElementById('globalImageTooltipImg');
            
            if (tooltip && img) {
                // Создаем временную ссылку на Blob
                const url = URL.createObjectURL(product.imageBlob);
                img.src = url;
                
                // Показываем тултип только когда картинка загрузилась
                img.onload = () => {
                    tooltip.style.display = 'block';
                };
                
                // Сохраняем URL, чтобы потом очистить память
                element.dataset.previewUrl = url;
            }
        }

        function moveProductImagePreview(event) {
            const tooltip = document.getElementById('globalImageTooltip');
            if (tooltip && tooltip.style.display === 'block') {
                const offset = 15;
                let top = event.clientY + offset;
                let left = event.clientX + offset;
                
                // Если тултип уходит за нижний край экрана, показываем его НАД курсором
                if (top + tooltip.offsetHeight > window.innerHeight) {
                    top = event.clientY - tooltip.offsetHeight - offset;
                }
                
                tooltip.style.top = top + 'px';
                tooltip.style.left = left + 'px';
            }
        }

        function hideProductImagePreview(element) {
            const tooltip = document.getElementById('globalImageTooltip');
            const img = document.getElementById('globalImageTooltipImg');
            if (tooltip) {
                tooltip.style.display = 'none';
                if(img) img.src = ''; // Очищаем src
                
                // Очищаем память от Blob URL
                if(element.dataset.previewUrl) {
                    URL.revokeObjectURL(element.dataset.previewUrl);
                    delete element.dataset.previewUrl;
                }
            }
        }

// ==================== EVENT LISTENERS (НОВОЕ: Подключение кнопок) ====================
function setupEventListeners() {
    // 1. Навигация (Боковое меню)
    document.querySelectorAll('.sidebar .menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const pageId = btn.getAttribute('data-page');
            // Обработка кнопок навигации
            if (pageId) {
                showPage(pageId);
            }
            // Обработка кнопок бэкапа (они тоже имеют класс menu-item в HTML)
            else if (btn.id === 'exportBtn') {
                exportData();
            }
            else if (btn.id === 'importBtn') {
                document.getElementById('importFile').click();
            }
        });
    });

    // 2. Бэкап (Загрузка файла)
    const importInput = document.getElementById('importFile');
    if(importInput) importInput.addEventListener('change', function() { importData(this); });

    // 3. Страница Филамента
    document.getElementById('addFilamentBtn')?.addEventListener('click', openFilamentModal);
    document.getElementById('saveFilamentBtn')?.addEventListener('click', saveFilament);
    document.getElementById('closeFilamentModalBtn')?.addEventListener('click', closeFilamentModal);
    
    // Поиск и фильтры филамента
    const filSearch = document.getElementById('filamentSearch');
    if(filSearch) {
        filSearch.addEventListener('input', () => { 
            filterFilaments(); 
            toggleClearButton(filSearch); 
        });
        // Кнопка очистки поиска (крестик)
        filSearch.nextElementSibling?.addEventListener('click', () => clearSearch('filamentSearch', 'filterFilaments'));
    }
    document.getElementById('filamentStatusFilter')?.addEventListener('change', filterFilaments);
    document.getElementById('filamentSortBy')?.addEventListener('change', updateFilamentsTable);
    document.getElementById('resetFilamentFiltersBtn')?.addEventListener('click', resetFilamentFilters);

    // 4. Страница Изделий
    document.getElementById('addProductBtn')?.addEventListener('click', openProductModal);
    document.getElementById('addWriteoffBtn')?.addEventListener('click', openWriteoffModal); // Кнопка "Списать" на стр. изделий
    document.getElementById('saveProductBtn')?.addEventListener('click', () => saveProduct(false));
    document.getElementById('closeProductModalBtn')?.addEventListener('click', closeProductModal);
    
    // Поиск и фильтры изделий
    const prodSearch = document.getElementById('productSearch');
    if(prodSearch) {
        prodSearch.addEventListener('input', () => { 
            filterProducts(); 
            toggleClearButton(prodSearch); 
        });
        prodSearch.nextElementSibling?.addEventListener('click', () => clearSearch('productSearch', 'filterProducts'));
    }
    document.getElementById('productAvailabilityFilter')?.addEventListener('change', filterProducts);
    document.getElementById('productSortBy')?.addEventListener('change', filterProducts);
    document.getElementById('showProductChildren')?.addEventListener('change', filterProducts);
    document.getElementById('resetProductFiltersBtn')?.addEventListener('click', resetProductFilters);

    // 5. Страница Списаний
    document.getElementById('addWriteoffPageBtn')?.addEventListener('click', () => openWriteoffModal());
    document.getElementById('addWriteoffItemBtn')?.addEventListener('click', () => addWriteoffItemSection());
    document.getElementById('saveWriteoffBtn')?.addEventListener('click', saveWriteoff);
    document.getElementById('closeWriteoffModalBtn')?.addEventListener('click', closeWriteoffModal);
    
    const writeSearch = document.getElementById('writeoffSearch');
    if(writeSearch) {
        writeSearch.addEventListener('input', () => { 
            filterWriteoffs(); 
            toggleClearButton(writeSearch); 
        });
        writeSearch.nextElementSibling?.addEventListener('click', () => clearSearch('writeoffSearch', 'filterWriteoffs'));
    }
    document.getElementById('writeoffTypeFilter')?.addEventListener('change', filterWriteoffs);
    document.getElementById('writeoffSortBy')?.addEventListener('change', sortWriteoffs);
    document.getElementById('resetWriteoffFiltersBtn')?.addEventListener('click', resetWriteoffFilters);

    // 6. Отчеты
    document.getElementById('generateReportBtn')?.addEventListener('click', updateFinancialReport);

    // 7. Справочники (Кнопки добавления)
    document.getElementById('addBrandBtn')?.addEventListener('click', addBrand);
    document.getElementById('addColorBtn')?.addEventListener('click', addColor);
    document.getElementById('addFilamentTypeBtn')?.addEventListener('click', addFilamentType);
    document.getElementById('addFilamentStatusBtn')?.addEventListener('click', addFilamentStatus);
    document.getElementById('addPrinterBtn')?.addEventListener('click', addPrinter);
    document.getElementById('addElectricityCostBtn')?.addEventListener('click', addElectricityCost);
}
