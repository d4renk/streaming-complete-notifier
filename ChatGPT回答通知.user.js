// ==UserScript==
// @name         ChatGPT回答通知
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  监听按钮变化，回答完成发通知，并带可拖动+折叠开关+位置记忆
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'chatgptAnswerNotificationEnabled';
    const POSITION_KEY = 'chatgptAnswerNotificationPosition';

    function showNotification() {
        if (Notification.permission === 'granted') {
            new Notification('ChatGPT回答完成', {
                body: '回答已生成完成！',
                icon: 'https://www.svgrepo.com/show/24550/robot.svg'
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    showNotification();
                }
            });
        }
    }

    let isGenerating = false;

    function checkButtonState() {
        const sendButton = document.querySelector('button[data-testid="send-button"]');
        const stopButton = document.querySelector('button[data-testid="stop-button"]');

        if (stopButton) {
            if (!isGenerating) {
                console.log('⚡️ 发现停止按钮，回答生成中...');
                isGenerating = true;
            }
        } else if (sendButton) {
            if (isGenerating) {
                console.log('✅ 发现发送按钮恢复，回答生成完成！');
                isGenerating = false;
                if (getNotificationSetting()) {
                    showNotification();
                } else {
                    console.log('🔕 通知已关闭，跳过');
                }
            }
        }
    }

    function createToggleButton() {
        if (document.getElementById('notificationToggleButton')) {
            return; // 防止重复创建
        }

        const container = document.createElement('div');
        container.id = 'notificationToggleButton';
        container.style.position = 'fixed';
        container.style.zIndex = '9999';
        container.style.padding = '5px 10px';
        container.style.background = '#000';
        container.style.color = '#fff';
        container.style.borderRadius = '5px';
        container.style.cursor = 'grab';
        container.style.fontSize = '14px';
        container.style.userSelect = 'none';
        container.style.transition = 'width 0.3s, padding 0.3s';
        container.style.overflow = 'hidden';
        container.style.width = '30px';
        container.style.textAlign = 'center';
        container.innerText = '⚙️';

        const savedPosition = getSavedPosition();
        container.style.top = savedPosition.top;
        container.style.left = savedPosition.left;

        const fullText = () => getNotificationSetting() ? '🔔 On' : '🔕 Off';

        function expand() {
            container.innerText = fullText();
            container.style.width = 'auto';
            container.style.padding = '5px 10px';
        }

        function collapse() {
            container.innerText = '⚙️';
            container.style.width = '30px';
            container.style.padding = '5px';
        }

        container.addEventListener('mouseenter', expand);
        container.addEventListener('mouseleave', collapse);

        container.addEventListener('click', () => {
            setNotificationSetting(!getNotificationSetting());
            container.innerText = fullText();
        });

        // 拖动逻辑
        let offsetX = 0, offsetY = 0, dragging = false;

        container.addEventListener('mousedown', (e) => {
            dragging = true;
            offsetX = e.clientX - container.getBoundingClientRect().left;
            offsetY = e.clientY - container.getBoundingClientRect().top;
            container.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            container.style.top = `${e.clientY - offsetY}px`;
            container.style.left = `${e.clientX - offsetX}px`;
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                container.style.cursor = 'grab';
                savePosition(container.style.top, container.style.left);
            }
        });

        document.body.appendChild(container);
    }

    function getNotificationSetting() {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    function setNotificationSetting(value) {
        localStorage.setItem(STORAGE_KEY, value);
    }

    function getSavedPosition() {
        const pos = JSON.parse(localStorage.getItem(POSITION_KEY) || '{"top":"10px","left":"10px"}');
        return pos;
    }

    function savePosition(top, left) {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ top, left }));
    }

    const observer = new MutationObserver(() => {
        checkButtonState();
        if (document.querySelector('div.min-w-9')) {
            createToggleButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    checkButtonState();
    if (document.querySelector('div.min-w-9')) {
        createToggleButton();
    }
})();

