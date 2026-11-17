#!/usr/bin/env bash
#
# 公网服务器（腾讯云轻量等）一键申请 + 自动续期 HTTPS 证书
#
# 适用场景：没有域名，用公网 IP 派生的 sslip.io 名字（1.2.3.4 -> 1-2-3-4.sslip.io）。
# 也可以传入自己的域名（--domain）走同一套流程。
#
# 做的事：
#   1. 没有域名时用公网 IP 生成 sslip.io 名字
#   2. 缺少 certbot 时用 apt 安装
#   3. 临时停掉容器让出 80 端口，用 HTTP-01 签发 Let's Encrypt 证书
#   4. 把证书落到挂载目录 certs/cert.pem、certs/key.pem（容器启动时读取）
#   5. 写入部署钩子 + cron：续期成功后自动更新证书并重启容器
#
# 用法（在服务器上以 root 执行）：
#   sudo bash scripts/https-setup.sh --email you@example.com
#   sudo bash scripts/https-setup.sh --domain 1-2-3-4.sslip.io --email you@example.com
#   sudo bash scripts/https-setup.sh --dry-run --email you@example.com   # 只演练，不改任何东西
#
# 注意：HTTP-01 校验要求服务器的 80 端口对外开放（腾讯云控制台防火墙 + 系统防火墙都要放行）。

set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
CERT_DIR="${CERT_DIR:-/root/wrong-notebook/certs}"
CONTAINER="${CONTAINER:-wrong-notebook}"
COMPOSE_DIR="${COMPOSE_DIR:-/root/wrong-notebook}"
CRON_FILE="${CRON_FILE:-/etc/cron.d/wrong-notebook-cert}"
HOOK_PATH="${HOOK_PATH:-/usr/local/bin/wn-cert-deploy.sh}"
LE_LIVE_DIR="${LE_LIVE_DIR:-/etc/letsencrypt/live}"
DRY_RUN=0
FORCE=0
NO_CRON=0
STOPPED_BY_US=0

log() { printf '[HTTPS] %s\n' "$*"; }
warn() { printf '[HTTPS] 警告：%s\n' "$*" >&2; }
die() { printf '[HTTPS] 错误：%s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法: https-setup.sh [选项]

  --email <邮箱>        Let's Encrypt 联系邮箱（必填；不填会用 admin@<域名> 并告警）
  --domain <域名>       域名或 IP 派生名，默认自动推导为 <IP>.sslip.io 形式
  --cert-dir <目录>     证书落地目录，默认 /root/wrong-notebook/certs
  --container <名称>    应用容器名，默认 wrong-notebook
  --compose-dir <目录>  compose 所在目录（仅用于提示），默认 /root/wrong-notebook
  --force               已有证书时也重新签发（会消耗 Let's Encrypt 频次额度）
  --no-cron             不安装自动续期 cron
  --dry-run             只演练签发流程，不写证书、不装 cron、不停容器
  -h, --help            显示本帮助
EOF
}

need_value() {
    [ $# -ge 2 ] && [ -n "$2" ] || die "参数 $1 缺少取值"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --email) need_value "$@"; EMAIL="$2"; shift 2 ;;
        --domain) need_value "$@"; DOMAIN="$2"; shift 2 ;;
        --cert-dir) need_value "$@"; CERT_DIR="$2"; shift 2 ;;
        --container) need_value "$@"; CONTAINER="$2"; shift 2 ;;
        --compose-dir) need_value "$@"; COMPOSE_DIR="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --no-cron) NO_CRON=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "未知参数：$1（用 -h 查看帮助）" ;;
    esac
done

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" -ne 1 ]; then
    die "需要 root 权限执行（证书写入 /etc/letsencrypt，cron 写入 /etc）"
fi

public_ip() {
    local ip
    for src in "https://ipv4.icanhazip.com" "https://ifconfig.me/ip"; do
        ip="$(curl -fsS --max-time 8 "$src" 2>/dev/null | tr -d '[:space:]' || true)"
        if [ -n "$ip" ]; then
            printf '%s' "$ip"
            return 0
        fi
    done
    return 1
}

if [ -z "$DOMAIN" ]; then
    ip="$(public_ip)" || die "无法获取公网 IP，请用 --domain 显式指定名字"
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "公网 IP 格式异常：$ip"
    DOMAIN="${ip//./-}.sslip.io"
    log "未指定域名，使用 sslip.io 派生名：$DOMAIN"
fi

