const cp = require('child_process');
const path = require('path');

const waitForHealth = (url, timeout = 10000) => {
  const start = Date.now();
  const { URL } = require('url');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const check = () => {
      const u = new URL(url + '/health');
      const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', timeout: 2000 }, res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          return resolve(true);
        }
        res.resume();
        if (Date.now() - start < timeout) return setTimeout(check, 200);
        return reject(new Error('Health check timeout'));
      });
      req.on('error', () => {
        if (Date.now() - start < timeout) return setTimeout(check, 200);
        return reject(new Error('Health check timeout'));
      });
      req.end();
    };
    check();
  });
};

const startServer = async (expectedPort = 3000, opts = {}) => {
  const indexPath = path.resolve(__dirname, '..', 'index.js');
  process.env.PORT = process.env.PORT || '0';
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const env = Object.assign({}, process.env, { PORT: '0', NODE_TLS_REJECT_UNAUTHORIZED: '0' });
  const proc = cp.spawn(process.execPath, [indexPath], { stdio: ['ignore', 'pipe', 'pipe'], env });
  let serverPort = null;
  let serverIsHttps = false;
  proc.stdout.on('data', d => {
    try { process.stdout.write('[api] ' + d); } catch (e) {}
    try {
      const s = d.toString();
      serverIsHttps = /\(https\)/i.test(s) || serverIsHttps;
      const m = s.match(/listening(?:\s*\(https\))? on port\s*(\d+)/i);
      if (m) serverPort = parseInt(m[1], 10);
    } catch (e) {}
  });
  proc.stderr.on('data', d => { try { process.stderr.write('[api.err] ' + d); } catch (e) {} });

  const start = Date.now();
  const timeout = opts.timeout || 15000;
  while (true) {
    if (serverPort) {
      const baseUrl = `${serverIsHttps ? 'https' : 'http'}://localhost:${serverPort}`;
      return { proc, baseUrl, port: serverPort, isHttps: serverIsHttps };
    }
    try {
      await waitForHealth(`http://localhost:${expectedPort}`, 2000);
      const baseUrl = `http://localhost:${expectedPort}`;
      return { proc, baseUrl, port: expectedPort, isHttps: false };
    } catch (e) {
      if (Date.now() - start > timeout) {
        proc.kill();
        throw new Error('Health check timeout waiting for server');
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }
};

const stopServer = async (info) => {
  try {
    if (!info) return;
    const p = info.proc || info;
    if (p && !p.killed) p.kill();
  } catch (e) {}
};

module.exports = { startServer, stopServer };
