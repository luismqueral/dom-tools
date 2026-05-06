const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const PORT = 9876;
const wss = new WebSocketServer({ port: PORT });

let sessionId = null;

console.log(`Bridge server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Browser connected');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', text: 'Invalid JSON' }));
      return;
    }

    const prompt = buildPrompt(msg);
    runClaude(prompt, ws);
  });

  ws.on('close', () => console.log('Browser disconnected'));
});

function buildPrompt(msg) {
  const parts = [];

  if (msg.url) {
    parts.push(`[Page: ${msg.url}]`);
  }

  if (msg.selections && msg.selections.length) {
    parts.push('[Selections]');
    msg.selections.forEach(s => parts.push(s));
  }

  if (msg.annotations && msg.annotations.length) {
    parts.push('[Annotations]');
    msg.annotations.forEach(a => {
      parts.push(`Sticky at (${a.x}, ${a.y}): "${a.text}"`);
    });
  }

  if (parts.length) parts.push('');
  parts.push(msg.prompt);

  return parts.join('\n');
}

function runClaude(prompt, ws) {
  const args = ['-p', prompt, '--output-format', 'stream-json'];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  console.log(`Running claude${sessionId ? ' (resuming session)' : ''}...`);

  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      processStreamLine(line, ws);
    }
  });

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error('claude stderr:', text);
  });

  proc.on('close', (code) => {
    // flush remaining buffer
    if (buffer.trim()) {
      processStreamLine(buffer.trim(), ws);
    }
    if (code !== 0) {
      ws.send(JSON.stringify({ type: 'error', text: `Claude exited with code ${code}` }));
    }
    ws.send(JSON.stringify({ type: 'done' }));
    console.log(`Claude process exited (code ${code})`);
  });

  proc.on('error', (err) => {
    ws.send(JSON.stringify({ type: 'error', text: `Failed to start claude: ${err.message}` }));
    ws.send(JSON.stringify({ type: 'done' }));
  });
}

function processStreamLine(line, ws) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return; // skip non-JSON lines
  }

  // Extract text content from various event types
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    ws.send(JSON.stringify({ type: 'text', text: event.delta.text }));
  }

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        ws.send(JSON.stringify({ type: 'text', text: block.text }));
      }
    }
  }

  // Capture session ID for resume
  if (event.type === 'result' && event.session_id) {
    sessionId = event.session_id;
    console.log(`Session ID: ${sessionId}`);
  }

  // Forward result metadata
  if (event.type === 'result') {
    ws.send(JSON.stringify({
      type: 'result',
      cost_usd: event.cost_usd || 0,
      duration_ms: event.duration_ms || 0,
      session_id: event.session_id
    }));
  }
}
