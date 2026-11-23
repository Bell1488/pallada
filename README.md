# «Паллада» на VPS · pallada.cc

Эта инструкция рассчитана на чистый российский VPS с **Ubuntu Server 24.04 LTS**, публичным IPv4 и доступом по SSH. Понадобятся доступ к DNS домена `pallada.cc`, архив `pallada-site.zip`, Telegram-бот и рабочий SOCKS5-прокси. На действующем сервере с другими сайтами сначала посмотрите примечание в разделе про Caddy.

## 1. Загрузите архив с компьютера

Скачайте архив. В Windows откройте PowerShell в папке, где лежит ZIP. Подставьте пользователя и IP из панели VPS. Следующие две команды выполняются **на компьютере**.

```powershell
scp .\pallada-site.zip ubuntu@IP_СЕРВЕРА:pallada-site.zip
ssh ubuntu@IP_СЕРВЕРА
```

Если хостер выдал вход как `root`, замените `ubuntu` на `root`. Если порт SSH отличается от 22, добавьте `-P НОМЕР` к scp и `-p НОМЕР` к ssh. При первом подключении сверьте отпечаток SSH с данными хостера. Все дальнейшие команды Bash выполняются **в SSH-сессии на VPS** под пользователем с sudo либо под root.

## 2. Привяжите домен

В панели регистратора посмотрите, какие NS-серверы обслуживают домен. Откройте редактор DNS у этого провайдера. Для самого домена выставьте запись ниже.

| Тип | Имя / хост | Значение | TTL |
| --- | --- | --- | --- |
| A | `@` (в некоторых панелях — пустое поле или `pallada.cc`) | Публичный IPv4 вашего VPS | 300 секунд или значение по умолчанию |

Если у корневого домена есть старая A-запись другого сайта, замените её при переключении. Оставляйте AAAA только при рабочем IPv6 именно этого VPS. MX и TXT для почты менять не требуется. Готовая конфигурация обслуживает адрес **https://pallada.cc**. Если DNS-провайдер предлагает свой HTTP-прокси, для первого запуска выберите режим «Только DNS».

В сетевом экране хостера разрешите входящие TCP **80 и 443**, сохранив доступ на свой SSH-порт. Если на Ubuntu уже включён UFW, добавьте правила ниже. Порт 8080 используется локально.

```bash
sudo ufw status
# Только если статус active:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 3. Установите пакеты и Node.js

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip xz-utils dnsutils openssl nano caddy
dig +short A pallada.cc @1.1.1.1
dig +short AAAA pallada.cc @1.1.1.1
```

Первая команда dig должна вывести IPv4 вашего VPS. Пустой ответ на запрос AAAA нормален при использовании только IPv4. Если установка Caddy сообщает «Unable to locate package», включите репозиторий Ubuntu Universe и повторите установку. Если порты уже заняты, см. раздел 7.

Для приложения нужен системный Node.js 24 с модулем SQLite. Выполните блок целиком. Он выберет официальный Linux-архив под архитектуру VPS, проверит SHA-256 и установит бинарный файл в `/usr/local/bin/node`. На сервере с общей версией Node для других проектов сначала проверьте совместимость.

```bash
(
  set -eu
  case "$(dpkg --print-architecture)" in
    amd64) arch=x64 ;;
    arm64) arch=arm64 ;;
    *) echo 'Для этой архитектуры требуется другая сборка Node.js' >&2; exit 1 ;;
  esac
  tmp=$(mktemp -d)
  cd "$tmp"
  base=https://nodejs.org/dist/latest-v24.x
  curl -fsSLO "$base/SHASUMS256.txt"
  archive=$(awk -v arch="$arch" '$2 ~ ("^node-v24[.][0-9]+[.][0-9]+-linux-" arch "[.]tar[.]xz$") {print $2}' SHASUMS256.txt)
  test -n "$archive"
  curl -fsSLO "$base/$archive"
  awk -v file="$archive" '$2 == file' SHASUMS256.txt | sha256sum --check -
  tar -xJf "$archive"
  sudo install -m 0755 "${archive%.tar.xz}/bin/node" /usr/local/bin/node
)
node --version
node -e "console.log(typeof require('node:sqlite').DatabaseSync)"
```

Ожидаемый вывод последних двух команд — `v24.x.x` и `function`. Приложение поставляется собранным, npm-зависимостей для установки нет.

## 4. Распакуйте сайт

