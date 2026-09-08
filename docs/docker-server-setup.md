# Muhaseb Docker Server Setup

This setup is for the main Windows server PC inside one store.

## Requirements

- Docker Desktop installed and running
- PowerShell opened as Administrator
- The server PC network profile should be `Private`

## Start Server

From the project root:

```powershell
npm run server:docker
```

The command will:

- create a root `.env` file if it does not exist
- configure Windows Firewall for LAN access
- build and start PostgreSQL, Redis, and the API
- run Prisma migrations
- seed baseline data, including the admin login and AFN base currency

## LAN Ports

Only these ports should be open to other computers and phones:

- `4000`: API
- `4001`: POS WebSocket
- `4002`: system health WebSocket

PostgreSQL and Redis are bound to `127.0.0.1`, so they are not exposed to the LAN.

## Client Connection

On desktop/mobile clients, use:

```text
http://SERVER-IP:4000
```

Example:

```text
http://192.168.0.253:4000
```

## First Login

Default seeded admin:

```text
username: admin
password: change-me-now
```

Change this password immediately after first login.

## Useful Commands

```powershell
docker compose ps
docker compose logs -f api
docker compose restart api
docker compose down
```

Backups and server config are stored in Docker volumes, so they survive container restart/rebuild.

# Install A Separate Test Instance

The normal install command remains unchanged and continues to use the existing
customer containers, volumes, `.env` file, and ports `4000`, `4001`, and `4002`.

To install a second isolated copy of the same server on one Windows computer,
run this command from that copy's extracted project directory:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/install-server.ps1 `
  -ProjectName muhaseb-test `
  -ApiPort 5000 `
  -PosWebSocketPort 5001 `
  -SystemHealthWebSocketPort 5002 `
  -PostgresPort 55432 `
  -RedisPort 56379 `
  -ConfirmStableIp
```

The same parameters can be passed through the existing npm command:

```powershell
npm run server:install -- `
  -ProjectName muhaseb-test `
  -ApiPort 5000 `
  -PosWebSocketPort 5001 `
  -SystemHealthWebSocketPort 5002 `
  -PostgresPort 55432 `
  -RedisPort 56379 `
  -ConfirmStableIp
```

This creates an isolated `.env.muhaseb-test`, containers named
`muhaseb-test-postgres`, `muhaseb-test-redis`, and `muhaseb-test-api`, separate
Compose volumes, and the backup folder `D:\BelalBackups\muhaseb-test`. Connect
test clients to `http://SERVER-IP:5000`.

Always identify the project and environment file when managing the test copy:

```powershell
docker compose -p muhaseb-test --env-file .env.muhaseb-test ps
docker compose -p muhaseb-test --env-file .env.muhaseb-test logs -f api
docker compose -p muhaseb-test --env-file .env.muhaseb-test stop
docker compose -p muhaseb-test --env-file .env.muhaseb-test start
```

Never use `docker compose down -v` on either installation. The `-v` option
deletes that project's database and file volumes. Before restoring a customer
backup, verify both the Compose project name and its environment file.
