# 腾讯云轻量（首尔）部署清单

面向「人在北京、家中联通宽带、偶尔手机联通外网访问」的个人部署，配套套餐为腾讯云轻量入门型 2 核 4G / 30M（约 199 元/年）。其他机房的步骤相同，只需替换域名与地域。

无域名也能用受浏览器信任的 HTTPS：用公网 IP 派生的 `1-2-3-4.sslip.io` 名字申请 Let's Encrypt 证书，签发与续期由 [`scripts/https-setup.sh`](../scripts/https-setup.sh) 自动完成。

> 隐私提醒：错题本含学生姓名、题目图片等个人信息。服务器在境外属于个人信息出境，自己/家人使用影响小，对外开放注册前请先了解《个人信息保护法》相关要求。

---

## 0. 采购与前置确认

| 项目 | 建议取值 | 说明 |
| --- | --- | --- |
| 地域 | **首尔** | 地域和可用区创建后不能修改，下单前确认 |
| 套餐 | 入门型 2 核 4G / 30M | 联通方向回程直连，性价比最高；确认是否支持同价续费 |
| 操作系统 | Ubuntu 24.04 LTS | 脚本里的 `apt`、`certbot` 依赖它 |
| 控制台防火墙 | 放行 TCP **80、443** | 80 用于 Let's Encrypt 校验，443 对外服务 |
| ICP 备案 | 不需要 | 境外地域不涉及备案 |

下单前最好先确认首尔有货——促销套餐按地域分配库存，缺货时硅谷（延迟高约 100ms）也能用。

---

## 1. 系统初始化

```bash
# 本机：改用密钥登录，禁用密码
ssh-keygen -t ed25519 -C "wrong-notebook"
ssh-copy-id root@<服务器IP>

# 服务器：更新系统、校准时间
apt update && apt upgrade -y
timedatectl set-timezone Asia/Shanghai
```

轻量的**控制台防火墙**要放行 80/443；如果开了 `ufw`，还要：

```bash
ufw allow 80/tcp && ufw allow 443/tcp
```

应用时区不靠系统变量：默认 `Asia/Shanghai`，可在「设置 → 通用 → 应用时区」修改（见 [时区文档](TIME_ZONE.md)）。

---

## 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

---

## 3. 目录与 Compose

```bash
mkdir -p /root/wrong-notebook/{data,config,certs}
cd /root/wrong-notebook
openssl rand -base64 32        # 生成 NEXTAUTH_SECRET，复制到下面
```

`/root/wrong-notebook/docker-compose.yml`：

```yaml
services:
  wrong-notebook:
    image: ghcr.io/margrop/wrong-notebook:2026.11.6   # 建议固定版本，便于回退
    container_name: wrong-notebook
    restart: unless-stopped
    ports:
      - "443:443"        # 只映射 443；80 留给 Let's Encrypt 校验
    environment:
      - NEXTAUTH_URL=https://1-2-3-4.sslip.io   # 换成第 5 步算出的名字
      - NEXTAUTH_SECRET=粘贴上一步生成的值
      - AUTH_TRUST_HOST=true
      - PRESERVE_EXISTING_DATA=true
      # 内置 HTTPS：证书从 /app/certs 读取，缺失时自动生成自签名
      - HTTPS_ENABLED=true
      - CERT_DOMAIN=1-2-3-4.sslip.io
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./certs:/app/certs
```

要点：

- **不要映射 80**。`certbot` 申请/续期时独占 80 端口做 HTTP-01 校验；映射了会被脚本临时停容器（能成功，但多一次中断）。
- 首次启动没有证书时，容器会按 `CERT_DOMAIN` 生成自签名证书（有效期 10 年），浏览器会提示"不安全"，第 5 步换成受信任证书后消失。
- `NEXTAUTH_URL` 必须是最终 HTTPS 地址：Cookie 的 `Secure` 标志由它是否以 `https` 开头决定（见 [src/lib/auth.ts](../src/lib/auth.ts)）。

---

## 4. 首次启动与初始化

```bash
cd /root/wrong-notebook
docker compose up -d
docker compose logs --tail=100 wrong-notebook | grep -i initialize
# 也可以直接取令牌
cat config/setup-token
curl -k https://127.0.0.1/api/health       # 期望 {"status":"ok",...}
```

日志里给出的初始化链接形如 `http://localhost:3000/initialize?token=...`，把主机部分换成 `https://1-2-3-4.sslip.io` 再打开，设置管理员邮箱和密码（令牌一次性使用，用完自动删除）。登录后进入安装向导，配置 AI 渠道和第一个错题本。

> AI Key 用 MiniMax / 智谱 / DeepSeek 等国内渠道同样可行；首尔机房也能直连 OpenAI / Gemini / Anthropic。建议在「设置 → AI 设置」里用"测试"按钮当场验证，避免上线后才发现 Key 或出口被风控。

---

## 5. HTTPS 证书（三种做法）

### 方案 A：一键申请 + 自动续期（推荐）

```bash
cd /root/wrong-notebook
curl -fsSL -o https-setup.sh \
  https://raw.githubusercontent.com/margrop/wrong-notebook/main/scripts/https-setup.sh
sudo bash https-setup.sh --email you@example.com
docker compose up -d
```

脚本会：

1. 用公网 IP 推导 `1-2-3-4.sslip.io`（也可 `--domain` 传自己的域名）；
2. 缺 `certbot` 时用 `apt` 安装；
3. 临时停容器让出 80 端口，用 HTTP-01 签发 Let's Encrypt 证书；
4. 把证书写入 `certs/cert.pem`、`certs/key.pem`（容器启动时 `chown` 给 `nextjs`）；
5. 生成部署钩子 + `/etc/cron.d/wrong-notebook-cert`：证书续期成功后自动更新文件并重启容器。

