# Kelivo × Claude Code Bridge

这个项目可以将你的服务器端 Claude Code CLI 包装成一个 OpenAI 兼容的 API，从而在 Kelivo App 中免费使用你的 Claude Pro 订阅。

## 🚀 快速开始

1. **在服务器上克隆并安装依赖**：
   ```bash
   git clone https://github.com/yunz75583-debug/claude-code-kelivo-bridge.git
   cd claude-code-kelivo-bridge
   npm install
   ```

2. **确保 Claude Code 已登录**：
   ```bash
   claude /login
   ```

3. **启动桥接服务器**：
   ```bash
   node server.js
   ```

4. **在 Kelivo 中配置**：
   - Provider: `Custom`
   - Base URL: `http://你的服务器IP:8080/v1`
   - API Key: 随便填
   - Model ID: `claude-3-7-sonnet`

## 🛠️ 功能
- [x] 基础聊天转发
- [x] 流式输出 (Streaming)
- [x] 自动管理 tmux 会话
- [ ] Thinking 思考链提取 (待完善)
- [ ] 工具调用拦截 (待完善)

## ⚠️ 注意事项
- 确保服务器防火墙开启了 8080 端口。
- 建议仅限个人使用。
