// functions/stats.js - Netlify Functions 统计处理
const faunadb = require('faunadb'); // 或者使用其他数据库

// 内存存储 (简单实现，重启会丢失数据)
let sessions = new Map();
let pageViews = [];
let lastCleanup = Date.now();

// 清理过期会话 (超过5分钟没有心跳的会话)
function cleanup() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    for (let [sessionId, session] of sessions.entries()) {
        if (session.lastHeartbeat < fiveMinutesAgo) {
            sessions.delete(sessionId);
        }
    }
    
    lastCleanup = now;
}

// 主处理函数
exports.handler = async (event, context) => {
    // 设置 CORS 头
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // 处理 OPTIONS 预检请求
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // 定期清理过期会话
    if (Date.now() - lastCleanup > 60000) { // 每分钟清理一次
        cleanup();
    }

    const path = event.path.replace('/.netlify/functions/stats', '');
    const method = event.httpMethod;

    try {
        switch (path) {
            case '/pageview':
                if (method === 'POST') {
                    return await handlePageView(event, headers);
                }
                break;

            case '/heartbeat':
                if (method === 'POST') {
                    return await handleHeartbeat(event, headers);
                }
                break;

            case '/offline':
                if (method === 'POST') {
                    return await handleOffline(event, headers);
                }
                break;

            case '/current':
                if (method === 'GET') {
                    return await getCurrentStats(headers);
                }
                break;

            default:
                return {
                    statusCode: 404,
                    headers,
                    body: JSON.stringify({ error: 'Not found' })
                };
        }
    } catch (error) {
        console.error('Stats function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

// 处理页面访问
async function handlePageView(event, headers) {
    const data = JSON.parse(event.body);
    
    // 记录页面访问
    pageViews.push({
        ...data,
        timestamp: new Date().toISOString()
    });

    // 保持最近1000条记录
    if (pageViews.length > 1000) {
        pageViews = pageViews.slice(-1000);
    }

    // 更新会话信息
    sessions.set(data.sessionId, {
        sessionId: data.sessionId,
        firstSeen: sessions.has(data.sessionId) ? sessions.get(data.sessionId).firstSeen : Date.now(),
        lastHeartbeat: Date.now(),
        currentPage: data.page
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
            success: true, 
            message: 'Page view recorded' 
        })
    };
}

// 处理心跳
async function handleHeartbeat(event, headers) {
    const data = JSON.parse(event.body);
    
    if (sessions.has(data.sessionId)) {
        const session = sessions.get(data.sessionId);
        session.lastHeartbeat = Date.now();
        sessions.set(data.sessionId, session);
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
            success: true, 
            message: 'Heartbeat received' 
        })
    };
}

// 处理离线状态
async function handleOffline(event, headers) {
    const data = JSON.parse(event.body);
    
    sessions.delete(data.sessionId);

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
            success: true, 
            message: 'User offline' 
        })
    };
}

// 获取当前统计数据
async function getCurrentStats(headers) {
    const now = Date.now();
    const today = new Date().toDateString();
    
    // 计算今日访问量
    const todayViews = pageViews.filter(view => 
        new Date(view.timestamp).toDateString() === today
    ).length;
    
    // 当前在线用户数
    const onlineUsers = sessions.size;
    
    // 总访问量
    const totalViews = pageViews.length;
    
    // 热门页面 (今日)
    const todayPages = pageViews.filter(view => 
        new Date(view.timestamp).toDateString() === today
    );
    
    const pageStats = {};
    todayPages.forEach(view => {
        pageStats[view.page] = (pageStats[view.page] || 0) + 1;
    });
    
    const popularPages = Object.entries(pageStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([page, count]) => ({ page, count }));

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            onlineUsers,
            todayViews,
            totalViews,
            popularPages,
            timestamp: new Date().toISOString()
        })
    };
}
