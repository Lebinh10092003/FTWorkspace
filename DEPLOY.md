# Deploy FT Workspace (React + Django + SQLite)

Hệ thống được triển khai riêng cho `workspace.fermat.vn` tại:

```text
/var/www/ft-workspace
```

API Django chạy nội bộ tại `127.0.0.1:8001`. Nginx là cổng truy cập công khai. Không sửa hoặc ghi đè cấu hình của `khaothi.fermat.vn`.

---

## 1. Khởi tạo VPS lần đầu

Đăng nhập VPS bằng `root`, sau đó chạy:

```bash
apt update
apt install -y git sudo curl nginx python3 python3-venv python3-pip nodejs npm

# Tạo user chạy ứng dụng nếu chưa có
id workspace >/dev/null 2>&1 || useradd --create-home --home-dir /home/workspace --shell /bin/bash workspace
usermod -aG www-data workspace

# Tạo thư mục dự án
mkdir -p /var/www/ft-workspace
chown -R workspace:www-data /var/www/ft-workspace

# deploy.sh creates the durable SQLite directory automatically under
# /home/workspace/ft-workspace-data; it remains outside the Git checkout.

# Clone repository nếu thư mục chưa phải Git repository
if [ ! -d /var/www/ft-workspace/.git ]; then
    rm -rf /var/www/ft-workspace
    sudo -u workspace -H git clone --branch main \
      https://github.com/Lebinh10092003/FTSocialDashbroad.git \
      /var/www/ft-workspace
fi

cd /var/www/ft-workspace

# Tạo file môi trường lần đầu
if [ ! -f backend/.env ]; then
    sudo -u workspace -H cp backend/.env.example backend/.env
fi

chown workspace:www-data backend/.env
chmod 600 backend/.env
```

Sửa cấu hình production:

```bash
nano /var/www/ft-workspace/backend/.env
```

Các biến tối thiểu:

```env
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=THAY_BANG_CHUOI_BI_MAT_DAI_VA_NGAU_NHIEN
DJANGO_ALLOWED_HOSTS=workspace.fermat.vn
# No database path is required here. deploy.sh and systemd automatically use
# /home/workspace/ft-workspace-data/workspace.sqlite3, outside the Git checkout.
CSRF_TRUSTED_ORIGINS=https://workspace.fermat.vn
BOOTSTRAP_ADMIN_EMAIL=admin@fermat.vn
BOOTSTRAP_ADMIN_PASSWORD=THAY_BANG_MAT_KHAU_MANH
CRON_SECRET=THAY_BANG_CHUOI_BI_MAT_KHAC
```

### Báo cáo cuối tuần

Timer backend `workspace-weekly-report.timer` chạy lúc **16:45 thứ Sáu, giờ
Việt Nam**, trực tiếp trên VPS của web. Timer đọc Lịch công tác rồi cập nhật
một tab nhỏ cho mỗi nhân viên trong Google Sheet báo cáo; không phụ thuộc vào
GitHub Actions. Service account trong `GOOGLE_SERVICE_ACCOUNT_JSON` cần quyền
chỉnh sửa Google Sheet đó.

Tạo chuỗi bí mật:

```bash
openssl rand -hex 48
```

---

## 2. Cấp quyền deploy cho user `workspace`

`deploy.sh` có các lệnh `sudo install` và `sudo systemctl`. Vì vậy cần cấp quyền một lần bằng tài khoản `root`:

```bash
cat > /etc/sudoers.d/workspace-deploy <<'EOF'
workspace ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/systemctl
EOF

chmod 440 /etc/sudoers.d/workspace-deploy
visudo -cf /etc/sudoers.d/workspace-deploy
```

Kết quả đúng:

```text
/etc/sudoers.d/workspace-deploy: parsed OK
```

Nếu deploy báo:

```text
workspace is not in the sudoers file
```

thì phần cấu hình trên chưa được thực hiện hoặc file sudoers không hợp lệ.

---

## 3. Cài Systemd và Nginx lần đầu

Chạy bằng `root`:

```bash
cd /var/www/ft-workspace

cp workspace-django.service /etc/systemd/system/workspace-django.service
cp workspace-social-sync.service /etc/systemd/system/workspace-social-sync.service
cp workspace-social-sync.timer /etc/systemd/system/workspace-social-sync.timer
cp workspace-weekly-report.service /etc/systemd/system/workspace-weekly-report.service
cp workspace-weekly-report.timer /etc/systemd/system/workspace-weekly-report.timer

systemctl daemon-reload
systemctl enable workspace-django.service
systemctl enable --now workspace-social-sync.timer
systemctl enable --now workspace-weekly-report.timer

cp nginx-workspace.conf /etc/nginx/sites-available/workspace.fermat.vn
ln -sfn \
  /etc/nginx/sites-available/workspace.fermat.vn \
  /etc/nginx/sites-enabled/workspace.fermat.vn

nginx -t
systemctl reload nginx
```

---

## 4. Deploy lần đầu trên VPS

Không chạy `deploy.sh` trực tiếp bằng `root`. Chạy bằng user `workspace`:

```bash
sudo -u workspace -H bash -lc 'cd /var/www/ft-workspace && bash deploy.sh'
```

Script sẽ tự động:

- Back up SQLite online before migrations (keep the 30 newest copies in `/home/workspace/ft-workspace-data/backups`);
- On first use of `DJANGO_DB_PATH`, safely copy the existing `backend/db.sqlite3` to the durable location;


