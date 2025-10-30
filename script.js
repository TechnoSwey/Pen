let tg = window.Telegram.WebApp;
let activeLots = [];
let soldLots = [];

document.addEventListener('DOMContentLoaded', function() {
    tg.expand();
    tg.enableClosingConfirmation();
    
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        loadLots();
        
        if (isAdmin()) {
            addAdminButton();
        }
    }, 2000);
    
    document.querySelector('.close').addEventListener('click', function() {
        document.getElementById('lot-modal').classList.add('hidden');
    });
    
    document.getElementById('lot-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.add('hidden');
        }
    });
});

function isAdmin() {
    try {
        const user = tg.initDataUnsafe.user;
        const adminId = parseInt('123456789');
        return user && user.id === adminId;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

function addAdminButton() {
    const header = document.querySelector('.header');
    const adminBtn = document.createElement('button');
    adminBtn.className = 'admin-button';
    adminBtn.textContent = 'Админ-панель';
    adminBtn.onclick = showAdminPanel;
    header.appendChild(adminBtn);
}

function showAdminPanel() {
    tg.showPopup({
        title: 'Админ-панель',
        message: 'Выберите действие',
        buttons: [
            { type: 'default', text: 'Создать лот', id: 'create_lot' },
            { type: 'default', text: 'Список лотов', id: 'list_lots' },
            { type: 'cancel', id: 'cancel' }
        ]
    }, function(buttonId) {
        if (buttonId === 'create_lot') {
            createLotFlow();
        } else if (buttonId === 'list_lots') {
            listLots();
        }
    });
}

function createLotFlow() {
    tg.showPopup({
        title: 'Создание лота',
        message: 'Введите название лота:',
        buttons: [{ type: 'default', text: 'Отмена', id: 'cancel' }]
    }, async function(buttonId, input) {
        if (buttonId === 'cancel' || !input) return;
        
        const name = input;
        
        tg.showPopup({
            title: 'Фото лота',
            message: 'Отправьте URL изображения:',
            buttons: [{ type: 'default', text: 'Отмена', id: 'cancel' }]
        }, async function(buttonId, imageUrl) {
            if (buttonId === 'cancel' || !imageUrl) return;
            
            tg.showPopup({
                title: 'Длительность аукциона',
                message: 'Введите длительность в минутах:',
                buttons: [{ type: 'default', text: 'Отмена', id: 'cancel' }]
            }, async function(buttonId, duration) {
                if (buttonId === 'cancel' || !duration) return;
                
                const durationNum = parseInt(duration);
                if (isNaN(durationNum) || durationNum <= 0) {
                    tg.showPopup({
                        title: 'Ошибка',
                        message: 'Введите корректное число минут',
                        buttons: [{ type: 'ok' }]
                    });
                    return;
                }
                
                try {
                    const response = await fetch('/admin/create_lot', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Telegram-Init-Data': tg.initData || ''
                        },
                        body: JSON.stringify({
                            name: name,
                            image_url: imageUrl,
                            auction_duration: durationNum
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        tg.showPopup({
                            title: 'Успех',
                            message: `Лот "${name}" создан!`,
                            buttons: [{ type: 'ok' }]
                        });
                        loadLots();
                    } else {
                        tg.showPopup({
                            title: 'Ошибка',
                            message: result.error || 'Неизвестная ошибка',
                            buttons: [{ type: 'ok' }]
                        });
                    }
                } catch (error) {
                    console.error('Error creating lot:', error);
                    tg.showPopup({
                        title: 'Ошибка',
                        message: 'Ошибка при создании лота',
                        buttons: [{ type: 'ok' }]
                    });
                }
            });
        });
    });
}

async function listLots() {
    try {
        const response = await fetch('/admin/list_lots', {
            headers: {
                'X-Telegram-Init-Data': tg.initData || ''
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            let message = 'Активные лоты:\n';
            result.active_lots.forEach(lot => {
                message += `\n${lot.name} - ${lot.current_price} ⭐ (до ${new Date(lot.deadline).toLocaleString()})`;
            });
            
            message += '\n\nПроданные лоты:\n';
            result.sold_lots.forEach(lot => {
                message += `\n${lot.name} - ${lot.current_price} ⭐ (${new Date(lot.sold_at).toLocaleString()})`;
            });
            
            tg.showPopup({
                title: 'Список лотов',
                message: message,
                buttons: [{ type: 'ok' }]
            });
        } else {
            tg.showPopup({
                title: 'Ошибка',
                message: result.error,
                buttons: [{ type: 'ok' }]
            });
        }
    } catch (error) {
        tg.showPopup({
            title: 'Ошибка',
            message: 'Ошибка при загрузке списка лотов',
            buttons: [{ type: 'ok' }]
        });
    }
}

async function loadLots() {
    try {
        showLoading(true);
        const response = await fetch('/api/lots');
        const data = await response.json();
        
        if (data.success) {
            activeLots = data.active_lots || [];
            soldLots = data.sold_lots || [];
            
            renderActiveLots();
            renderSoldLots();
            startTimers();
        } else {
            console.error('Error loading lots:', data.error);
            tg.showPopup({
                title: 'Ошибка',
                message: 'Не удалось загрузить лоты',
                buttons: [{ type: 'ok' }]
            });
        }
    } catch (error) {
        console.error('Error loading lots:', error);
        tg.showPopup({
            title: 'Ошибка',
            message: 'Ошибка соединения',
            buttons: [{ type: 'ok' }]
        });
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    const containers = document.getElementById('active-lots');
    if (show) {
        containers.innerHTML = '<div class="loading">Загрузка...</div>';
    }
}

function renderActiveLots() {
    const container = document.getElementById('active-lots');
    container.innerHTML = '';
    
    if (activeLots.length === 0) {
        container.innerHTML = '<div class="no-lots">Нет активных аукционов</div>';
        return;
    }
    
    activeLots.forEach(lot => {
        const lotElement = createLotElement(lot, false);
        container.appendChild(lotElement);
    });
}

function renderSoldLots() {
    const container = document.getElementById('sold-lots');
    container.innerHTML = '';
    
    if (soldLots.length === 0) {
        container.innerHTML = '<div class="no-lots">Нет проданных лотов</div>';
        return;
    }
    
    const recentSoldLots = soldLots.slice(0, 50);
    
    recentSoldLots.forEach(lot => {
        const lotElement = createLotElement(lot, true);
        container.appendChild(lotElement);
    });
}

function createLotElement(lot, isSold) {
    const lotCard = document.createElement('div');
    lotCard.className = 'lot-card';
    lotCard.dataset.id = lot.id;
    
    const timeLeft = isSold ? '' : formatTimeLeft(lot.deadline);
    const displayPrice = isSold ? lot.current_price : (lot.current_price + 1);
    const bidderName = isSold ? 
        (lot.winner_username || lot.winner_first_name || 'Неизвестно') :
        (lot.last_bidder_username || lot.last_bidder_first_name || 'Нет ставок');
    
    lotCard.innerHTML = `
        <img src="${lot.image_url}" alt="${lot.name}" class="lot-image" onerror="this.src=&quot;https://via.placeholder.com/60?text=No+Image&quot;">
        <div class="lot-info">
            <div class="lot-name">${lot.name}</div>
            <div class="lot-price">${displayPrice} ⭐</div>
            ${!isSold ? '<div class="lot-bidder">' + bidderName + '</div>' : ''}
            ${!isSold ? '<div class="lot-timer">' + timeLeft + '</div>' : ''}
        </div>
        ${isSold ? '<div class="sold-badge">SOLD</div>' : ''}
    `;
    
    if (!isSold) {
        lotCard.addEventListener('click', () => openLotModal(lot));
    } else {
        lotCard.addEventListener('click', () => openSoldLotModal(lot));
    }
    
    return lotCard;
}

function formatTimeLeft(deadline) {
    if (!deadline) return 'Ожидание ставки';
    
    const now = new Date();
    const end = new Date(deadline);
    const diff = end - now;
    
    if (diff <= 0) return 'Аукцион завершен';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function startTimers() {
    if (window.lotTimers) {
        window.lotTimers.forEach(clearInterval);
    }
    
    window.lotTimers = [];
    
    const updateTimers = () => {
        const timerElements = document.querySelectorAll('.lot-timer');
        const now = new Date();
        
        activeLots.forEach((lot, index) => {
            if (timerElements[index]) {
                const timeLeft = formatTimeLeft(lot.deadline);
                timerElements[index].textContent = timeLeft;
                
                if (timeLeft === 'Аукцион завершен') {
                    setTimeout(() => loadLots(), 2000);
                }
            }
        });
    };
    
    updateTimers();
    const timerId = setInterval(updateTimers, 1000);
    window.lotTimers.push(timerId);
}

function openLotModal(lot) {
    const modal = document.getElementById('lot-modal');
    const details = document.getElementById('lot-details');
    
    const now = new Date();
    const end = new Date(lot.deadline);
    const isAuctionEnded = now >= end;
    const bidAmount = lot.current_price + 1;
    const bidderName = lot.last_bidder_username || lot.last_bidder_first_name || 'Нет';
    
    details.innerHTML = `
        <h3>${lot.name}</h3>
        <img src="${lot.image_url}" alt="${lot.name}" onerror="this.src=&quot;https://via.placeholder.com/300?text=No+Image&quot;">
        <div class="lot-status ${isAuctionEnded ? 'status-ended' : 'status-active'}">
            ${isAuctionEnded ? 'Аукцион завершен' : 'Аукцион активен'}
        </div>
        
        <div class="current-bid">
            Текущая ставка: <strong>${lot.current_price} ⭐</strong>
        </div>
        
        <div class="next-bid">
            Следующая ставка: <strong>${bidAmount} ⭐</strong>
        </div>
        
        <div class="bidder-info">
            Текущий победитель: <strong>${bidderName}</strong>
        </div>
        
        <div class="time-left">
            Осталось времени: <strong>${formatTimeLeft(lot.deadline)}</strong>
        </div>
        
        <div class="bid-history">
            <h4>История ставок:</h4>
            ${lot.bid_history && lot.bid_history.length > 0 
                ? lot.bid_history.slice().reverse().map(bid => `
                    <div class="bid-item">
                        ${bid.username || bid.first_name || 'Аноним'}: ${bid.amount} ⭐ 
                        (${new Date(bid.timestamp).toLocaleString()})
                    </div>
                `).join('')
                : '<p>Ставок пока нет</p>'
            }
        </div>
        
        <button class="bid-button" ${isAuctionEnded ? 'disabled' : ''} onclick="initiateBid(${lot.id}, ${bidAmount})">
            Перебить цену - ${bidAmount} ⭐
        </button>
    `;
    
    modal.classList.remove('hidden');
}

function openSoldLotModal(lot) {
    const modal = document.getElementById('lot-modal');
    const details = document.getElementById('lot-details');
    
    const winnerName = lot.winner_username || lot.winner_first_name || 'Неизвестно';
    
    details.innerHTML = `
        <h3>${lot.name}</h3>
        <img src="${lot.image_url}" alt="${lot.name}" onerror="this.src=&quot;https://via.placeholder.com/300?text=No+Image&quot;">
        <div class="lot-status status-ended">Подарок выкуплен</div>
        
        <div class="final-price">
            Финальная цена: <strong>${lot.current_price} ⭐</strong>
        </div>
        
        <div class="winner-info">
            Победитель: <strong>${winnerName}</strong>
        </div>
        
        <div class="sold-time">
            Время завершения: <strong>${new Date(lot.sold_at).toLocaleString()}</strong>
        </div>
        
        <div class="bid-history">
            <h4>История ставок:</h4>
            ${lot.bid_history && lot.bid_history.length > 0 
                ? lot.bid_history.slice().reverse().map(bid => `
                    <div class="bid-item">
                        ${bid.username || bid.first_name || 'Аноним'}: ${bid.amount} ⭐ 
                        (${new Date(bid.timestamp).toLocaleString()})
                    </div>
                `).join('')
                : '<p>Ставок не было</p>'
            }
        </div>
    `;
    
    modal.classList.remove('hidden');
}

async function initiateBid(lotId, bidAmount) {
    try {
        const response = await fetch(`/api/lot/${lotId}`);
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        const lot = result.lot;
        const user = tg.initDataUnsafe.user;
        
        const confirm = await tg.showConfirm(
            `Вы точно хотите приобрести "${lot.name}" за ${bidAmount} звёзд?`,
            'Подтверждение покупки'
        );
        
        if (!confirm) return;
        
        tg.openInvoice(
            `bid_${lotId}_${Date.now()}_${user.id}`,
            {
                title: `Ставка на ${lot.name}`,
                description: `Перебив ставки на аукционе для лота "${lot.name}"`,
                payload: JSON.stringify({
                    lot_id: lotId,
                    bid_amount: bidAmount,
                    user_id: user.id,
                    username: user.username,
                    first_name: user.first_name
                }),
                currency: 'XTR',
                prices: [
                    {
                        label: `Ставка ${bidAmount} звёзд`,
                        amount: bidAmount * 100
                    }
                ]
            },
            async function(status) {
                if (status === 'paid') {
                    try {
                        const bidResponse = await fetch('/api/place_bid', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                lot_id: lotId,
                                user_id: user.id,
                                username: user.username,
                                first_name: user.first_name
                            }),
                        });
                        
                        const bidResult = await bidResponse.json();
                        
                        if (bidResult.success) {
                            document.getElementById('lot-modal').classList.add('hidden');
                            loadLots();
                            
                            tg.showPopup({
                                title: 'Успех',
                                message: 'Ставка успешно размещена!',
                                buttons: [{ type: 'ok' }]
                            });
                        } else {
                            tg.showPopup({
                                title: 'Ошибка',
                                message: bidResult.error || 'Не удалось разместить ставку',
                                buttons: [{ type: 'ok' }]
                            });
                            
                            console.error('Bid placement failed after payment:', bidResult.error);
                        }
                    } catch (error) {
                        console.error('Error placing bid after payment:', error);
                        tg.showPopup({
                            title: 'Ошибка',
                            message: 'Ошибка при размещении ставки после оплаты',
                            buttons: [{ type: 'ok' }]
                        });
                    }
                } else if (status === 'failed') {
                    tg.showPopup({
                        title: 'Ошибка',
                        message: 'Не удалось完成 платеж',
                        buttons: [{ type: 'ok' }]
                    });
                } else if (status === 'cancelled') {
                    console.log('Payment cancelled by user');
                }
            }
        );
    } catch (error) {
        console.error('Error initiating bid:', error);
        tg.showPopup({
            title: 'Ошибка',
            message: 'Произошла ошибка при размещении ставки',
            buttons: [{ type: 'ok' }]
        });
    }
}

document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('lot-image')) {
        e.target.src = 'https://via.placeholder.com/60?text=No+Image';
    }
}, true);