[[ "$DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || die "域名格式不合法：$DOMAIN"
[ "${#DOMAIN}" -le 253 ] || die "域名过长：$DOMAIN"

if [ -z "$EMAIL" ]; then
    EMAIL="admin@${DOMAIN}"
    warn "未指定 --email，使用 ${EMAIL}（建议填真实邮箱以便接收证书到期通知）"
fi

[ -d "$COMPOSE_DIR" ] || warn "compose 目录不存在：${COMPOSE_DIR}（仅用于后续提示，不影响签发）"
CERT_DIR_PARENT="$(dirname "$CERT_DIR")"
mkdir -p "$CERT_DIR_PARENT" 2>/dev/null || true

have_docker() { command -v docker >/dev/null 2>&1; }

container_running() {
    have_docker || return 1
    [ -n "$(docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' 2>/dev/null || true)" ]
}

port80_in_use() {
    local out
    if command -v ss >/dev/null 2>&1; then
        out="$(ss -ltn 2>/dev/null || true)"
    elif command -v netstat >/dev/null 2>&1; then
        out="$(netstat -ltn 2>/dev/null || true)"
    else
        return 1
    fi
    printf '%s\n' "$out" | awk '{print $4}' | grep -qE '(:80|\.80)$'
}

cleanup() {
    if [ "$STOPPED_BY_US" -eq 1 ]; then
        if have_docker && docker inspect "$CONTAINER" >/dev/null 2>&1; then
            log "恢复应用容器：$CONTAINER"
            docker start "$CONTAINER" >/dev/null 2>&1 || warn "容器启动失败，请手动检查"
        fi
    fi
}
trap cleanup EXIT

CERT_FULLCHAIN="${LE_LIVE_DIR}/${DOMAIN}/fullchain.pem"

write_hook() {
    mkdir -p "$(dirname "$HOOK_PATH")"
    cat > "$HOOK_PATH" <<EOF
#!/usr/bin/env bash
# 由 scripts/https-setup.sh 生成：证书续期成功后更新挂载目录并重启容器
set -euo pipefail

DOMAIN="${DOMAIN}"
CERT_DIR="${CERT_DIR}"
CONTAINER="${CONTAINER}"
SRC_DIR="${LE_LIVE_DIR}/\${DOMAIN}"

[ -f "\$SRC_DIR/fullchain.pem" ] || exit 0
mkdir -p "\$CERT_DIR"
install -m 644 "\$SRC_DIR/fullchain.pem" "\$CERT_DIR/cert.pem"
install -m 600 "\$SRC_DIR/privkey.pem" "\$CERT_DIR/key.pem"

if command -v docker >/dev/null 2>&1 && docker inspect "\$CONTAINER" >/dev/null 2>&1; then
    docker restart "\$CONTAINER" >/dev/null
fi
printf '[HTTPS] 证书已更新：%s\n' "\$CERT_DIR/cert.pem"
EOF
    chmod 700 "$HOOK_PATH"
}

install_cron() {
    if [ "$NO_CRON" -eq 1 ]; then
        log "已跳过 cron 安装（--no-cron）"
        return
    fi
    mkdir -p "$(dirname "$CRON_FILE")"
    cat > "$CRON_FILE" <<EOF
# 由 scripts/https-setup.sh 生成：每日检查 Let's Encrypt 证书续期
# certbot 会在证书剩余约 1/3 有效期时自动续期，续期成功后执行部署钩子
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
12 3 * * * root certbot renew --quiet
EOF
    chmod 644 "$CRON_FILE"
    log "已写入续期任务：${CRON_FILE}（每日 03:12 检查）"
}

if ! command -v certbot >/dev/null 2>&1; then
    if [ "$DRY_RUN" -eq 1 ]; then
        warn "未安装 certbot（演练模式跳过安装）"
    else
        log "未检测到 certbot，尝试安装…"
        if command -v apt-get >/dev/null 2>&1; then
            apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot \
                || die "certbot 安装失败，请手动安装后重试（apt install certbot）"
        else
            die "当前系统没有 apt-get，请自行安装 certbot 后重试"
        fi
    fi
fi

write_hook
log "部署钩子已写入：$HOOK_PATH"

if [ -f "$CERT_FULLCHAIN" ] && [ "$FORCE" -ne 1 ]; then
    log "已存在 $DOMAIN 的证书，跳过签发（要强制重签加 --force）"
else
    if port80_in_use; then
        if container_running; then
            if [ "$DRY_RUN" -eq 1 ]; then
                warn "80 端口被容器 $CONTAINER 占用；演练模式不会停容器，连通性演练可能因此失败"
            else
                log "80 端口被容器占用，签发期间临时停止：$CONTAINER"
                docker stop "$CONTAINER" >/dev/null
                STOPPED_BY_US=1
                sleep 2
            fi
        else
            die "80 端口已被其他进程占用（HTTP-01 校验需要 80 端口），请先停掉占用方"
        fi
    fi

    log "开始签发证书：$DOMAIN"
    mkdir -p "$CERT_DIR"
    certbot_args=(certonly --standalone --preferred-challenges http
        --non-interactive --agree-tos
        -m "$EMAIL"
        -d "$DOMAIN"
        --deploy-hook "$HOOK_PATH")
    if [ "$DRY_RUN" -eq 1 ]; then
        certbot_args+=(--dry-run)
    fi
    certbot "${certbot_args[@]}" \
        || die "签发失败。排查：80 端口是否对外开放；域名 ${DOMAIN} 是否解析到本机；查看 /var/log/letsencrypt/letsencrypt.log"

    if [ "$DRY_RUN" -eq 1 ]; then
        log "演练成功（未写入证书、未装 cron）"
        exit 0
    fi
    bash "$HOOK_PATH"
fi

install_cron

log "完成。接下来："
cat <<EOF
  1) 确认 compose 中的环境变量（$COMPOSE_DIR/docker-compose.yml）：
       - HTTPS_ENABLED=true
       - CERT_DOMAIN=$DOMAIN
       - NEXTAUTH_URL=https://$DOMAIN
       - AUTH_TRUST_HOST=true
       - 端口映射：443:443（不要映射 80，留给续期校验）
  2) 重启应用：cd $COMPOSE_DIR && docker compose up -d
  3) 验证：
       curl -fsS https://$DOMAIN/api/health
       docker exec $CONTAINER ls -l /app/certs
       certbot renew --dry-run
  4) 续期由 cron 每日 03:12 自动检查；证书更新后钩子会自动重启容器
EOF
