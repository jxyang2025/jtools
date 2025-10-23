document.addEventListener('DOMContentLoaded', () => {
    const iptvUrlInput = document.getElementById('iptv-url');
    const loadButton = document.getElementById('load-playlist');
    const channelListUl = document.getElementById('channels');
    const statusMessage = document.getElementById('status-message');
    const videoElement = document.getElementById('tv-player');
    
    // 初始化 Video.js 播放器
    const player = videojs(videoElement);

    // ==========================================================
    // !!! 关键配置: Cloudflare Worker 代理地址 !!!
    // ==========================================================
    // 由于跨域问题，M3U 文件通常需要通过代理获取。
    // 请将 YOUR_WORKER_DOMAIN_HERE.workers.dev 替换成您部署的 Cloudflare Worker 域名。
    // Worker 的作用是获取 M3U 文件内容并添加 CORS 头部。
    // 如果您的 M3U 源本身支持 CORS (极少数情况)，可以将此变量设为 null 或空字符串。
    const WORKER_PROXY_BASE_URL = 'https://m3u-proxy.jxy5460.workers.dev/'; 

    /**
     * 更新状态信息
     * @param {string} message - 要显示的消息
     * @param {string} type - 消息类型 ('info', 'error', 'success')
     */
    function updateStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.style.color = {
            'info': 'yellow',
            'error': 'red',
            'success': 'lightgreen'
        }[type] || 'yellow';
    }

    /**
     * 获取 M3U 文件内容 (通过 Worker 代理)
     * @param {string} url - M3U 订阅链接
     * @returns {Promise<string>} M3U 文件内容的文本
     */
    async function fetchM3UContent(url) {
        let fetchUrl = url;
        
        if (WORKER_PROXY_BASE_URL) {
            // 将原始 M3U URL 作为参数传递给 Worker
            fetchUrl = WORKER_PROXY_BASE_URL + '?url=' + encodeURIComponent(url);
        }

        try {
            updateStatus('正在加载频道列表...');
            const response = await fetch(fetchUrl);
            
            if (!response.ok) {
                throw new Error(`网络请求失败，状态码: ${response.status}`);
            }
            
            const text = await response.text();
            updateStatus('频道列表加载成功。', 'success');
            return text;
            
        } catch (error) {
            updateStatus(`加载失败: ${error.message}. 检查 URL 和 Worker 代理是否正确。`, 'error');
            console.error('Fetch M3U Error:', error);
            return null;
        }
    }
    
    /**
     * 解析 M3U 文本，提取频道信息
     * @param {string} m3uText - M3U 文件的文本内容
     * @returns {Array<{name: string, url: string, logo: string}>} 频道列表
     */
    function parseM3U(m3uText) {
        const channels = [];
        // 按行分割并过滤空行
        const lines = m3uText.split('\n').filter(line => line.trim() !== '');
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF')) {
                const infoLine = lines[i];
                const urlLine = lines[i + 1];
                
                // 正则表达式提取名称、Logo等信息
                const nameMatch = infoLine.match(/,(.*)$/);
                const name = nameMatch ? nameMatch[1].trim() : '未知频道';

                const logoMatch = infoLine.match(/tvg-logo="([^"]*)"/);
                const logo = logoMatch ? logoMatch[1] : '';

                if (urlLine && !urlLine.startsWith('#')) {
                    channels.push({
                        name: name,
                        url: urlLine.trim(),
                        logo: logo
                    });
                    i++; // 跳过 URL 行
                }
            }
        }
        return channels;
    }

    /**
     * 渲染频道列表到页面
     * @param {Array<{name: string, url: string, logo: string}>} channels - 频道列表
     */
    function renderChannels(channels) {
        channelListUl.innerHTML = ''; // 清空现有列表

        if (channels.length === 0) {
            channelListUl.innerHTML = '<p>未找到任何频道。</p>';
            return;
        }

        channels.forEach(channel => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = channel.name;
            link.dataset.url = channel.url; // 存储流地址
            
            // 点击事件：播放频道
            link.addEventListener('click', (e) => {
                e.preventDefault();
                playChannel(channel.url, channel.name);
                
                // 更新高亮状态
                document.querySelectorAll('#channels li a').forEach(a => a.classList.remove('active'));
                link.classList.add('active');
            });

            listItem.appendChild(link);
            channelListUl.appendChild(listItem);
        });
    }

    /**
     * 播放指定的频道流
     * @param {string} url - 频道流地址 (通常是 M3U8/HLS)
     * @param {string} name - 频道名称
     */
    function playChannel(url, name) {
        updateStatus(`正在播放: ${name}`, 'info');

        // 停止并清理旧的 HLS 实例
        if (player.hls) {
            player.hls.destroy();
            player.hls = null;
        }
        
        // 尝试使用 hls.js (推荐用于跨浏览器兼容性)
        if (Hls.isSupported()) {
            const hls = new Hls();
            player.hls = hls; // 存储实例以便后续清理
            
            hls.loadSource(url);
            hls.attachMedia(videoElement);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                player.play().catch(e => console.log("Player autplay blocked:", e));
                updateStatus(`频道播放中: ${name}`, 'success');
            });
            hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    updateStatus(`播放错误 (${name}): 无法加载流。`, 'error');
                    console.error('HLS Fatal Error:', data);
                }
            });
        } 
        // 苹果等原生支持 HLS 的设备
        else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = url;
            player.load();
            player.play().catch(e => console.log("Player autplay blocked:", e));
            updateStatus(`频道播放中: ${name}`, 'success');
        } 
        // 都不支持
        else {
            updateStatus('错误: 您的浏览器不支持 HLS/M3U8 流播放。', 'error');
        }
    }

    // ==========================================================
    // 事件监听器
    // ==========================================================
    loadButton.addEventListener('click', async () => {
        const m3uUrl = iptvUrlInput.value.trim();
        if (!m3uUrl) {
            updateStatus('请输入 M3U 订阅链接！', 'error');
            return;
        }

        const m3uContent = await fetchM3UContent(m3uUrl);
        
        if (m3uContent) {
            const channels = parseM3U(m3uContent);
            renderChannels(channels);
            
            if (channels.length > 0) {
                // 默认播放第一个频道
                document.querySelector('#channels li a').click();
            } else {
                 updateStatus('M3U 文件已加载，但未找到任何频道。', 'error');
            }
        }
    });

    // 从本地存储加载 URL (可选优化)
    const storedUrl = localStorage.getItem('iptvUrl');
    if (storedUrl) {
        iptvUrlInput.value = storedUrl;
    }
    // 监听输入框变化，保存 URL
    iptvUrlInput.addEventListener('change', () => {
        localStorage.setItem('iptvUrl', iptvUrlInput.value.trim());
    });
});