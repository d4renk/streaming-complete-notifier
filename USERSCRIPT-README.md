# AI 回答完成提醒器 - 油猴脚本版本

## 项目简介
用于监测 Gemini、ChatGPT 与 AI Studio 的生成请求,当检测到生成结束时弹出桌面通知并播放提示音。

这是从 Chrome 扩展版本转换而来的油猴脚本(Tampermonkey/Violentmonkey)版本。

## 功能亮点
- ✅ 实时捕捉 Gemini、ChatGPT 与 AI Studio 的回答完成事件,并推送系统通知
- ✅ 支持 ChatGPT 思考完成单独通知
- ✅ 可自定义音量 (0% - 150%)
- ✅ 使用浏览器原生通知 API
- ✅ 通过 GM 菜单快速切换功能开关

## 安装步骤

### 1. 安装油猴扩展
首先需要在浏览器中安装油猴管理器:
- **Chrome/Edge**: 安装 [Tampermonkey](https://www.tampermonkey.net/)
- **Firefox**: 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
- **Safari**: 安装 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)

### 2. 安装脚本
1. 打开 `ai-completion-notifier.user.js` 文件
2. 点击 Tampermonkey 图标 → 添加新脚本
3. 复制 `ai-completion-notifier.user.js` 的全部内容并粘贴
4. 保存 (Ctrl+S 或 Cmd+S)

或者直接在 Tampermonkey 中点击 `ai-completion-notifier.user.js` 文件的原始链接自动安装。

### 3. 授权通知权限
首次访问 Gemini/ChatGPT/AI Studio 时,浏览器会请求通知权限,请点击"允许"。

## 使用说明

### 功能开关
点击浏览器右上角的 Tampermonkey 图标,在菜单中可以看到以下选项:

- **🔔 Gemini 通知** - 开启/关闭 Gemini 完成通知
- **🔔 ChatGPT 通知** - 开启/关闭 ChatGPT 完成通知
- **🧠 ChatGPT 思考完成通知** - 开启/关闭 ChatGPT 思考阶段完成的单独通知
- **🔔 AI Studio 通知** - 开启/关闭 AI Studio 完成通知
- **🔊 设置音量** - 调整提示音音量 (0-150%)
- **🎵 测试音效** - 播放测试音效

### 音量设置
- 默认音量: 100%
- 最大音量: 150%
- 静音: 0%

点击"设置音量"菜单项,输入 0-150 之间的数字即可。

## 支持的平台

| 平台 | 检测方式 | 特殊功能 |
|------|---------|---------|
| **Gemini** | 请求完成检测 | - |
| **ChatGPT** | SSE 流结束检测 | 思考完成单独通知 |
| **AI Studio** | 请求完成检测 | - |

## 技术实现

### 与 Chrome 扩展版本的主要差异

| 功能 | Chrome 扩展 | 油猴脚本 |
|------|------------|---------|
| 网络请求监听 | `chrome.webRequest` API | 拦截 `XMLHttpRequest` 和 `fetch` |
| 通知 | `chrome.notifications` API | 浏览器原生 `Notification` API |
| 存储 | `chrome.storage.sync` | `GM_getValue` / `GM_setValue` |
| 音频播放 | Offscreen Document | Web Audio API (合成音频) |
| 设置界面 | Popup HTML 页面 | GM 菜单命令 |
| SSE 流解析 | Content Script + Page Script | 直接在页面上下文拦截 |

### 核心技术
- **请求拦截**: 重写 `XMLHttpRequest.prototype` 和 `window.fetch`
- **SSE 流解析**: 使用 `ReadableStream.tee()` 克隆流进行解析
- **音频合成**: Web Audio API 生成正弦波提示音
- **状态管理**: Map 结构存储请求状态和节流信息

## 常见问题

### Q: 为什么没有收到通知?
A: 请检查:
1. 浏览器是否授予了通知权限
2. 对应平台的通知开关是否开启(在 Tampermonkey 菜单中检查)
3. 浏览器控制台是否有错误信息

### Q: 音效无法播放?
A: 现代浏览器要求用户交互后才能播放音频。首次使用时,请点击页面任意位置激活音频上下文。

### Q: 可以同时使用扩展版本和油猴版本吗?
A: 不建议同时使用,会导致重复通知。建议选择其中一个版本使用。

### Q: 支持哪些油猴管理器?
A: 支持 Tampermonkey、Violentmonkey 和 Greasemonkey 4+。推荐使用 Tampermonkey。

## 隐私说明
- 本脚本**不会**收集或上传任何用户数据
- 所有配置存储在本地浏览器中
- 仅拦截和分析必要的 API 请求以检测完成事件

## 许可协议
MIT

## 更新日志

### v1.1.0 (2024-01-16)
- 🎉 从 Chrome 扩展转换为油猴脚本
- ✨ 支持 Gemini、ChatGPT、AI Studio 三大平台
- ✨ ChatGPT 思考完成检测
- ✨ 可调节音量 (0-150%)
- ✨ GM 菜单快速设置

## 反馈与贡献
如有问题或建议,欢迎提交 Issue 或 Pull Request。
