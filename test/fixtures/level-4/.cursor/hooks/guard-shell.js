// Gate hook: denies destructive shell commands before they run.
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const command = String(payload.command ?? '');
  const destructive = /\brm\s+-rf\s+[\/~]|\bgit\s+push\s+--force\b|\bdrop\s+table\b/i;
  if (destructive.test(command)) {
    process.stdout.write(JSON.stringify({ permission: 'deny', userMessage: 'Blocked destructive command.' }));
  } else {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
  }
});
