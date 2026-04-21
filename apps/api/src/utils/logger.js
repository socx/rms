const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Emit a structured JSON log line to stdout (info/debug/warn) or stderr (error).
 * Each line is one JSON object so it can be parsed by log aggregators.
 * Format: { level, ts, msg, ...meta }
 */
function write(level, msg, meta = {}) {
  if (IS_TEST) return; // keep test output clean

  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg,
    ...meta,
  });

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export default {
  info:  (msg, meta)  => write('info',  msg, meta),
  warn:  (msg, meta)  => write('warn',  msg, meta),
  error: (msg, meta)  => write('error', msg, meta),
  debug: (msg, meta)  => write('debug', msg, meta),
};