```bash
stage=$(mktemp -d)
unzip -q "$HOME/pallada-site.zip" -d "$stage"
sudo install -d -m 0755 /opt/pallada
sudo cp -R "$stage/pallada/." /opt/pallada/
sudo chmod -R a+rX /opt/pallada/dist
sudo chmod 0644 /opt/pallada/server.mjs
id pallada >/dev/null 2>&1 || sudo useradd --system --user-group --no-create-home pallada
sudo -u pallada test -r /opt/pallada/dist/index.html && echo 'Файлы сайта доступны'
```

## 5. Подключите бота и SOCKS5H

1. В Telegram откройте официальный `@BotFather`, создайте бота через `/newbot` или возьмите токен своего бота. Добавьте бота в нужную группу и разрешите писать сообщения.
2. Подготовьте числовой ID **именно этой группы** со знаком минус. Если он неизвестен, отправьте в группе команду `/start@имя_вашего_бота`, затем используйте блок ниже для нового бота. Он выводит названия и ID групп, а токен и адрес прокси вводятся скрыто. При уже настроенном webhook ID можно взять из `message.chat.id` в обработчике этого бота.
3. Прокси должен быть доступен с VPS. Формат — `socks5h://логин:пароль@хост:порт`, либо `socks5h://хост:порт` без авторизации. В логине и пароле прокси записывайте спецсимволы в URL-кодировке, например `@` как `%40`. Буква **h** включает разрешение имени Telegram на стороне прокси.

Блок для получения ID, если он нужен:

```bash
python3 - <<'PY'
from getpass import getpass
import json, subprocess
token = getpass('Токен бота: ').strip()
proxy = getpass('Адрес socks5h-прокси: ').strip()
if not proxy.startswith('socks5h://'):
    raise SystemExit('Укажите socks5h:// в начале адреса')
config = 'url = ' + json.dumps('https://api.telegram.org/bot' + token + '/getUpdates') + '\n'
config += 'proxy = ' + json.dumps(proxy) + '\nnoproxy = ""\n'
resp = subprocess.run(['curl','-q','-s','--max-time','20','--config','-'],input=config,text=True,capture_output=True)
if resp.returncode:
    raise SystemExit('Нет соединения через прокси. Проверьте адрес и доступ с VPS.')
data = json.loads(resp.stdout)
if not data.get('ok'):
    raise SystemExit('Telegram: ' + data.get('description','ошибка'))
groups = {}
for item in data.get('result', []):
    chat = item.get('message', {}).get('chat', {})
    if chat.get('type') in ('group', 'supergroup'):
        groups[chat['id']] = chat.get('title', '')
for chat_id,title in groups.items():
    print(chat_id, title)
if not groups:
    print('Групп пока нет. Отправьте команду боту в нужной группе и повторите.')
PY
```

Создайте файл настроек. Первая команда сохраняет уже существующий файл при обновлении.

```bash
sudo test -e /etc/pallada.env || sudo install -m 0600 /opt/pallada/.env.example /etc/pallada.env
sudo nano /etc/pallada.env
```

| Переменная | Значение |
| --- | --- |
| `PUBLIC_ORIGIN` | `https://pallada.cc` |
| `PORT` | `8080` |
| `DATA_DIR` | `/var/lib/pallada` |
| `BOT_TOKEN` | Токен от BotFather |
| `GROUP_CHAT_ID` | Числовой ID нужной группы со знаком минус |
| `SOCKS5H_PROXY` | Полный адрес прокси с префиксом `socks5h://` |
| `MANAGER_PASSWORD` | Пароль менеджера от 20 символов. Новый можно создать командой `openssl rand -hex 32` |

В nano сохраните через Ctrl+O, Enter, затем выйдите через Ctrl+X. Секреты хранятся на сервере в `/etc/pallada.env`.

## 6. Запустите сайт и автозапуск после перезагрузки

```bash
sudo install -m 0644 /opt/pallada/release/pallada.service /etc/systemd/system/pallada.service
sudo systemctl daemon-reload
sudo systemctl enable --now pallada
sudo systemctl status pallada --no-pager
curl -fsS http://127.0.0.1:8080/api/status.json
```

Ожидаемый ответ — `{"mode":"live"}`. Это проверка работы приложения. Реальная доставка в группу проверяется заявкой в разделе 8.

## 7. Включите HTTPS для pallada.cc

На **чистом VPS** замените стандартную стартовую страницу Caddy конфигурацией из архива.

