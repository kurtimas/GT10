#!/usr/bin/env bash
#===============================================================================
#  GTv8Beta — Grain Tracker v2  |  One-shot VPS setup for fresh Ubuntu 24.04
#===============================================================================

set -euo pipefail
IFS=$'\n\t'

#===============================================================================
#  CONFIG
#===============================================================================
GIT_REPO_URL="https://github.com/kurtimas/GTv9.git"
GIT_BRANCH=""
REPO_DIR="/opt/GTv9"
DEPLOY_DIR="/opt/gtv9-deploy"
SEED_DEMO="false"

DOMAIN="grain.kurt.wtf"
ADMIN_USER="vpsadmin"
# Set at runtime — export ADMIN_PASSWORD before running, or answer the prompt
# below. Never commit a real password to this file.
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

INSTALL_GUI=true
INSTALL_BROWSER=true
RDP_VIA_TUNNEL=false

SSH_PORT=22
DISABLE_ROOT_SSH=true
DISABLE_PASSWORD_SSH=false

TIMEZONE="America/Los_Angeles"
BACKUP_RETENTION_DAYS=14

#===============================================================================
#  HELPERS
#===============================================================================
log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo -i, then ./gtv8-vps-setup.sh"

# Strip protocol from DOMAIN if user pasted a full URL
DOMAIN=${DOMAIN#https://}
DOMAIN=${DOMAIN#http://}

#-------------------------------------------------------------------------------
log "1/10  System update + essentials"
#-------------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg lsb-release \
    git unzip zip tar jq htop net-tools openssl \
    software-properties-common apt-transport-https \
    ufw fail2ban unattended-upgrades nano vim cron

timedatectl set-timezone "$TIMEZONE" || warn "Timezone '$TIMEZONE' not applied"

# Ensure swap exists — mysql:8 plus the desktop GUI won't fit a small VPS without it.
if ! swapon --show | grep -q .; then
    if [[ ! -f /swapfile ]]; then
        fallocate -l 2G /swapfile 2>/dev/null \
            || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
    fi
    swapon /swapfile 2>/dev/null || warn "Could not enable swap."
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap enabled (2 GB) — small-VPS safety for MySQL."
fi

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

#-------------------------------------------------------------------------------
log "2/10  Admin user: $ADMIN_USER"
#-------------------------------------------------------------------------------
if ! id "$ADMIN_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$ADMIN_USER"
    if [[ -z "$ADMIN_PASSWORD" ]]; then
        read -r -s -p "Set a login password for $ADMIN_USER: " ADMIN_PASSWORD; echo
    fi
    [[ -n "$ADMIN_PASSWORD" ]] || die "Admin password required — re-run with ADMIN_PASSWORD='<password>' ./gtv8-vps-setup.sh"
    echo "${ADMIN_USER}:${ADMIN_PASSWORD}" | chpasswd
    usermod -aG sudo "$ADMIN_USER"
fi
if [[ -s /root/.ssh/authorized_keys && ! -s /home/$ADMIN_USER/.ssh/authorized_keys ]]; then
    mkdir -p /home/$ADMIN_USER/.ssh
    cp /root/.ssh/authorized_keys /home/$ADMIN_USER/.ssh/authorized_keys
    chown -R $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.ssh
    chmod 700 /home/$ADMIN_USER/.ssh
    chmod 600 /home/$ADMIN_USER/.ssh/authorized_keys
    log "Copied your SSH key from root to $ADMIN_USER."
fi

#-------------------------------------------------------------------------------
log "3/10  Hardening: UFW + fail2ban + SSH"
#-------------------------------------------------------------------------------
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment 'SSH'
[[ "$INSTALL_GUI" == true && "$RDP_VIA_TUNNEL" == false ]] && ufw allow 3389/tcp comment 'RDP'
if [[ -n "$DOMAIN" ]]; then
    ufw allow 80/tcp  comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
else
    ufw allow 3000/tcp comment 'App'
fi
ufw --force enable

cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime=1h
findtime=10m
maxretry=5
backend=systemd
[sshd]
enabled=true
port=$SSH_PORT
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-gtv8-hardening.conf <<EOF
Port $SSH_PORT
PermitRootLogin $( [[ "$DISABLE_ROOT_SSH" == true ]] && echo "no" || echo "prohibit-password" )
PasswordAuthentication $( [[ "$DISABLE_PASSWORD_SSH" == true ]] && echo "no" || echo "yes" )
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding yes
EOF
sshd -t && systemctl restart ssh
warn "Root SSH login is now disabled. Use '$ADMIN_USER' from now on."

#-------------------------------------------------------------------------------
if [[ "$INSTALL_GUI" == true ]]; then
log "4/10  XFCE4 + XRDP"
#-------------------------------------------------------------------------------
    apt-get install -y --no-install-recommends \
        xorg xfce4 xfce4-terminal xfce4-goodies dbus-x11 xrdp xorgxrdp

    echo "startxfce4" > /home/$ADMIN_USER/.xsession
    chown $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.xsession

    mkdir -p /etc/polkit-1/localauthority/50-local.d
    cat > /etc/polkit-1/localauthority/50-local.d/45-allow-colord.pkla <<'EOF'
[Allow Colord all Users]
Identity=unix-user:*
Action=org.freedesktop.color-manager.create-device;org.freedesktop.color-manager.create-profile;org.freedesktop.color-manager.delete-device;org.freedesktop.color-manager.delete-profile;org.freedesktop.color-manager.modify-device;org.freedesktop.color-manager.modify-profile
ResultAny=no
ResultInactive=no
ResultActive=yes
EOF

    adduser xrdp ssl-cert >/dev/null 2>&1 || true
    systemctl enable --now xrdp
    systemctl restart xrdp

    if [[ "$INSTALL_BROWSER" == true ]]; then
        snap install chromium 2>/dev/null && log "Chromium installed." || warn "Snap unavailable — skipping browser."
    fi
else
    log "4/10  GUI skipped"
fi

#-------------------------------------------------------------------------------
log "5/10  Docker CE + Compose"
#-------------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$ADMIN_USER" || true

# The block above only installs the Compose plugin when Docker itself was
# missing. A server that already had Docker (docker.io, snap, or an older
# Docker CE) reaches here without the plugin, and step 8 then fails with
# "docker: unknown command: docker compose". Verify and install if needed.
if ! docker compose version &>/dev/null; then
    warn "Docker is present but the Compose v2 plugin is not — installing it."
    if apt-get install -y docker-compose-plugin 2>/dev/null \
        || apt-get install -y docker-compose-v2 2>/dev/null; then
        :
    else
        # Universal fallback: plugin binary straight from the Compose releases.
        COMPOSE_ARCH=$(uname -m); [[ "$COMPOSE_ARCH" == "aarch64" ]] && COMPOSE_ARCH=aarch64 || COMPOSE_ARCH=x86_64
        install -m 0755 -d /usr/local/lib/docker/cli-plugins
        curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${COMPOSE_ARCH}" \
            -o /usr/local/lib/docker/cli-plugins/docker-compose \
            && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
            || die "Could not install the Docker Compose plugin by any method."
    fi
fi
docker compose version &>/dev/null \
    || die "'docker compose' still unavailable. Install the Compose v2 plugin manually, then re-run this script."
log "Compose: $(docker compose version --short 2>/dev/null || echo ok)"

#-------------------------------------------------------------------------------
log "6/10  Cloning repo"
#-------------------------------------------------------------------------------
[[ -z "$GIT_BRANCH" ]] && GIT_BRANCH=$(git ls-remote --symref "$GIT_REPO_URL" HEAD 2>/dev/null \
    | awk '/^ref:/ {sub("refs/heads/","",$2); print $2}')
GIT_BRANCH=${GIT_BRANCH:-main}
log "Branch: $GIT_BRANCH"

if [[ -d "$REPO_DIR/.git" ]]; then
    # Deployment clone is disposable: hard-align to the remote so a rewritten
    # history or a previously patched Dockerfile can never break the update.
    git -C "$REPO_DIR" fetch --all
    git -C "$REPO_DIR" checkout -f "$GIT_BRANCH"
    git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"
else
    git clone --branch "$GIT_BRANCH" --single-branch "$GIT_REPO_URL" "$REPO_DIR"
fi

[[ -f "$REPO_DIR/app/Dockerfile" ]] || die "No Dockerfile at $REPO_DIR/app"
[[ -f "$REPO_DIR/package-lock.json" ]] \
    || die "Missing $REPO_DIR/package-lock.json — the Docker build runs npm ci at the repo root"

#-------------------------------------------------------------------------------
log "7/10  Generating stack in $DEPLOY_DIR"
#-------------------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR"

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    MYSQL_ROOT_PW=$(openssl rand -hex 24)
    MYSQL_PW=$(openssl rand -hex 24)
    # Password for the APP's admin dialogs (sites/farmers/lots/bins/sync) —
    # distinct from the Linux login password above, on purpose.
    APP_ADMIN_PW=$(openssl rand -base64 18)
    # Shared secret for app → office end-of-day sync. The office portal
    # FAILS CLOSED without it (503 on every sync request), so it must exist
    # here even though the office usually runs on a different machine — copy
    # it into the office's environment (SYNC_KEY) and into the app's
    # Settings → Main-office sync (the "officeKey" setting).
    SYNC_KEY=$(openssl rand -hex 32)
    cat > "$DEPLOY_DIR/.env" <<EOF
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PW
MYSQL_DATABASE=graintracker
MYSQL_USER=grain
MYSQL_PASSWORD=$MYSQL_PW
DATABASE_URL=mysql://grain:$MYSQL_PW@mysql:3306/graintracker
SEED_DEMO=$SEED_DEMO
ADMIN_PASSWORD=$APP_ADMIN_PW
# Shared app↔office sync key (x-gt-sync-key). Required by the office portal.
SYNC_KEY=$SYNC_KEY
# Day boundaries (daily report, end-of-day close) follow this zone.
TZ=$TIMEZONE
EOF
    chmod 600 "$DEPLOY_DIR/.env"
    log "Generated secrets."
    log "APP admin password (for the app's admin dialogs) — save it now:"
    printf '    %s\n' "$APP_ADMIN_PW"
    log "SYNC_KEY (office portal + app sync settings) — save it now:"
    printf '    %s\n' "$SYNC_KEY"
else
    log "Keeping existing .env"
    # Older deploys predate SYNC_KEY — the office receiver fails closed
    # without it, so backfill it into the kept .env rather than leaving a
    # silently broken sync path.
    if ! grep -q '^SYNC_KEY=' "$DEPLOY_DIR/.env"; then
        SYNC_KEY=$(openssl rand -hex 32)
        printf '\n# Shared app↔office sync key (x-gt-sync-key). Required by the office portal.\nSYNC_KEY=%s\n' "$SYNC_KEY" >> "$DEPLOY_DIR/.env"
        log "Backfilled SYNC_KEY into existing .env — save it now:"
        printf '    %s\n' "$SYNC_KEY"
    fi
fi

[[ -n "$DOMAIN" ]] && APP_BIND="127.0.0.1:3000:3000" || APP_BIND="3000:3000"

cat > "$DEPLOY_DIR/docker-compose.yml" <<EOF
services:
  mysql:
    image: mysql:8
    container_name: grain-mysql
    restart: unless-stopped
    # Low-memory tuning so mysql:8 fits small VPSes that also run the XFCE/XRDP desktop.
    command:
      - --performance_schema=OFF
      - --innodb_buffer_pool_size=128M
      - --max_connections=40
      - --key_buffer_size=8M
      - --table_open_cache=200
    env_file: .env
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      # mysql:8 (2026 builds) no longer ships healthcheck.sh — use mysqladmin,
      # which is part of the server itself.
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p$$MYSQL_ROOT_PASSWORD --silent"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 60s
    networks: [grain-net]

  app:
    build:
      # npm-workspaces monorepo: the Dockerfile expects the REPO ROOT as its
      # build context (see the header of app/Dockerfile)
      context: $REPO_DIR
      dockerfile: app/Dockerfile
    image: grain-tracker:latest
    container_name: grain-tracker
    restart: unless-stopped
    env_file: .env
    ports:
      - "$APP_BIND"
    depends_on:
      mysql:
        condition: service_healthy
    networks: [grain-net]

volumes:
  mysql-data:

networks:
  grain-net:
EOF

#-------------------------------------------------------------------------------
log "8/10  Building app (this takes a few minutes)"
#-------------------------------------------------------------------------------
cd "$DEPLOY_DIR"
docker compose pull mysql

# Build with plain output so errors are visible
if ! docker compose build --progress=plain app 2>&1 | tee /tmp/gtv8-build.log; then
    warn "Docker build failed. Last 80 lines of build log:"
    tail -n 80 /tmp/gtv8-build.log
    die "Build failed. Check /tmp/gtv8-build.log for full output."
fi

docker compose up -d

log "Waiting for app..."
for i in $(seq 1 36); do
    if curl -fsS -o /dev/null "http://127.0.0.1:3000" 2>/dev/null; then
        log "App responding on port 3000."
        break
    fi
    sleep 5
    [[ $i -eq 36 ]] && warn "App not responding — check: docker logs -f grain-tracker"
done

#-------------------------------------------------------------------------------
log "9/10  systemd auto-start"
#-------------------------------------------------------------------------------
cat > /etc/systemd/system/grain-tracker.service <<EOF
[Unit]
Description=Grain Tracker (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DEPLOY_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable grain-tracker.service

# Self-contained updater — quoted heredoc on purpose: REPO_DIR/DEPLOY_DIR/
# BRANCH are taken from arguments (defaults match the CONFIG block above),
# so nothing here is interpolated at install time.
cat > /usr/local/sbin/grain-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="${1:-/opt/GTv9}"
DEPLOY_DIR="${2:-/opt/gtv9-deploy}"
BRANCH="${3:-main}"
git -C "$REPO_DIR" fetch --all
git -C "$REPO_DIR" checkout -f "$BRANCH"
git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
# The monorepo Dockerfile requires the REPO ROOT as its build context.
# Repair deploy dirs generated before the workspaces restructure, whose
# compose still points at <repo>/app.
if [ -f "$DEPLOY_DIR/docker-compose.yml" ] \
    && grep -Eq "context: *$REPO_DIR/app *\$" "$DEPLOY_DIR/docker-compose.yml"; then
    echo "Repairing stale compose build context (app/ -> repo root)..."
    sed -i -E "s|(context: *$REPO_DIR/app *)\$|context: $REPO_DIR\n      dockerfile: app/Dockerfile|" \
        "$DEPLOY_DIR/docker-compose.yml"
fi
cd "$DEPLOY_DIR"
docker compose up -d --build
docker image prune -f
echo "Updated."
EOF
chmod +x /usr/local/sbin/grain-update

#-------------------------------------------------------------------------------
log "10/10  Backups + HTTPS"
#-------------------------------------------------------------------------------
mkdir -p /var/backups/grain-tracker
chmod 700 /var/backups/grain-tracker

cat > /usr/local/sbin/grain-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/grain-tracker
KEEP=__KEEP__
TS=$(date +%F_%H%M)
docker exec grain-mysql sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" graintracker' \
    | gzip > "$BACKUP_DIR/graintracker-$TS.sql.gz"
find "$BACKUP_DIR" -name 'graintracker-*.sql.gz' -mtime "+$KEEP" -delete
echo "Backup: $BACKUP_DIR/graintracker-$TS.sql.gz"
EOF
sed -i "s/__KEEP__/$BACKUP_RETENTION_DAYS/" /usr/local/sbin/grain-backup
chmod +x /usr/local/sbin/grain-backup

cat > /etc/cron.d/grain-backup <<'EOF'
0 1 * * * root /usr/local/sbin/grain-backup >/var/log/grain-backup.log 2>&1
EOF

if [[ -n "$DOMAIN" ]]; then
    log "Installing Caddy for https://$DOMAIN"
    apt-get install -y caddy || {
        curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$(dpkg --print-architecture)" \
            -o /usr/bin/caddy && chmod +x /usr/bin/caddy
    }
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF
    systemctl enable --now caddy
    systemctl reload caddy || systemctl restart caddy
fi

#===============================================================================
#  DONE
#===============================================================================
IP=$(curl -fsS4 ifconfig.me 2>/dev/null || curl -fsS4 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

================================================================================
  GRAIN TRACKER v2 — VPS SETUP COMPLETE
================================================================================
  Server IP  : $IP
  Admin user : $ADMIN_USER
  SSH        : $IP:$SSH_PORT
  GUI        : $IP:3389
  App        : $( [[ -n "$DOMAIN" ]] && echo "https://$DOMAIN" || echo "http://$IP:3000" )
================================================================================
EOF