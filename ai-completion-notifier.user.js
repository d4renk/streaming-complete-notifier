// ==UserScript==
// @name         AI 回答完成提醒器 (Gemini & ChatGPT & AI Studio)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  当 Gemini、ChatGPT 或 AI Studio 完成回答生成时,发送桌面通知和声音提醒。支持 ChatGPT 思考完成检测。
// @author       Your Name
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://aistudio.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_getResourceURL
// @resource     notificationSound data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v////////////////////////////////////////////////////////////////AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4SL6cqLAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+xDEKQPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+xDEUQPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+xDEWQPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+xDEYAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
// @run-at       document-start
// @connect      gemini.google.com
// @connect      chatgpt.com
// @connect      aistudio.google.com
// @connect      clients6.google.com
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================
    // 第一部分:平台配置
    // ===========================================

    const PLATFORMS = [
        {
            id: 'gemini',
            name: 'Gemini',
            enabledKey: 'geminiEnabled',
            hosts: ['gemini.google.com'],
            match: {
                method: 'POST',
                pathPattern: /\/((?:Stream)?Generate(?:Content|Answer)?(?:V2)?|v\d+(?:beta)?\/.*:(?:generateContent|streamGenerateContent))/i
            },
            detection: { type: 'request-complete' },
            notify: {
                title: 'Gemini 生成完成',
                message: '当前页面的回答已生成完成。',
                targetUrl: 'https://gemini.google.com/app'
            },
            throttleMs: 2000
        },
        {
            id: 'chatgpt',
            name: 'ChatGPT',
            enabledKey: 'chatgptEnabled',
            hosts: ['chatgpt.com'],
            match: {
                method: 'POST',
                pathPattern: '/backend-api/f/conversation'
            },
            detection: {
                type: 'sse-stream',
                trackStart: true
            },
            streamEvents: {
                reasoningEnd: {
                    enabledKey: 'chatgptReasoningEndEnabled',
                    notify: {
                        title: 'ChatGPT 思考完成',
                        message: '思考阶段已结束,正在生成回答...',
                        targetUrl: 'https://chatgpt.com/'
                    },
                    throttleMs: 2000
                }
            },
            followup: {
                pathPattern: '/backend-api/lat/r',
                minDelayMs: 10000
            },
            notify: {
                title: 'ChatGPT 生成完成',
                message: '检测到 ChatGPT 的生成流已结束。',
                targetUrl: 'https://chatgpt.com/'
            },
            throttleMs: 4000
        },
        {
            id: 'aistudio',
            name: 'AI Studio',
            enabledKey: 'aistudioEnabled',
            hosts: ['aistudio.google.com', '*.clients6.google.com'],
            match: {
                method: 'POST',
                urlPattern: /^https:\/\/[\w.-]*clients6\.google\.com\/\$rpc\/google\.internal\.alkali\.applications\.makersuite\.v1\.MakerSuiteService\/(CreatePrompt|UpdatePrompt)$/
            },
            detection: { type: 'request-complete' },
            notify: {
                title: 'AI Studio 生成完成',
                message: 'AI Studio 的回答已生成完成。',
                targetUrl: 'https://aistudio.google.com/'
            },
            throttleMs: 2000
        }
    ];

    // ===========================================
    // 第二部分:常量与状态管理
    // ===========================================

    const DEFAULT_VOLUME = 1;
    const MAX_VOLUME = 1.5;

    // 状态存储
    const requestState = new Map();
    const lastNotifyAt = new Map();
    const lastStartAt = new Map();

    // 音频元素
    let audioElement = null;

    // ===========================================
    // 第三部分:工具函数
    // ===========================================

    function stateKey(platformId, tabId = 'main') {
        return `${platformId}:${tabId}`;
    }

    function clampVolume(value) {
        const numeric = typeof value === 'number' ? value : parseFloat(value);
        if (Number.isNaN(numeric)) return DEFAULT_VOLUME;
        return Math.min(Math.max(numeric, 0), MAX_VOLUME);
    }

    function matchPath(pathname, pattern) {
        if (typeof pattern === 'string') {
            return pathname === pattern;
        }
        if (pattern instanceof RegExp) {
            return pattern.test(pathname);
        }
        return false;
    }

    function findPlatformForRequest(url, method, detectionTypeFilter = null) {
        let urlObj;
        try {
            urlObj = new URL(url);
        } catch {
            return null;
        }

        for (const platform of PLATFORMS) {
            if (detectionTypeFilter && platform.detection.type !== detectionTypeFilter) {
                continue;
            }

            if (platform.match.method && method !== platform.match.method) {
                continue;
            }

            if (platform.match.urlPattern) {
                if (platform.match.urlPattern.test(url)) {
                    return platform;
                }
                continue;
            }

            const hostMatch = platform.hosts.some(host => {
                if (host.startsWith('*.')) {
                    return urlObj.hostname.endsWith(host.slice(1)) || urlObj.hostname === host.slice(2);
                }
                return urlObj.hostname === host;
            });
            if (!hostMatch) continue;

            if (platform.match.pathPattern) {
                if (matchPath(urlObj.pathname, platform.match.pathPattern)) {
                    return platform;
                }
            }
        }

        return null;
    }

    function findPlatformForFollowup(url) {
        let urlObj;
        try {
            urlObj = new URL(url);
        } catch {
            return null;
        }

        for (const platform of PLATFORMS) {
            if (!platform.followup) continue;

            const hostMatch = platform.hosts.some(host => {
                if (host.startsWith('*.')) {
                    return urlObj.hostname.endsWith(host.slice(1)) || urlObj.hostname === host.slice(2);
                }
                return urlObj.hostname === host;
            });
            if (!hostMatch) continue;

            if (matchPath(urlObj.pathname, platform.followup.pathPattern)) {
                return platform;
            }
        }

        return null;
    }

    // ===========================================
    // 第四部分:节流
    // ===========================================

    function isThrottled(platformId, ms, suffix = '') {
        const key = stateKey(platformId) + suffix;
        const now = Date.now();
        const last = lastNotifyAt.get(key) || 0;
        if (now - last < ms) return true;
        lastNotifyAt.set(key, now);
        return false;
    }

    // ===========================================
    // 第五部分:设置管理
    // ===========================================

    function getSetting(key, defaultValue) {
        const value = GM_getValue(key);
        return value !== undefined ? value : defaultValue;
    }

    function setSetting(key, value) {
        GM_setValue(key, value);
    }

    // ===========================================
    // 第六部分:音频播放
    // ===========================================

    function initAudio() {
        if (audioElement) return;

        // 创建简单的提示音 (440Hz beep)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 440;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);

        audioElement = { audioContext, oscillator, gainNode };
    }

    function playNotificationSound() {
        try {
            const volume = clampVolume(getSetting('soundVolume', DEFAULT_VOLUME));
            if (volume === 0) return;

            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 880; // A5 音符
            oscillator.type = 'sine';

            const now = audioContext.currentTime;
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

            oscillator.start(now);
            oscillator.stop(now + 0.3);

            console.log('[AI-Notifier] 播放提示音,音量:', volume);
        } catch (error) {
            console.error('[AI-Notifier] 播放音频失败:', error);
        }
    }

    // ===========================================
    // 第七部分:通知系统
    // ===========================================

    async function sendNotification(platform, options = {}) {
        try {
            const settings = getSetting(platform.enabledKey, true);
            if (!settings) return;

            const { title, message } = platform.notify;

            // 请求通知权限
            if (Notification.permission === 'default') {
                await Notification.requestPermission();
            }

            if (Notification.permission === 'granted') {
                const notification = new Notification(title, {
                    body: message,
                    icon: 'https://www.google.com/favicon.ico',
                    tag: 'ai-completion-' + platform.id,
                    requireInteraction: false
                });

                // 8秒后自动关闭
                setTimeout(() => notification.close(), 8000);

                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };
            }

            playNotificationSound();
        } catch (e) {
            console.error('[AI-Notifier] 发送通知失败:', e);
        }
    }

    // ===========================================
    // 第八部分:XHR/Fetch 拦截
    // ===========================================

    // 拦截 XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._method = method;
        this._url = url;
        return originalXHROpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const method = this._method;
        const url = this._url;

        // 检查是否匹配平台配置
        const platform = findPlatformForRequest(url, method);

        if (platform) {
            const requestId = Math.random().toString(36);

            if (platform.detection.type === 'sse-stream') {
                // SSE 流检测
                requestState.set(requestId, {
                    platformId: platform.id,
                    startTime: Date.now()
                });

                if (platform.detection.trackStart) {
                    const key = stateKey(platform.id);
                    lastStartAt.set(key, Date.now());
                }

                this.addEventListener('readystatechange', function() {
                    if (this.readyState === 4) {
                        const contentType = this.getResponseHeader('content-type') || '';
                        if (contentType.includes('text/event-stream')) {
                            // SSE 流结束
                            if (!isThrottled(platform.id, platform.throttleMs)) {
                                sendNotification(platform);
                            }
                        }
                        requestState.delete(requestId);
                    }
                });
            } else if (platform.detection.type === 'request-complete') {
                // 普通请求完成检测
                this.addEventListener('load', function() {
                    if (this.status >= 200 && this.status < 300) {
                        if (!isThrottled(platform.id, platform.throttleMs)) {
                            sendNotification(platform);
                        }
                    }
                });
            }
        }

        // 检查 followup 请求
        const followupPlatform = findPlatformForFollowup(url);
        if (followupPlatform) {
            this.addEventListener('load', function() {
                const key = stateKey(followupPlatform.id);
                const startTime = lastStartAt.get(key);
                const now = Date.now();

                if (startTime && (now - startTime > followupPlatform.followup.minDelayMs)) {
                    if (!isThrottled(followupPlatform.id, followupPlatform.throttleMs)) {
                        sendNotification(followupPlatform);
                    }
                    lastStartAt.delete(key);
                }
            });
        }

        return originalXHRSend.call(this, ...args);
    };

    // 拦截 Fetch API (包含 SSE 流事件解析)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);

        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (!url) return response;

        const method = args[1]?.method || 'GET';

        // 检查 ChatGPT SSE 流
        const isConversationAPI = url.includes('/backend-api/f/conversation') ||
                                   url.includes('/backend-api/conversation');
        const contentType = response.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        if (isConversationAPI && isSSE && response.body) {
            // 克隆流以便解析
            const [originalStream, tapStream] = response.body.tee();

            // 异步解析 SSE 流事件
            parseSSEStream(tapStream, url);

            // 返回原始流
            return new Response(originalStream, {
                headers: response.headers,
                status: response.status,
                statusText: response.statusText
            });
        }

        // 常规平台检测
        const platform = findPlatformForRequest(url, method);

        if (platform) {
            if (platform.detection.type === 'request-complete') {
                response.clone().text().then(() => {
                    if (response.ok && !isThrottled(platform.id, platform.throttleMs)) {
                        sendNotification(platform);
                    }
                }).catch(() => {});
            } else if (platform.detection.type === 'sse-stream') {
                // 记录开始时间
                if (platform.detection.trackStart) {
                    const key = stateKey(platform.id);
                    lastStartAt.set(key, Date.now());
                }

                // 克隆响应以监听流结束
                const clone = response.clone();
                clone.body.getReader().read().then(function processStream({ done }) {
                    if (done) {
                        if (!isThrottled(platform.id, platform.throttleMs)) {
                            sendNotification(platform);
                        }
                    }
                }).catch(() => {});
            }
        }

        // 检查 followup
        const followupPlatform = findPlatformForFollowup(url);
        if (followupPlatform) {
            response.clone().text().then(() => {
                const key = stateKey(followupPlatform.id);
                const startTime = lastStartAt.get(key);
                const now = Date.now();

                if (startTime && (now - startTime > followupPlatform.followup.minDelayMs)) {
                    if (!isThrottled(followupPlatform.id, followupPlatform.throttleMs)) {
                        sendNotification(followupPlatform);
                    }
                    lastStartAt.delete(key);
                }
            }).catch(() => {});
        }

        return response;
    };

    // ===========================================
    // 第九部分:ChatGPT SSE 流解析
    // ===========================================

    async function parseSSEStream(stream, url) {
        try {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let isReasoning = false;
            let reasoningStartTime = null;
            let hasEmittedReasoningEnd = false;

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                buffer = buffer.replace(/\r\n/g, '\n');

                let idx;
                while ((idx = buffer.indexOf('\n\n')) >= 0) {
                    const message = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);

                    // 解析 SSE 消息
                    if (message.startsWith(': ping')) continue;

                    let dataLine = '';
                    const lines = message.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            dataLine = line.slice(5).trim();
                        }
                    }

                    if (!dataLine || dataLine === '[DONE]') continue;

                    try {
                        const obj = JSON.parse(dataLine);
                        const data = obj.v?.message || obj.message || obj;
                        const metadata = data.metadata || {};
                        const reasoningStatus = metadata.reasoning_status;

                        // 检测思考开始
                        if (reasoningStatus === 'is_reasoning' && !isReasoning) {
                            isReasoning = true;
                            reasoningStartTime = Date.now();
                            hasEmittedReasoningEnd = false;
                        }

                        // 检测思考结束
                        if (reasoningStatus === 'reasoning_ended' && !hasEmittedReasoningEnd) {
                            hasEmittedReasoningEnd = true;
                            const duration = reasoningStartTime
                                ? Math.round((Date.now() - reasoningStartTime) / 1000)
                                : metadata.finished_duration_sec || 0;

                            // 发送思考完成通知
                            const chatgptPlatform = PLATFORMS.find(p => p.id === 'chatgpt');
                            if (chatgptPlatform?.streamEvents?.reasoningEnd) {
                                const config = chatgptPlatform.streamEvents.reasoningEnd;
                                const mainEnabled = getSetting(chatgptPlatform.enabledKey, true);
                                const subEnabled = getSetting(config.enabledKey, true);

                                if (mainEnabled && subEnabled) {
                                    if (!isThrottled(chatgptPlatform.id, config.throttleMs, ':reasoning')) {
                                        const durationText = duration ? `(思考了 ${duration} 秒)` : '';

                                        if (Notification.permission === 'granted') {
                                            const notification = new Notification(config.notify.title, {
                                                body: config.notify.message + durationText,
                                                icon: 'https://www.google.com/favicon.ico',
                                                tag: 'chatgpt-reasoning',
                                                requireInteraction: false
                                            });

                                            setTimeout(() => notification.close(), 8000);

                                            notification.onclick = () => {
                                                window.focus();
                                                notification.close();
                                            };
                                        }

                                        playNotificationSound();
                                    }
                                }
                            }
                        }

                        // 检测开始输出
                        if (obj.marker === 'user_visible_token' && obj.event === 'first') {
                            isReasoning = false;
                            reasoningStartTime = null;
                        }
                    } catch (e) {
                        // 解析错误,忽略
                    }
                }
            }
        } catch (e) {
            console.error('[AI-Notifier] SSE 流解析错误:', e);
        }
    }

    // ===========================================
    // 第十部分:设置菜单
    // ===========================================

    function createSettingsMenu() {
        GM_registerMenuCommand('🔔 Gemini 通知 [' + (getSetting('geminiEnabled', true) ? '开' : '关') + ']', () => {
            const current = getSetting('geminiEnabled', true);
            setSetting('geminiEnabled', !current);
            alert('Gemini 通知已' + (!current ? '开启' : '关闭'));
            location.reload();
        });

        GM_registerMenuCommand('🔔 ChatGPT 通知 [' + (getSetting('chatgptEnabled', true) ? '开' : '关') + ']', () => {
            const current = getSetting('chatgptEnabled', true);
            setSetting('chatgptEnabled', !current);
            alert('ChatGPT 通知已' + (!current ? '开启' : '关闭'));
            location.reload();
        });

        GM_registerMenuCommand('🧠 ChatGPT 思考完成通知 [' + (getSetting('chatgptReasoningEndEnabled', true) ? '开' : '关') + ']', () => {
            const current = getSetting('chatgptReasoningEndEnabled', true);
            setSetting('chatgptReasoningEndEnabled', !current);
            alert('ChatGPT 思考完成通知已' + (!current ? '开启' : '关闭'));
            location.reload();
        });

        GM_registerMenuCommand('🔔 AI Studio 通知 [' + (getSetting('aistudioEnabled', true) ? '开' : '关') + ']', () => {
            const current = getSetting('aistudioEnabled', true);
            setSetting('aistudioEnabled', !current);
            alert('AI Studio 通知已' + (!current ? '开启' : '关闭'));
            location.reload();
        });

        GM_registerMenuCommand('🔊 设置音量', () => {
            const current = getSetting('soundVolume', DEFAULT_VOLUME);
            const percent = Math.round(current * 100);
            const input = prompt(`请输入音量 (0-${Math.round(MAX_VOLUME * 100)}%):`, percent);
            if (input !== null) {
                const newVolume = clampVolume(parseFloat(input) / 100);
                setSetting('soundVolume', newVolume);
                alert(`音量已设置为 ${Math.round(newVolume * 100)}%`);
                playNotificationSound(); // 测试音效
            }
        });

        GM_registerMenuCommand('🎵 测试音效', () => {
            playNotificationSound();
        });
    }

    // ===========================================
    // 第十一部分:初始化
    // ===========================================

    function initialize() {
        // 请求通知权限
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        // 创建设置菜单
        createSettingsMenu();

        console.log('[AI-Notifier] AI 回答完成提醒器已启动,监控平台:', PLATFORMS.map(p => p.name).join(', '));
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
