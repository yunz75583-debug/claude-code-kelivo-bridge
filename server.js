const express = require('express');
const bodyParser = require('body-parser');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const SESSION_NAME = 'claude-bridge';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || os.homedir();
const INTERNAL_TOKEN = 'sk-bridge-internal';

// 状态管理
let currentRes = null;
let currentTurnId = null;
let messageBuffer = '';
let thinkingBuffer = '';
let lastIndex = -1;

// --- Helper Functions ---

function execAsync(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

async function sendPromptToTmux(prompt) {
    const bufferName = `input-${Date.now()}`;
    // 1. Load into tmux buffer (stdin)
    const loadProcess = spawn('tmux', ['load-buffer', '-b', bufferName, '-']);
    loadProcess.stdin.write(prompt.replace(/\r\n?/g, '\n'));
    loadProcess.stdin.end();

    await new Promise(r => loadProcess.on('close', r));

    // 2. Paste with bracketed paste (-p)
    await execAsync(`tmux paste-buffer -p -b ${bufferName} -t ${SESSION_NAME}`);
    
    // 3. Wait and Enter
    await new Promise(r => setTimeout(r, 900));
    await execAsync(`tmux send-keys -t ${SESSION_NAME} Enter`);
    await execAsync(`tmux delete-buffer -b ${bufferName}`).catch(() => {});
}

async function ensureSession() {
    const sessions = await execAsync('tmux list-sessions').catch(() => '');
    if (!sessions.includes(SESSION_NAME)) {
        console.log(`Starting new tmux session: ${SESSION_NAME}`);
        const hookDir = path.join(__dirname, 'hooks');
        const settings = {
            hooks: {
                MessageDisplay: `node ${path.join(hookDir, 'message-hook.js')}`,
                Stop: `node ${path.join(hookDir, 'message-hook.js')}`,
                UserPromptSubmit: `node ${path.join(hookDir, 'user-prompt-hook.js')}`
            },
            alwaysThinkingEnabled: true,
            showThinkingSummaries: true,
            switchModelsOnFlag: false,
            awaySummaryEnabled: false
        };
        const cmd = `claude --settings '${JSON.stringify(settings)}'`;
        await execAsync(`tmux new-session -d -s ${SESSION_NAME} -c ${WORKSPACE_ROOT} "${cmd}"`);
    }
}

// --- API Endpoints ---

// OpenAI 兼容接口
app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream } = req.body;
    const lastMessage = messages[messages.length - 1].content;

    await ensureSession();

    // 重置回合状态
    messageBuffer = '';
    thinkingBuffer = '';
    lastIndex = -1;
    currentRes = res;

    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }

    // 发送给 Claude
    await sendPromptToTmux(lastMessage);

    // 注意：实际的流式返回由 /api/internal/message-display 触发
});

// 内部 Hook 接收端
app.post('/api/internal/message-display', (req, res) => {
    const { delta, index, final, event } = req.body;

    if (currentRes) {
        if (event === 'MessageDisplay') {
            const chunk = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-3-7-sonnet',
                choices: [{
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null
                }]
            };
            currentRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (final || event === 'Stop') {
            const endChunk = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'claude-3-7-sonnet',
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop'
                }]
            };
            currentRes.write(`data: ${JSON.stringify(endChunk)}\n\n`);
            currentRes.write('data: [DONE]\n\n');
            currentRes.end();
            currentRes = null;
        }
    }
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Bridge server running on port ${PORT}`);
});
