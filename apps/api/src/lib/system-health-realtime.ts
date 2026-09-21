import { WebSocket, WebSocketServer } from "ws";
import { getServerResourceHealth } from "./monitoring";
import { hashToken, hasPermission, loadAuthUser, verifyAccessToken } from "./auth";
import { prisma } from "./prisma";

let healthWebSocketStarted = false;
let healthWebSocketServer: WebSocketServer | null = null;

function send(socket: WebSocket, type: string, payload: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload, time: new Date().toISOString() }));
}

async function authorize(token: string) {
  try {
    const payload = verifyAccessToken(token);
    if (!payload) return false;
    const session = await prisma.userSession.findUnique({ where: { id: payload.sessionId } });
    if (
      !session ||
      session.userId !== payload.userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenHash !== hashToken(token)
    ) {
      return false;
    }
    const user = await loadAuthUser(payload.userId);
    return hasPermission(user, "backup.manage");
  } catch {
    return false;
  }
}

export function startSystemHealthWebSocketServer(port = 4002) {
  if (healthWebSocketStarted) return healthWebSocketServer;
  healthWebSocketStarted = true;
  const wss = new WebSocketServer({ port });
  healthWebSocketServer = wss;

  wss.on("connection", async (socket, request) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const token = requestUrl.searchParams.get("token") || "";
    if (!(await authorize(token))) {
      send(socket, "CONNECTION_ERROR", { message: "برای اتصال باید وارد حساب شوید." });
      socket.close(1008, "Authentication required");
      return;
    }

    send(socket, "CONNECTED", { intervalMs: 2000 });
    const publish = async () => {
      try {
        send(socket, "RESOURCE_SNAPSHOT", await getServerResourceHealth());
      } catch (error) {
        send(socket, "RESOURCE_ERROR", {
          message: "خواندن وضعیت منابع سرور ناکام شد."
        });
      }
    };
    await publish();
    const timer = setInterval(() => void publish(), 2000);
    socket.on("close", () => clearInterval(timer));
    socket.on("error", () => clearInterval(timer));
  });

  console.log(`System health WebSocket running on ws://localhost:${port}`);
  return wss;
}
