const express = require('express');
const bodyParser = require('body-parser');
const { exec, spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;
const SESSION_NAME = 'claude-bridge';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || os.homedir();

// 状态管理
let currentRes = null;

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
    const loadProcess = spawn('tmux', ['load-buffer', '-b', bufferName, '-']);
    loadProcess.stdin.write(prompt.replace(/\r\n?/g, '\n'));
    loadProcess.stdin.end();
    await new Promise(r => loadProcess.on('close', r));
    await execAsync(`tmux paste-buffer -p -b ${bufferName} -t ${SESSION_NAME}`);
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

// --- Terminal MCP Logic (Direct Control) ---

app.get('/mcp', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`event: endpoint\ndata: ${JSON.stringify({ capabilities: { tools: {} } })}\n\n`);
});

app.post('/mcp', (req, res) => {
    const { method, params, id } = req.body;
    if (method === 'initialize') {
        return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'xiaozhou-terminal', version: '1.0.0' } } });
    }
    if (method === 'tools/list') {
        return res.json({ jsonrpc: '2.0', id, result: { tools: [{ name: 'run_terminal_command', description: '在服务器上执行 Linux 命令', inputSchema: { type: 'object', properties: { command: { type: 'string', description: '要执行的命令' } }, required: ['command'] } }] } });
    }
    if (method === 'tools/call' && params.name === 'run_terminal_command') {
        try {
            const output = execSync(params.arguments.command, { encoding: 'utf8', cwd: WORKSPACE_ROOT });
            return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: output }] } });
        } catch (e) {
            return res.json({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }] } });
        }
    }
    res.status(404).end();
});

// --- OpenAI API Endpoints ---

app.post('/v1/chat/completions', async (req, res) => {
    const { messages, stream } = req.body;
    const lastMessage = messages[messages.length - 1].content;
    await ensureSession();
    currentRes = res;
    if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }
    await sendPromptToTmux(lastMessage);
});

app.post('/api/internal/message-display', (req, res) => {
    const { delta, final, event } = req.body;
    if (currentRes) {
        if (event === 'MessageDisplay') {
            const chunk = { id: 'chat-' + Date.now(), object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] };
            currentRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        if (final || event === 'Stop') {
            currentRes.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
            currentRes.write('data: [DONE]\n\n');
            currentRes.end();
            currentRes = null;
        }
    }
    res.json({ ok: true });
});

app.listen(PORT, () => { console.log(`Bridge + MCP server running on port ${PORT}`); });
