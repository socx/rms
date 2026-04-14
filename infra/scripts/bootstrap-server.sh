#!/usr/bin/env bash
# =============================================================================
# RMS — One-time server bootstrap
# Run once as root (or with sudo) on a fresh Ubuntu 22.04 / 24.04 droplet.
#
# Usage (must run as root):
#   bash infra/scripts/bootstrap-server.sh <deploy_path> <host> <deploy_user>
#
# Examples:
#   bash infra/scripts/bootstrap-server.sh /opt/rms 139.59.188.136 deploy
#   bash infra/scripts/bootstrap-server.sh /opt/rms app.example.com deploy
#
# SSH in as root first:  ssh root@139.59.188.136
# Then fetch and run the script, or scp it up.
#
# After this script completes:
#   1. Clone the repo into <deploy_path> if not already there.
#   2. Copy your .env file to <deploy_path>/.env
#   3. Run: cd <deploy_path> && npm ci && npx prisma generate --schema=packages/db/prisma/schema.prisma
#   4. Start the API:  pm2 start infra/pm2/ecosystem.config.cjs --env production && pm2 save && pm2 startup
#   5. Start worker:   supervisorctl reread && supervisorctl update && supervisorctl start rms-worker
# =============================================================================
set -euo pipefail

# Must be run as root
if [[ "$(id -u)" -ne 0 ]]; then
    echo "ERROR: This script must be run as root. SSH in as root and try again."
    exit 1
fi

DEPLOY_PATH="${1:?Usage: bootstrap-server.sh <deploy_path> <host> <deploy_user>}"
HOST="${2:?Usage: bootstrap-server.sh <deploy_path> <host> <deploy_user>}"
DEPLOY_USER="${3:?Usage: bootstrap-server.sh <deploy_path> <host> <deploy_user>}"

echo "=== RMS Server Bootstrap ==="
echo "Deploy path  : $DEPLOY_PATH"
echo "Host/domain  : $HOST"
echo "Deploy user  : $DEPLOY_USER"
echo ""

# ── 1. System packages ────────────────────────────────────────────────────────
echo "--- Updating apt ---"
apt-get update -qq

echo "--- Installing system dependencies ---"
apt-get install -y -qq \
    curl wget gnupg ca-certificates \
    nginx supervisor \
    python3 python3-venv python3-pip \
    postgresql-client \
    git

# ── 2. Node.js 20 via NodeSource ──────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node --version)" != v20* ]]; then
    echo "--- Installing Node.js 20 ---"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "--- Node.js $(node --version) already installed ---"
fi

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
    echo "--- Installing PM2 ---"
    npm install -g pm2
else
    echo "--- PM2 $(pm2 --version) already installed ---"
fi

# ── 4. Log and web directories ────────────────────────────────────────────────
echo "--- Creating directories ---"
mkdir -p /var/log/rms
mkdir -p /var/www/rms
mkdir -p "$DEPLOY_PATH"
chown "$DEPLOY_USER":"$DEPLOY_USER" /var/log/rms
chown "$DEPLOY_USER":"$DEPLOY_USER" /var/www/rms
chown "$DEPLOY_USER":"$DEPLOY_USER" "$DEPLOY_PATH"

# ── 5. Nginx config ───────────────────────────────────────────────────────────
echo "--- Configuring Nginx ---"

# Detect if HOST looks like an IP address or a domain name
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    # IP address — HTTP only (Let's Encrypt requires a domain)
    cat > /etc/nginx/sites-available/rms <<NGINX
server {
    listen 80;
    server_name $HOST;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # API — proxy to Express
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # React SPA — serve static build
    location / {
        root  /var/www/rms;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
    echo "    NOTE: Nginx configured for HTTP only (no SSL — IP address detected)."
    echo "    To add SSL later, point a domain at this IP and re-run with the domain name."
else
    # Domain name — install Certbot and configure HTTPS
    echo "--- Installing Certbot for SSL ---"
    apt-get install -y -qq certbot python3-certbot-nginx

    cat > /etc/nginx/sites-available/rms <<NGINX
server {
    listen 80;
    server_name $HOST;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $HOST;

    ssl_certificate     /etc/letsencrypt/live/$HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$HOST/privkey.pem;

    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location / {
        root  /var/www/rms;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
    echo "    Run this after the script to obtain your SSL cert:"
    echo "    certbot --nginx -d $HOST --non-interactive --agree-tos -m admin@$HOST"
fi

ln -sf /etc/nginx/sites-available/rms /etc/nginx/sites-enabled/rms
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx

# ── 6. Supervisor config ──────────────────────────────────────────────────────
echo "--- Configuring Supervisor ---"
cat > /etc/supervisor/conf.d/rms-worker.conf <<SUPERVISOR
[program:rms-worker]
command=$DEPLOY_PATH/.venv/bin/python apps/worker/main.py
directory=$DEPLOY_PATH
autostart=true
autorestart=true
startretries=10
startsecs=5
stopwaitsecs=30
stdout_logfile=/var/log/rms/worker-out.log
stderr_logfile=/var/log/rms/worker-error.log
stdout_logfile_maxbytes=10MB
stderr_logfile_maxbytes=10MB
stdout_logfile_backups=5
environment=NODE_ENV="production"
SUPERVISOR

systemctl enable supervisor
systemctl start supervisor

# ── 7. Sudoers — allow deploy user to run supervisorctl without a password ────
echo "--- Configuring sudoers for $DEPLOY_USER ---"
SUDOERS_FILE="/etc/sudoers.d/rms-supervisorctl"
cat > "$SUDOERS_FILE" <<SUDOERS
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/chown -R * /var/www/rms
SUDOERS
chmod 440 "$SUDOERS_FILE"
echo "    $DEPLOY_USER can now run: sudo supervisorctl restart rms-worker"

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Next steps:"
echo "  1. Clone repo (if not done):  git clone git@github.com:socx/rms.git $DEPLOY_PATH"
echo "  2. Copy .env file:            cp /path/to/.env $DEPLOY_PATH/.env"
echo "  3. Install Node deps:         cd $DEPLOY_PATH && npm ci"
echo "  4. Generate Prisma client:    npx prisma generate --schema=packages/db/prisma/schema.prisma"
echo "  5. Create Python venv:        python3 -m venv $DEPLOY_PATH/.venv && $DEPLOY_PATH/.venv/bin/pip install -r apps/worker/requirements.txt"
echo "  6. Start API with PM2:        pm2 start infra/pm2/ecosystem.config.cjs --env production && pm2 save && pm2 startup"
echo "  7. Start worker:              sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl start rms-worker"
echo ""