- lấy code mới nhất bằng `git pull --ff-only`;
- tạo hoặc dùng lại `.venv`;
- cài thư viện Python;
- chạy Django migrations;
- chạy `collectstatic`;
- cài thư viện Node.js;
- build React với `VITE_API_URL=/api`;
- cập nhật timer đồng bộ dữ liệu;
- restart Django;
- kiểm tra API health.

Cảnh báo sau không làm deploy thất bại:

```text
Some chunks are larger than 500 kB after minification
```

Đây chỉ là cảnh báo tối ưu dung lượng JavaScript của Vite.

---

## 5. Một lệnh deploy và restart từ Windows CMD

Sau khi VPS đã được khởi tạo đầy đủ, mở **Command Prompt trên Windows** và chạy một lệnh sau:

```cmd
ssh root@IP_VPS "sudo -u workspace -H git -C /var/www/ft-workspace fetch origin main && sudo -u workspace -H git -C /var/www/ft-workspace reset --hard origin/main && sudo -u workspace -H bash -lc 'cd /var/www/ft-workspace && bash deploy.sh' && systemctl restart workspace-django.service workspace-social-sync.timer nginx && curl -fsS http://127.0.0.1:8001/api/health/"
```

Thay `IP_VPS` bằng địa chỉ IP thật của VPS.

Ví dụ:

```cmd
ssh root@103.000.000.000 "sudo -u workspace -H git -C /var/www/ft-workspace fetch origin main && sudo -u workspace -H git -C /var/www/ft-workspace reset --hard origin/main && sudo -u workspace -H bash -lc 'cd /var/www/ft-workspace && bash deploy.sh' && systemctl restart workspace-django.service workspace-social-sync.timer nginx && curl -fsS http://127.0.0.1:8001/api/health/"
```

Lệnh trên thực hiện đầy đủ:

1. Kết nối vào VPS.
2. Lấy code mới nhất từ nhánh `main`.
3. Reset mã nguồn trên VPS về đúng trạng thái của `origin/main`.
4. Build lại backend và frontend.
5. Chạy migration và collectstatic.
6. Restart Django, timer đồng bộ và Nginx.
7. Kiểm tra API health.

Lệnh `git reset --hard origin/main` chỉ reset các file được Git quản lý. File `backend/.env`, `backend/db.sqlite3`, uploads và các file không được commit vẫn được giữ lại.

---

## 6. Tạo file CMD để lần sau chỉ gõ `deploy-workspace`

Trên máy Windows, tạo file:

```text
deploy-workspace.cmd
```

Nội dung:

```bat
@echo off
ssh root@IP_VPS "sudo -u workspace -H git -C /var/www/ft-workspace fetch origin main && sudo -u workspace -H git -C /var/www/ft-workspace reset --hard origin/main && sudo -u workspace -H bash -lc 'cd /var/www/ft-workspace && bash deploy.sh' && systemctl restart workspace-django.service workspace-social-sync.timer nginx && curl -fsS http://127.0.0.1:8001/api/health/"

if errorlevel 1 (
    echo.
    echo DEPLOY THAT BAI
    pause
    exit /b 1
)

echo.
echo DEPLOY THANH CONG
pause
```

Thay `IP_VPS` bằng IP thật. Đặt file này trong thư mục đã được thêm vào biến môi trường `PATH` của Windows. Sau đó chỉ cần mở CMD và chạy:

```cmd
deploy-workspace
```

---

## 7. Chỉ restart dịch vụ, không pull code

Từ Windows CMD:

```cmd
ssh root@IP_VPS "systemctl restart workspace-django.service workspace-social-sync.timer nginx && systemctl --no-pager --full status workspace-django.service"
```

---

## 8. Khởi động lại toàn bộ VPS

Chỉ dùng khi thật sự cần reboot hệ điều hành:

```cmd
ssh root@IP_VPS "reboot"
```

Sau khi VPS hoạt động trở lại, kiểm tra:

```cmd
ssh root@IP_VPS "systemctl is-active workspace-django.service nginx && curl -fsS http://127.0.0.1:8001/api/health/"
```

---

## 9. Kiểm tra và xử lý lỗi

Kiểm tra Django:

```bash
systemctl status workspace-django.service --no-pager
journalctl -u workspace-django.service -n 100 --no-pager
```

Kiểm tra timer đồng bộ:

```bash
systemctl list-timers workspace-social-sync.timer
systemctl status workspace-social-sync.service --no-pager
journalctl -u workspace-social-sync.service -n 100 --no-pager
```

Kiểm tra Nginx:

```bash
nginx -t
systemctl status nginx --no-pager
```

Kiểm tra API:

```bash
curl -i http://127.0.0.1:8001/api/health/
curl -I https://workspace.fermat.vn
```

---

## 10. GitHub Actions deployment

Push lên nhánh `main` sẽ chạy CI. Deployment chỉ hoạt động khi repository variable sau được cấu hình:

```text
DEPLOY_ENABLED=true
```

Repository variables:

- `DEPLOY_ENABLED`: `true`
- `VPS_HOST`: IP VPS hoặc `workspace.fermat.vn`
- `VPS_PORT`: thường là `22`
- `VPS_USERNAME`: thường là `workspace`

Repository secrets:

- `VPS_SSH_PRIVATE_KEY`: private key dành riêng cho GitHub Actions
- `VPS_KNOWN_HOSTS`: SSH host-key đã xác minh của VPS

Không commit private key hoặc nội dung `backend/.env` lên repository.
