// UserPromptSubmit hook
// stdout 写入的内容会被注入为 Claude 的上下文
process.stdout.write(`[Current Time: ${new Date().toLocaleString()}]\n`);
process.exit(0);