验证：

```bash
certbot renew --dry-run                       # 演练续期链路
curl -fsS https://1-2-3-4.sslip.io/api/health
docker exec wrong-notebook ls -l /app/certs   # cert.pem 644 / key.pem 600
```

日常无需干预：证书 90 天有效，`cron` 每日 03:12 检查，剩余约 1/3 时续期，续期后钩子自动重启容器。

### 方案 B：自有证书或其他 CA

把 `fullchain.pem` 和 `privkey.pem` 改名放到 `certs/cert.pem`、`certs/key.pem`，同步修改 `CERT_DOMAIN`、`NEXTAUTH_URL`，再 `docker compose up -d`。证书更新后必须重启容器（证书只在启动时读取）。

### 方案 C：先不折腾证书

保持自签名证书即可正常使用（浏览器点"高级 → 继续"），屏幕截图等需要安全上下文的功能也能用。缺点是在别人手机、微信里打开会看到红色警告，不适合分享。

---

## 6. 备份与恢复

SQLite 在运行中直接打包可能拿到不一致的副本，先停容器再归档：

`/root/wn-backup.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /root/wrong-notebook
mkdir -p /root/backups
docker compose stop wrong-notebook
tar -czf "/root/backups/wn-$(date +%F).tar.gz" data config
docker compose start wrong-notebook
find /root/backups -name 'wn-*.tar.gz' -mtime +14 -delete
```

```bash
chmod 700 /root/wn-backup.sh
echo '30 3 * * * root /root/wn-backup.sh' > /etc/cron.d/wn-backup
```

- 备份含 `config/` 里的 AI Key，`/root/backups` 权限保持 `700`。
- 恢复：`docker compose stop` → `tar -xzf 备份文件` → `docker compose up -d`。
- 双保险：腾讯云控制台给实例开**快照**，并定期在应用内「设置 → 导出」下载 JSON 备份（不含 `config/`）。

---

## 7. 验收清单

| 检查项 | 方法 | 期望 |
| --- | --- | --- |
| 健康检查 | `curl -fsS https://域名/api/health` | `{"status":"ok"}` |
| 证书受信任 | 浏览器打开，点证书图标 | 无警告，有效期内 |
| 初始化 | 日志里的 `/initialize?token=...` | 能创建管理员，令牌用后失效 |
| 核心链路 | 手机拍照上传一道题 | 生成错题、有知识点标签 |
| AI 识别 | 初次导入后等待解析完成 | 无超时、无 403 |
| 屏幕截图 | 网页端点击截图按钮 | 能弹出选择窗口（需 HTTPS） |
| 外网访问 | 关掉 WiFi，用联通流量打开 | 页面可加载、可登录 |
| 重启不丢数据 | `docker compose restart` | 账户、错题、设置都在 |
| 续期链路 | `certbot renew --dry-run` | 通过 |

联通家庭宽带参考延迟：白天 40–70ms，晚高峰 60–100ms。21:00–23:00 是跨境链路拥塞时段，尽量别安排大批量导入。

---

## 8. 排错

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 443 连不上 | 控制台防火墙未放行 / 容器没起 | 放行 443；`docker compose logs --tail=50` |
| 浏览器仍提示不安全 | 用的是自签名证书 / 证书未挂载 | `docker exec wrong-notebook ls -l /app/certs`；确认挂载路径 |
| 签发失败 | 80 未放行、域名解析不对、端口被占 | `mtr`/`curl http://域名` 验证 80；看 `/var/log/letsencrypt/letsencrypt.log` |
| 续期后证书没变 | 钩子没跑或容器没重启 | 手动 `sudo bash /usr/local/bin/wn-cert-deploy.sh`，再 `docker restart wrong-notebook` |
| 登录后立刻掉线 | `NEXTAUTH_URL` 与访问地址不一致 | 改成实际 `https://…` 后重启容器 |
| 晚高峰很卡/丢包 | 跨境链路拥塞（入门型走普通回程） | 用 `mtr` 看是否只有 AS4134；错峰导入；必要时换机房 |
| AI 返回 403/超时 | Key 无效或机房 IP 被风控 | 在「设置 → AI 设置」测试；换渠道或换机房 |
| 磁盘占满 | 镜像/日志堆积 | `docker system prune -af`；清理 `/root/backups` |

---

## 9. 安全与合规

- 管理员密码用强口令；不需要开放注册时在「设置 → 用户管理」关闭注册。
- 只放行 80/443；SSH 用密钥并把来源限制在常用 IP。
- 升级镜像：改 compose 里的版本标签 → `docker compose pull && docker compose up -d`，升级前先跑第 6 节的备份。
- 不把 `config/`（含 AI Key）、`data/` 打进任何公开仓库或聊天记录。

---

## 附：命令速查

```bash
# 首次部署
mkdir -p /root/wrong-notebook/{data,config,certs} && cd /root/wrong-notebook
openssl rand -base64 32                                  # 填入 NEXTAUTH_SECRET
curl -fsSL https://get.docker.com | sh
# 写好 docker-compose.yml（第 3 节）后
docker compose up -d && docker compose logs -f --tail=100 wrong-notebook

# HTTPS
curl -fsSL -o https-setup.sh https://raw.githubusercontent.com/margrop/wrong-notebook/main/scripts/https-setup.sh
sudo bash https-setup.sh --email you@example.com && docker compose up -d

# 日常
docker compose ps
curl -fsS https://1-2-3-4.sslip.io/api/health
certbot renew --dry-run
```