```bash
sudo cp -an /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-pallada
sudo install -m 0644 /opt/pallada/release/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Если VPS уже обслуживает другие домены через Caddy, добавьте только блок `pallada.cc { ... }` из `release/Caddyfile` в действующую конфигурацию, затем проверьте и перезагрузите её. Если 80/443 обслуживает Nginx или другой прокси, используйте его существующую схему HTTPS и направьте запросы домена на `127.0.0.1:8080` с перезаписью `X-Real-IP` адресом клиента.

Когда DNS указывает на VPS и доступны порты 80/443, Caddy автоматически получает и продлевает сертификат.

## 8. Проверьте путь от формы до группы

```bash
curl -I http://pallada.cc
curl -fsS https://pallada.cc/api/status.json
```

HTTP должен перенаправлять на HTTPS, а второй запрос — вернуть `{"mode":"live"}`. Откройте **https://pallada.cc** с телефона или компьютера. Выберите услугу, укажите сумму от 5 000 ₽ и свой контакт, поставьте галочку и нажмите «Оставить заявку». В нужной Telegram-группе проверьте номер заявки, услугу, сумму и контакт. Откройте карточку по ссылке из сообщения. Логин — `manager`, пароль — из `MANAGER_PASSWORD`.

### Если что-то не работает

| Симптом | Что проверить |
| --- | --- |
| Домен открывает другую страницу | Сверьте ответы A/AAAA с IP сервера и посмотрите, у какого провайдера находятся активные NS-записи. |
| Ошибка сертификата или домен недоступен | Проверьте DNS, сетевые правила хостера, UFW и журнал `sudo journalctl -u caddy -n 60 --no-pager`. Команда `sudo ss -ltnp` покажет, какая служба слушает порты. |
| 502 Bad Gateway | Проверьте ответ `curl -fsS http://127.0.0.1:8080/api/status.json` и `sudo journalctl -u pallada -n 60 --no-pager`. |
| Форма пишет «В очереди» | Заявка уже сохранена. Проверьте токен, ID группы, разрешение боту писать и прокси. Очередь и карточки видны на `https://pallada.cc/manager/`. |
| В ответ на форму появляется сообщение о предпросмотре | Веб-сервер раздаёт статическую папку. Направьте весь домен, в том числе `/api/`, на Node через reverse proxy. |

После изменения настроек примените их командой `sudo systemctl restart pallada`. При обновлении версии сайта замените файлы в `/opt/pallada`, сохранив `/etc/pallada.env` и `/var/lib/pallada`, затем перезапустите службу и повторите проверку заявки.

Справочники: [Node.js 24 для Linux](https://nodejs.org/dist/latest-v24.x/), [Caddy в Ubuntu 24.04](https://packages.ubuntu.com/noble/caddy), [выпуск HTTPS-сертификатов Caddy](https://caddyserver.com/docs/automatic-https), [Telegram Bot API](https://core.telegram.org/bots/api#getupdates).

## Что получает группа

Номер заявки, Telegram или телефон клиента, выбранную услугу, сумму в рублях и юанях (для платежей) и ссылку на карточку. Описание груза остаётся на сервере. Один клик сохраняет заявку и сразу запускает отправку. Сайт подтверждает доставку только после ответа Telegram. Если сервис недоступен, посетитель видит номер принятой заявки и статус ожидания. Старые заявки отправляются по первоначальным условиям согласия. Соединение с api.telegram.org идёт через SOCKS5H с удалённым разрешением DNS. Прямой запасной маршрут отсутствует. При недоступности Telegram очередь сохраняется и переживает перезапуск. Возможные повторные уведомления после сетевого сбоя содержат тот же номер. Проверка состояния: `journalctl -u pallada`. Проверяйте очередь в /manager/, в особенности после смены токена, группы или прокси.

Данные в SQLite удаляются через 30 дней. Для контактов в Telegram настройте автоудаление сообщений рабочей группы в рамках политики оператора. Настройте резервные копии и сроки их хранения в соответствии с политикой оператора. Для удаления заявки по обращению используйте локальный администрируемый доступ к SQLite и удалите строку по номеру из таблицы leads.

## Перед отправкой в Директ

Курс 12,84 ₽ за CNY. Минимум 5 000 ₽ перенесён с исходного сайта. Подтвердите минимум и условия комиссии. Проверьте фактического исполнителя платежей по договору, его роль, применимую категорию рекламы и комплект документов. Добавьте подтверждённые контакты поддержки, когда они будут определены. Тексты об обработке данных описывают поставленную схему. При изменении состава данных, инфраструктуры или передаче контактов третьим лицам актуализируйте тексты.

Карточка организации: https://www.rusprofile.ru/id/1267700003416
Правила Директа: https://yandex.ru/support/direct/ru/moderation/categories/finance-payment
