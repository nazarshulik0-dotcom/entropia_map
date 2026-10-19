/**
 * =======================================================================
 * ENTROPIA ARCHIPELAGO BRIDGE (entropia_bridge.js) - v2.0
 * Офіційний міст між Листом Персонажа (character_sheet),
 * Глобальною картою (index.html), Секторами (sectorX.html) та Зонами (ZONA.html)
 * =======================================================================
 */

(function (window) {
    'use strict';

    const CONFIG = {
        CHANNEL_NAME: 'entropia_ark_sync_channel',
        STORAGE_CHAR_KEY: 'entropia_active_character',
        STORAGE_ALL_CHARS_KEY: 'entropia_all_characters',
        STORAGE_ROLE_KEY: 'entropia_user_role',
        ADMIN_PASS: 'ентропія',
        MQTT_TOPIC_DICE: 'entropia_ark_317/vitruvia_dice_v1'
    };

    class EntropiaBridgeCore {
        constructor() {
            this.broadcast = null;
            this.character = null;
            this.allCharacters = [];
            this.role = this.detectRole();
            this.listeners = {
                characterUpdate: [],
                allCharactersSync: [],
                roleChange: [],
                diceRoll: []
            };

            // 1. Ініціалізація каналів зв'язку
            this.initBroadcastChannel();
            this.initPostMessageListener();
            this.initStorageListener();

            // 2. Спроба завантажити кешовані дані
            this.loadCachedData();

            console.log(`%c[Entropia Bridge v2.0]%c Активний. Роль: %c${this.role.toUpperCase()}%c`, 
                'background: #10b981; color: #000; font-weight: bold; border-radius: 3px; padding: 2px 5px;',
                'color: #94a3b8;',
                'color: #38bdf8; font-weight: bold;',
                'color: #94a3b8;'
            );

            // 3. Відправляємо запит до Листа Персонажа (рукостискання)
            this.requestCharacterSync();
        }

        // --- ВИЗНАЧЕННЯ РОЛІ (МАЙСТЕР / ГРАВЕЦЬ) ---
        detectRole() {
            const urlParams = new URLSearchParams(window.location.search);
            const hash = window.location.hash.toLowerCase();
            const roleParam = (urlParams.get('role') || '').toLowerCase();
            const modeParam = (urlParams.get('mode') || '').toLowerCase();
            const adminParam = (urlParams.get('admin') || '').toLowerCase();

            // Перевірка патернів із character_sheet: ?role=gm&mode=admin&admin=true#admin
            if (
                roleParam === 'gm' || 
                modeParam === 'admin' || 
                adminParam === 'true' || 
                hash.includes('admin') || 
                hash.includes('gm')
            ) {
                this.saveRole('gm');
                return 'gm';
            }

            // Перевірка збереженого значення
            const savedRole = sessionStorage.getItem(CONFIG.STORAGE_ROLE_KEY) || localStorage.getItem(CONFIG.STORAGE_ROLE_KEY);
            if (savedRole === 'gm') {
                return 'gm';
            }

            return 'player';
        }

        isGM() {
            return this.role === 'gm';
        }

        verifyAdminPassword(inputPass) {
            const clean = String(inputPass || '').trim().toLowerCase()
                .replace(/e/g, 'е').replace(/i/g, 'і').replace(/o/g, 'о').replace(/p/g, 'р').replace(/a/g, 'а').replace(/c/g, 'с');
            if (clean === CONFIG.ADMIN_PASS) {
                this.setRole('gm');
                return true;
            }
            return false;
        }

        setRole(newRole) {
            this.role = (newRole === 'gm' || newRole === 'master') ? 'gm' : 'player';
            this.saveRole(this.role);
            this.triggerListeners('roleChange', this.role);
        }

        saveRole(role) {
            localStorage.setItem(CONFIG.STORAGE_ROLE_KEY, role);
            sessionStorage.setItem(CONFIG.STORAGE_ROLE_KEY, role);
        }

        // --- ЗАПИТ СИНХРОНІЗАЦІЇ (HANDSHAKE) ---
        requestCharacterSync() {
            const packet = { type: 'REQUEST_CHARACTER_SYNC' };
            if (this.broadcast) {
                this.broadcast.postMessage(packet);
            }
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(packet, '*');
            }
        }

        // --- КЕШУВАННЯ ТА ДАНІ ---
        loadCachedData() {
            try {
                const savedChar = localStorage.getItem(CONFIG.STORAGE_CHAR_KEY);
                if (savedChar) this.character = JSON.parse(savedChar);

                const savedAll = localStorage.getItem(CONFIG.STORAGE_ALL_CHARS_KEY);
                if (savedAll) this.allCharacters = JSON.parse(savedAll);
            } catch (e) {
                console.warn('[Bridge] Помилка читання кешу:', e);
            }
        }

        getCharacter() {
            return this.character;
        }

        getAllCharacters() {
            return this.allCharacters;
        }

        // --- ОБРОБКА ПОВІДОМЛЕНЬ ВІД CHARACTER_SHEET ---
        handleIncomingData(data) {
            if (!data || typeof data !== 'object') return;

            // Оновлення окремого активного персонажа
            if (data.type === 'CHARACTER_UPDATE' && data.character) {
                this.character = data.character;
                localStorage.setItem(CONFIG.STORAGE_CHAR_KEY, JSON.stringify(this.character));
                sessionStorage.setItem(CONFIG.STORAGE_CHAR_KEY, JSON.stringify(this.character));

                if (data.role) {
                    this.role = data.role === 'gm' ? 'gm' : this.role;
                }

                this.triggerListeners('characterUpdate', this.character);
            }

            // Оновлення масиву всіх персонажів кімнати
            if (data.type === 'ALL_CHARACTERS_SYNC' && Array.isArray(data.characters)) {
                this.allCharacters = data.characters;
                localStorage.setItem(CONFIG.STORAGE_ALL_CHARS_KEY, JSON.stringify(this.allCharacters));
                this.triggerListeners('allCharactersSync', this.allCharacters);
            }
        }

        // --- МЕРЕЖЕВІ СЛУХАЧІ ---
        initBroadcastChannel() {
            if ('BroadcastChannel' in window) {
                this.broadcast = new BroadcastChannel(CONFIG.CHANNEL_NAME);
                this.broadcast.onmessage = (event) => this.handleIncomingData(event.data);
            }
        }

        initPostMessageListener() {
            window.addEventListener('message', (event) => {
                this.handleIncomingData(event.data);
            });
        }

        initStorageListener() {
            window.addEventListener('storage', (event) => {
                if (event.key === CONFIG.STORAGE_CHAR_KEY && event.newValue) {
                    try {
                        this.character = JSON.parse(event.newValue);
                        this.triggerListeners('characterUpdate', this.character);
                    } catch (e) {}
                }
            });
        }

        // --- СИСТЕМА ПІДПИСОК (EVENT LISTENERS) ---
        on(event, callback) {
            if (this.listeners[event]) {
                this.listeners[event].push(callback);
            }
        }

        triggerListeners(event, data) {
            if (this.listeners[event]) {
                this.listeners[event].forEach(fn => {
                    try { fn(data); } catch (e) { console.error(e); }
                });
            }
        }
    }

    // Створюємо глобальний об'єкт у вікні браузера
    window.EntropiaBridge = new EntropiaBridgeCore();

})(window);