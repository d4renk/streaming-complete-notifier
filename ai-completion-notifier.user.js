// ==UserScript==
// @name         AI 回答完成提醒器 (Gemini & ChatGPT & AI Studio)
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  当 Gemini、ChatGPT 或 AI Studio 完成回答生成时,发送桌面通知和声音提醒。支持 ChatGPT 思考完成检测。使用 GM_notification 无需手动授权。
// @author       Your Name
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://aistudio.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-start
// @connect      gemini.google.com
// @connect      chatgpt.com
// @connect      aistudio.google.com
// @connect      clients6.google.com
// ==/UserScript==

(function() {
    'use strict';

    // ===========================================
    // 调试模式配置
    // ===========================================

    let DEBUG_MODE = GM_getValue('debugMode', false);  // 从持久化存储读取,默认关闭

    function debugLog(...args) {
        if (DEBUG_MODE) {
            console.log('[AI-Notifier-Debug]', new Date().toISOString(), ...args);
        }
    }

    function debugWarn(...args) {
        if (DEBUG_MODE) {
            console.warn('[AI-Notifier-Debug]', new Date().toISOString(), ...args);
        }
    }

    function debugError(...args) {
        if (DEBUG_MODE) {
            console.error('[AI-Notifier-Debug]', new Date().toISOString(), ...args);
        }
    }

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

    // 状态存储
    const requestState = new Map();
    const lastNotifyAt = new Map();
    const lastStartAt = new Map();

    // ===========================================
    // 第三部分:工具函数
    // ===========================================

    function stateKey(platformId, tabId = 'main') {
        return `${platformId}:${tabId}`;
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
            debugWarn('无效的 URL:', url);
            return null;
        }

        debugLog('检查 URL:', url, '方法:', method, '过滤类型:', detectionTypeFilter);

        for (const platform of PLATFORMS) {
            if (detectionTypeFilter && platform.detection.type !== detectionTypeFilter) {
                continue;
            }

            if (platform.match.method && method !== platform.match.method) {
                debugLog(`平台 ${platform.name}: 方法不匹配 (需要 ${platform.match.method}, 实际 ${method})`);
                continue;
            }

            if (platform.match.urlPattern) {
                if (platform.match.urlPattern.test(url)) {
                    debugLog(`✅ 匹配到平台: ${platform.name} (通过 urlPattern)`);
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

            if (!hostMatch) {
                debugLog(`平台 ${platform.name}: 域名不匹配 (需要 ${platform.hosts.join(', ')}, 实际 ${urlObj.hostname})`);
                continue;
            }

            if (platform.match.pathPattern) {
                if (matchPath(urlObj.pathname, platform.match.pathPattern)) {
                    debugLog(`✅ 匹配到平台: ${platform.name} (域名+路径)`);
                    return platform;
                } else {
                    debugLog(`平台 ${platform.name}: 路径不匹配 (模式: ${platform.match.pathPattern}, 实际: ${urlObj.pathname})`);
                }
            }
        }

        debugWarn('未匹配到任何平台');
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
        const timeSinceLast = now - last;
        const throttled = timeSinceLast < ms;

        if (throttled) {
            debugWarn(`节流中 - 平台: ${platformId}, 距离上次: ${timeSinceLast}ms, 需要: ${ms}ms`);
        } else {
            debugLog(`✅ 通过节流检查 - 平台: ${platformId}, 距离上次: ${timeSinceLast}ms`);
            lastNotifyAt.set(key, now);
        }

        return throttled;
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
    // 第六部分:通知系统
    // ===========================================

    async function sendNotification(platform, options = {}) {
        try {
            debugLog(`准备发送通知 - 平台: ${platform.name}`);

            const settings = getSetting(platform.enabledKey, true);
            debugLog(`平台 ${platform.name} 启用状态:`, settings);

            if (!settings) {
                debugWarn(`平台 ${platform.name} 已禁用,跳过通知`);
                return;
            }

            const { title, message } = platform.notify;

            debugLog(`✅ 发送 GM 通知: ${title} - ${message}`);

            // 使用油猴的 GM_notification API
            GM_notification({
                title: title,
                text: message,
                image: 'https://www.google.com/favicon.ico',
                timeout: 8000,  // 8秒后自动关闭
                onclick: () => {
                    debugLog('通知被点击');
                    window.focus();
                }
            });
        } catch (e) {
            debugError('发送通知失败:', e);
            console.error('[AI-Notifier] 发送通知失败:', e);
        }
    }

    // 测试通知
    async function showTestNotification() {
        try {
            const message = '系统通知功能正常，您将听到系统通知声音';

            GM_notification({
                title: '🔔 通知测试',
                text: message,
                image: 'https://www.google.com/favicon.ico',
                timeout: 3000,  // 3秒后自动关闭
                onclick: () => {
                    window.focus();
                }
            });
        } catch (e) {
            console.error('[AI-Notifier] 测试通知失败:', e);
            alert('❌ 发送通知失败: ' + e.message);
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

        debugLog('XHR 请求:', method, url);

        // 检查是否匹配平台配置
        const platform = findPlatformForRequest(url, method);

        if (platform) {
            debugLog(`✅ XHR 匹配到平台: ${platform.name}, 检测类型: ${platform.detection.type}`);
            const requestId = Math.random().toString(36);

            if (platform.detection.type === 'sse-stream') {
                // SSE 流检测
                debugLog('注册 SSE 流监听器');
                requestState.set(requestId, {
                    platformId: platform.id,
                    startTime: Date.now()
                });

                if (platform.detection.trackStart) {
                    const key = stateKey(platform.id);
                    lastStartAt.set(key, Date.now());
                    debugLog('记录流开始时间');
                }

                this.addEventListener('readystatechange', function() {
                    if (this.readyState === 4) {
                        debugLog(`SSE 请求完成 - 状态: ${this.status}`);
                        const contentType = this.getResponseHeader('content-type') || '';
                        debugLog('Content-Type:', contentType);
                        if (contentType.includes('text/event-stream')) {
                            debugLog('✅ 确认为 SSE 流,准备发送通知');
                            // SSE 流结束
                            if (!isThrottled(platform.id, platform.throttleMs)) {
                                sendNotification(platform);
                            }
                        } else {
                            debugWarn('不是 SSE 流,跳过通知');
                        }
                        requestState.delete(requestId);
                    }
                });
            } else if (platform.detection.type === 'request-complete') {
                // 普通请求完成检测
                debugLog('注册普通请求完成监听器');
                this.addEventListener('load', function() {
                    debugLog(`请求完成 - 状态: ${this.status}`);
                    if (this.status >= 200 && this.status < 300) {
                        debugLog('✅ 请求成功,准备发送通知');
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
            debugLog(`✅ 匹配到 followup 平台: ${followupPlatform.name}`);
            this.addEventListener('load', function() {
                const key = stateKey(followupPlatform.id);
                const startTime = lastStartAt.get(key);
                const now = Date.now();

                if (startTime) {
                    const elapsed = now - startTime;
                    debugLog(`Followup 请求完成,距离开始: ${elapsed}ms, 最小延迟: ${followupPlatform.followup.minDelayMs}ms`);

                    if (elapsed > followupPlatform.followup.minDelayMs) {
                        debugLog('✅ 满足 followup 延迟条件,准备发送通知');
                        if (!isThrottled(followupPlatform.id, followupPlatform.throttleMs)) {
                            sendNotification(followupPlatform);
                        }
                        lastStartAt.delete(key);
                    } else {
                        debugWarn('未满足 followup 延迟条件,跳过通知');
                    }
                } else {
                    debugWarn('未找到开始时间,跳过 followup 通知');
                }
            });
        }

        return originalXHRSend.call(this, ...args);
    };

    // 拦截 Fetch API (包含 SSE 流事件解析)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const method = args[1]?.method || 'GET';

        debugLog('Fetch 请求:', method, url);

        const response = await originalFetch.apply(this, args);

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

                                        GM_notification({
                                            title: config.notify.title,
                                            text: config.notify.message + durationText,
                                            image: 'https://www.google.com/favicon.ico',
                                            timeout: 8000,
                                            onclick: () => {
                                                window.focus();
                                            }
                                        });
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

        GM_registerMenuCommand('🔔 测试通知', () => {
            showTestNotification();
        });

        GM_registerMenuCommand('🐛 调试模式 [' + (DEBUG_MODE ? '开' : '关') + ']', () => {
            DEBUG_MODE = !DEBUG_MODE;
            GM_setValue('debugMode', DEBUG_MODE);  // 持久化保存调试模式状态
            alert('调试模式已' + (DEBUG_MODE ? '开启\n\n请打开浏览器控制台(F12)查看调试日志' : '关闭'));
            if (DEBUG_MODE) {
                console.log('%c[AI-Notifier] 调试模式已开启', 'color: green; font-weight: bold; font-size: 14px');
                console.log('当前平台配置:', PLATFORMS);
                console.log('使用 GM_notification API 发送通知 (无需额外权限)');
                console.log('各平台启用状态:', {
                    gemini: getSetting('geminiEnabled', true),
                    chatgpt: getSetting('chatgptEnabled', true),
                    chatgptReasoning: getSetting('chatgptReasoningEndEnabled', true),
                    aistudio: getSetting('aistudioEnabled', true)
                });
            }
        });
    }

    // ===========================================
    // 第十一部分:初始化
    // ===========================================

    function initialize() {
        // GM_notification 不需要提前请求权限,油猴会自动处理

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
