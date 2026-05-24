import { io } from "socket.io-client";
import { API_BASE_URL } from "../config/api";
import { getTabAuthToken } from "./tabAuth";

let chatSocket = null;
let activeToken = "";

export const getChatSocket = () => {
  const token = getTabAuthToken();
  if (!token) return null;

  if (chatSocket && activeToken && activeToken !== token) {
    chatSocket.disconnect();
    chatSocket = null;
  }

  activeToken = token;

  if (!chatSocket) {
    chatSocket = io(API_BASE_URL, {
      autoConnect: false,
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: { token },
    });
  }

  chatSocket.auth = { token };
  if (!chatSocket.connected) {
    chatSocket.connect();
  }

  return chatSocket;
};

export const emitChatSocketEvent = (eventName, payload = {}) => {
  const socket = getChatSocket();
  if (!socket) return;

  if (socket.connected) {
    socket.emit(eventName, payload);
    return;
  }

  socket.once("connect", () => {
    socket.emit(eventName, payload);
  });
};

export const disconnectChatSocket = () => {
  chatSocket?.disconnect();
  chatSocket = null;
  activeToken = "";
};
