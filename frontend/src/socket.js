import { io } from "socket.io-client";
// https://3.27.136.246
export const socket = io("https://3.107.113.40", {
  autoConnect: true,           // ← để false là chuẩn nhất
  path: "/socket.io/",
  transports: ["polling","websocket"],    // hoặc ["polling", "websocket"] nếu muốn an toàn hơn
  secure: true,
  rejectUnauthorized: false,    // ← QUAN TRỌNG NHẤT với self-signed SSL
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  timeout: 20000,
});