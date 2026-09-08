const fs = require('fs');

let input = '';
process.stdin.on('data', data => { input += data; });
process.stdin.on('end', async () => {
    try {
        const payload = JSON.parse(input);
        const hookEventName = payload.hookEventName;
        
        const data = {
            event: hookEventName,
            delta: payload.delta || '',
            index: payload.index || 0,
            final: payload.final || false,
            turn_id: payload.turn_id
        };

        // 发送给主服务器
        const res = await fetch('http://127.0.0.1:8080/api/internal/message-display', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } catch (e) {}
    process.exit(0);
});
