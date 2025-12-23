// ==UserScript==
// @name         书签有效性检测
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  兼容所有浏览器导出的书签格式，稳定检测无报错，精准展示进度
// @author       You
// @match        *://*/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 全局配置
    const CONFIG = {
        batchSize: 15,          // 每批检测数量（降低批次大小提升稳定性）
        requestTimeout: 10000,  // 单个请求超时
        batchDelay: 300,        // 批次间隔
        resultUpdateInterval: 5 // 结果更新间隔
    };

    // 全局状态
    let detectionState = {
        isRunning: false,
        isPaused: false,
        totalBookmarks: 0,
        checkedCount: 0,
        validCount: 0,
        invalidCount: 0,
        invalidBookmarks: [],
        currentBatch: 0,
        totalBatches: 0,
        bookmarksQueue: [],
        parseInfo: '' // 解析信息，用于调试
    };

    // 注册菜单
    GM_registerMenuCommand("书签有效性检测（稳定版）", function() {
        createCheckUI();
    });

    // 创建界面
    function createCheckUI() {
        const existingUI = document.getElementById('bookmark-checker-ui');
        if (existingUI) {
            existingUI.style.display = 'block';
            document.getElementById('bookmark-checker-mask').style.display = 'block';
            return;
        }

        // 主容器
        const uiContainer = document.createElement('div');
        uiContainer.id = 'bookmark-checker-ui';
        uiContainer.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 700px;
            max-width: 95vw;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 30px rgba(0,0,0,0.2);
            padding: 25px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            max-height: 85vh;
            overflow-y: auto;
            box-sizing: border-box;
        `;

        // 遮罩层
        const mask = document.createElement('div');
        mask.id = 'bookmark-checker-mask';
        mask.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0,0,0,0.6);
            z-index: 999998;
            backdrop-filter: blur(2px);
        `;

        // 界面内容（增加解析信息展示）
        uiContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
                <h2 style="margin: 0; color: #2d3748; font-size: 18px;">书签有效性检测（稳定版）</h2>
                <button id="close-ui" style="background: #e53e3e; color: white; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 14px;">关闭</button>
            </div>

            <!-- 文件上传区 -->
            <div style="margin-bottom: 25px;">
                <p style="color: #4a5568; margin-bottom: 10px; font-size: 14px;">
                    1. 导出书签：Chrome/Edge → 书签管理器（Ctrl+Shift+O）→ 三点 → 导出书签（HTML文件）
                </p>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="file" id="bookmark-file" accept=".html,.htm" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    <button id="start-check" style="background: #4299e1; color: white; border: none; border-radius: 4px; padding: 8px 20px; cursor: pointer; white-space: nowrap;">开始检测</button>
                </div>
                <div id="file-info" style="margin-top: 8px; color: #9f7aea; font-size: 13px; display: none;"></div>
            </div>

            <!-- 解析信息区（调试用） -->
            <div id="parse-info" style="display: none; margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-size: 12px; color: #4a5568;">
                解析信息：<span id="parse-detail">待解析...</span>
            </div>

            <!-- 控制区 -->
            <div id="control-area" style="display: none; margin-bottom: 20px;">
                <button id="pause-check" style="background: #ed8936; color: white; border: none; border-radius: 4px; padding: 6px 15px; cursor: pointer; margin-right: 10px;">暂停检测</button>
                <button id="resume-check" style="background: #38a169; color: white; border: none; border-radius: 4px; padding: 6px 15px; cursor: pointer; display: none;">继续检测</button>
                <button id="reset-check" style="background: #718096; color: white; border: none; border-radius: 4px; padding: 6px 15px; cursor: pointer;">重置</button>
            </div>

            <!-- 进度展示区 -->
            <div id="progress-container" style="display: none; margin-bottom: 25px;">
                <div style="display: flex; justify-content: space-between; color: #4a5568; font-size: 14px; margin-bottom: 8px;">
                    <span id="progress-text">总进度：0/0（0%）</span>
                    <span id="batch-text">批次：0/0</span>
                </div>
                <div style="height: 8px; background: #f7fafc; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                    <div id="progress-bar" style="height: 100%; width: 0%; background: #4299e1; transition: width 0.2s ease;"></div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px;">
                    <div style="background: #f0f8fb; padding: 8px; border-radius: 4px;">
                        <span style="color: #718096;">已检测：</span>
                        <span id="checked-count" style="font-weight: bold; color: #2d3748;">0</span>
                    </div>
                    <div style="background: #eaf6fa; padding: 8px; border-radius: 4px;">
                        <span style="color: #718096;">有效书签：</span>
                        <span id="valid-count" style="font-weight: bold; color: #38a169;">0</span>
                    </div>
                    <div style="background: #fef7fb; padding: 8px; border-radius: 4px;">
                        <span style="color: #718096;">失效书签：</span>
                        <span id="invalid-count" style="font-weight: bold; color: #e53e3e;">0</span>
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: 12px; color: #718096;" id="current-status">准备检测...</div>
            </div>

            <!-- 结果展示区 -->
            <div id="result-container" style="margin-top: 20px; max-height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; padding: 10px;">
                <p style="color: #718096; text-align: center; margin: 0;">未开始检测</p>
            </div>
        `;

        document.body.appendChild(mask);
        document.body.appendChild(uiContainer);
        bindUIEvents();
    }

    // 绑定事件
    function bindUIEvents() {
        // 关闭按钮
        document.getElementById('close-ui').addEventListener('click', function() {
            stopDetection();
            document.getElementById('bookmark-checker-ui').style.display = 'none';
            document.getElementById('bookmark-checker-mask').style.display = 'none';
        });

        // 开始检测
        document.getElementById('start-check').addEventListener('click', async function() {
            const fileInput = document.getElementById('bookmark-file');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('请先选择书签HTML文件！');
                return;
            }

            // 重置状态
            resetDetectionState();
            detectionState.isRunning = true;

            // 显示文件信息
            const fileInfo = document.getElementById('file-info');
            const file = fileInput.files[0];
            fileInfo.textContent = `正在读取文件：${file.name}（大小：${formatFileSize(file.size)}）`;
            fileInfo.style.display = 'block';

            try {
                // 读取文件（处理BOM）
                const content = await readFileWithBOMHandling(file);
                fileInfo.textContent = `文件读取完成，正在解析...`;

                // 解析书签（改用DOM解析，兼容所有格式）
                const bookmarks = parseBookmarkHTML(content);
                detectionState.parseInfo = `解析完成：共找到${bookmarks.length}个HTTP/HTTPS书签（原始A标签：${detectionState.parseInfo}）`;
                document.getElementById('parse-info').style.display = 'block';
                document.getElementById('parse-detail').textContent = detectionState.parseInfo;

                if (bookmarks.length === 0) {
                    throw new Error('未解析到任何HTTP/HTTPS书签，请确认是浏览器导出的标准书签HTML文件');
                }

                // 更新状态
                detectionState.totalBookmarks = bookmarks.length;
                detectionState.bookmarksQueue = [...bookmarks];
                detectionState.totalBatches = Math.ceil(bookmarks.length / CONFIG.batchSize);

                // 显示进度和控制区
                fileInfo.style.display = 'none';
                document.getElementById('progress-container').style.display = 'block';
                document.getElementById('control-area').style.display = 'flex';
                document.getElementById('result-container').innerHTML = '<p style="color: #718096; text-align: center; margin: 0;">检测中，请稍候...</p>';

                // 开始分批检测
                startBatchDetection();
            } catch (error) {
                fileInfo.style.display = 'none';
                alert(`处理失败：${error.message}`);
                resetDetectionState();
            }
        });

        // 暂停/继续/重置
        document.getElementById('pause-check').addEventListener('click', function() {
            detectionState.isPaused = true;
            detectionState.isRunning = false;
            this.style.display = 'none';
            document.getElementById('resume-check').style.display = 'inline-block';
            document.getElementById('current-status').textContent = '已暂停检测';
        });

        document.getElementById('resume-check').addEventListener('click', function() {
            detectionState.isPaused = false;
            detectionState.isRunning = true;
            this.style.display = 'none';
            document.getElementById('pause-check').style.display = 'inline-block';
            document.getElementById('current-status').textContent = '恢复检测...';
            startBatchDetection();
        });

        document.getElementById('reset-check').addEventListener('click', function() {
            resetDetectionState();
            document.getElementById('progress-container').style.display = 'none';
            document.getElementById('control-area').style.display = 'none';
            document.getElementById('parse-info').style.display = 'none';
            document.getElementById('result-container').innerHTML = '<p style="color: #718096; text-align: center; margin: 0;">未开始检测</p>';
            document.getElementById('bookmark-file').value = '';
            document.getElementById('file-info').style.display = 'none';
        });
    }

    // 读取文件并处理BOM（关键修复：处理UTF-8 BOM）
    function readFileWithBOMHandling(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                let content = e.target.result;
                // 去除UTF-8 BOM（很多浏览器导出的书签会带BOM，导致解析异常）
                if (content.charCodeAt(0) === 0xFEFF) {
                    content = content.slice(1);
                }
                resolve(content);
            };
            reader.onerror = function() {
                reject(new Error(`文件读取失败：${reader.error?.message || '未知错误'}`));
            };
            reader.readAsText(file, 'UTF-8'); // 强制UTF-8编码
        });
    }

    // 解析书签HTML（改用DOM解析，兼容所有格式）
    function parseBookmarkHTML(htmlContent) {
        const bookmarks = [];
        // 创建临时DOM（优化：不添加到页面，避免污染）
        const tempDoc = document.implementation.createHTMLDocument('temp');
        tempDoc.body.innerHTML = htmlContent;

        // 找到所有A标签（兼容不同浏览器的书签结构）
        const aTags = tempDoc.body.querySelectorAll('a');
        detectionState.parseInfo = `共找到${aTags.length}个A标签`;

        // 遍历所有A标签，提取有效链接
        aTags.forEach(tag => {
            try {
                const url = tag.getAttribute('href');
                if (!url) return;

                // 标准化URL（处理相对路径等）
                let normalizedUrl;
                try {
                    normalizedUrl = new URL(url).href;
                } catch (e) {
                    // 非标准URL，跳过
                    return;
                }

                // 只保留HTTP/HTTPS
                if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
                    // 提取标题（兼容不同格式）
                    let title = tag.textContent.trim() || tag.getAttribute('title') || '无标题';
                    // 清理标题中的特殊字符
                    title = title.replace(/\s+/g, ' ').replace(/[\n\r]/g, '');

                    bookmarks.push({
                        title: title,
                        url: normalizedUrl
                    });
                }
            } catch (e) {
                // 单个标签解析失败，跳过
                console.log('解析单个书签失败：', e);
            }
        });

        return bookmarks;
    }

    // 分批检测
    async function startBatchDetection() {
        if (!detectionState.isRunning || detectionState.isPaused || detectionState.bookmarksQueue.length === 0) {
            if (detectionState.bookmarksQueue.length === 0 && detectionState.checkedCount === detectionState.totalBookmarks) {
                finishDetection();
            }
            return;
        }

        // 取当前批次
        const batch = detectionState.bookmarksQueue.splice(0, CONFIG.batchSize);
        detectionState.currentBatch++;

        // 更新UI
        document.getElementById('batch-text').textContent = `批次：${detectionState.currentBatch}/${detectionState.totalBatches}`;
        document.getElementById('current-status').textContent = `正在检测批次 ${detectionState.currentBatch}/${detectionState.totalBatches}（${batch.length}个书签）...`;

        // 检测当前批次
        const batchPromises = batch.map(bookmark => checkSingleBookmark(bookmark));
        const batchResults = await Promise.allSettled(batchPromises);

        // 处理结果
        batchResults.forEach((result, index) => {
            const bookmark = batch[index];
            detectionState.checkedCount++;

            if (result.status === 'fulfilled') {
                if (result.value.isInvalid) {
                    detectionState.invalidCount++;
                    detectionState.invalidBookmarks.push({ ...bookmark, error: result.value.error });
                } else {
                    detectionState.validCount++;
                }
            } else {
                detectionState.invalidCount++;
                detectionState.invalidBookmarks.push({ ...bookmark, error: result.reason.message || '检测异常' });
            }
        });

        // 更新进度和结果
        updateProgressUI();
        if (detectionState.checkedCount % CONFIG.resultUpdateInterval === 0 || detectionState.bookmarksQueue.length === 0) {
            updateResultUI();
        }

        // 延迟后继续下一批
        await new Promise(resolve => setTimeout(resolve, CONFIG.batchDelay));
        startBatchDetection();
    }

    // 检测单个书签（可靠的超时处理）
    function checkSingleBookmark(bookmark) {
        return new Promise((resolve) => {
            // 超时定时器
            const timeoutTimer = setTimeout(() => {
                resolve({ isInvalid: true, error: '请求超时（10秒）' });
            }, CONFIG.requestTimeout);

            // 发起请求
            fetch(bookmark.url, {
                method: 'HEAD',
                mode: 'no-cors',
                redirect: 'follow',
                cache: 'no-cache',
                credentials: 'omit'
            }).then(response => {
                clearTimeout(timeoutTimer);
                // no-cors模式下，只要能收到响应就视为有效
                resolve({ isInvalid: false });
            }).catch(error => {
                clearTimeout(timeoutTimer);
                let errorMsg = '请求失败';
                if (error.message.includes('Failed to fetch')) errorMsg = '无法访问（网络/跨域）';
                else if (error.message.includes('timeout')) errorMsg = '请求超时';
                else errorMsg = error.message;
                resolve({ isInvalid: true, error: errorMsg });
            });
        });
    }

    // 更新进度UI
    function updateProgressUI() {
        const progress = detectionState.totalBookmarks === 0
            ? 0
            : Math.round((detectionState.checkedCount / detectionState.totalBookmarks) * 100);

        document.getElementById('progress-text').textContent =
            `总进度：${detectionState.checkedCount}/${detectionState.totalBookmarks}（${progress}%）`;
        document.getElementById('progress-bar').style.width = `${progress}%`;
        document.getElementById('checked-count').textContent = detectionState.checkedCount;
        document.getElementById('valid-count').textContent = detectionState.validCount;
        document.getElementById('invalid-count').textContent = detectionState.invalidCount;
    }

    // 更新结果UI
    function updateResultUI() {
        const container = document.getElementById('result-container');

        if (detectionState.invalidBookmarks.length === 0) {
            container.innerHTML = `<p style="color: #38a169; text-align: center; margin: 0;">暂无失效书签 ✅</p>`;
            return;
        }

        let html = `
            <div style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
                <span style="font-weight: bold; color: #e53e3e; font-size: 14px;">
                    失效书签（共${detectionState.invalidCount}个）：
                </span>
            </div>
        `;

        // 显示最新50个
        const displayBookmarks = detectionState.invalidBookmarks.slice(-50);
        displayBookmarks.forEach((bookmark, index) => {
            html += `
                <div style="padding: 8px; margin: 6px 0; background: #fef7fb; border-left: 3px solid #e53e3e; border-radius: 2px; font-size: 13px;">
                    <div style="font-weight: 500; color: #2d3748; margin-bottom: 4px;">
                        ${detectionState.invalidBookmarks.length - displayBookmarks.length + index + 1}. ${bookmark.title}
                    </div>
                    <div style="color: #4a5568; word-break: break-all; margin-bottom: 4px;">${bookmark.url}</div>
                    <div style="color: #718096; font-size: 12px;">原因：${bookmark.error || '链接不可访问'}</div>
                </div>
            `;
        });

        if (detectionState.invalidBookmarks.length > 50) {
            html += `<div style="text-align: center; color: #718096; font-size: 12px; margin-top: 10px;">
                仅显示最新50个失效书签，共${detectionState.invalidCount}个
            </div>`;
        }

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }

    // 完成检测
    function finishDetection() {
        detectionState.isRunning = false;
        document.getElementById('pause-check').style.display = 'none';
        document.getElementById('resume-check').style.display = 'none';
        document.getElementById('current-status').textContent = '检测完成！';
        updateResultUI();
        alert(`检测完成！
总书签数：${detectionState.totalBookmarks}
已检测：${detectionState.checkedCount}
有效书签：${detectionState.validCount}
失效书签：${detectionState.invalidCount}`);
    }

    // 辅助函数：格式化文件大小
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // 停止检测
    function stopDetection() {
        detectionState.isRunning = false;
        detectionState.isPaused = false;
    }

    // 重置状态
    function resetDetectionState() {
        detectionState = {
            isRunning: false,
            isPaused: false,
            totalBookmarks: 0,
            checkedCount: 0,
            validCount: 0,
            invalidCount: 0,
            invalidBookmarks: [],
            currentBatch: 0,
            totalBatches: 0,
            bookmarksQueue: [],
            parseInfo: ''
        };
        // 重置UI
        document.getElementById('progress-bar').style.width = '0%';
        document.getElementById('progress-text').textContent = '总进度：0/0（0%）';
        document.getElementById('batch-text').textContent = '批次：0/0';
        document.getElementById('checked-count').textContent = '0';
        document.getElementById('valid-count').textContent = '0';
        document.getElementById('invalid-count').textContent = '0';
        document.getElementById('current-status').textContent = '准备检测...';
        document.getElementById('parse-detail').textContent = '待解析...';
        document.getElementById('pause-check').style.display = 'inline-block';
        document.getElementById('resume-check').style.display = 'none';
    }

})();