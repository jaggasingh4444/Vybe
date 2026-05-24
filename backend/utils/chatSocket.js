import jwt from "jsonwebtoken";
import { Server } from "socket.io";

let ioInstance = null;
let getPresenceUserIds = () => getSocketOnlineUserIds();
let onPresenceChange = () => {};
let onUserConnected = () => {};

const socketUsers = new Map();

const getIdString = (value) => value?._id?.toString?.() || value?.toString?.() || "";
const getUserRoom = (userId) => `user:${getIdString(userId)}`;

const addSocketUser = (userId, socketId) => {
  const key = getIdString(userId);
  if (!key) return false;

  const wasOffline = !socketUsers.has(key);
  const sockets = socketUsers.get(key) || new Set();
  sockets.add(socketId);
  socketUsers.set(key, sockets);
  return wasOffline;
};

const removeSocketUser = (userId, socketId) => {
  const key = getIdString(userId);
  const sockets = socketUsers.get(key);
  if (!sockets) return false;

  sockets.delete(socketId);
  if (sockets.size > 0) return false;

  socketUsers.delete(key);
  return true;
};

export const getSocketOnlineUserIds = () => [...socketUsers.keys()];

export const isSocketUserOnline = (userId) => socketUsers.has(getIdString(userId));

export const setSocketPresenceHandlers = ({
  getOnlineUserIds,
  handlePresenceChange,
  handleUserConnected,
} = {}) => {
  if (typeof getOnlineUserIds === "function") {
    getPresenceUserIds = getOnlineUserIds;
  }

  if (typeof handlePresenceChange === "function") {
    onPresenceChange = handlePresenceChange;
  }

  if (typeof handleUserConnected === "function") {
    onUserConnected = handleUserConnected;
  }
};

export const emitToSocketUser = (userId, eventName, payload) => {
  if (!ioInstance || !userId || !eventName) return;
  ioInstance.to(getUserRoom(userId)).emit(eventName, payload);
};

export const emitSocketChatEvent = (userId, payload) => {
  if (!payload?.type) return;
  emitToSocketUser(userId, "chat:event", payload);
  emitToSocketUser(userId, payload.type, payload);
};

export const initializeChatSocket = (server, corsOptions) => {
  ioInstance = new Server(server, {
    cors: {
      origin: corsOptions.origin,
      credentials: true,
      methods: corsOptions.methods,
      allowedHeaders: corsOptions.allowedHeaders,
    },
  });

  ioInstance.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      if (!token) {
        return next(new Error("Token not found"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id || decoded.userId;
      if (!userId) {
        return next(new Error("Auth failed"));
      }

      socket.userId = userId.toString();
      return next();
    } catch {
      return next(new Error("Auth failed"));
    }
  });

  ioInstance.on("connection", (socket) => {
    const userId = socket.userId;
    socket.join(getUserRoom(userId));
    addSocketUser(userId, socket.id);

    socket.emit("chat:event", {
      type: "connected",
      onlineUserIds: getPresenceUserIds(),
    });
    Promise.resolve(onUserConnected(userId)).catch(() => {});
    onPresenceChange();

    socket.on("presence:sync", () => {
      socket.emit("chat:event", {
        type: "connected",
        onlineUserIds: getPresenceUserIds(),
      });
    });

    socket.on("typing:update", (payload = {}) => {
      const receiverId = getIdString(payload.receiverId);
      if (!receiverId || receiverId === userId) return;

      emitSocketChatEvent(receiverId, {
        type: "typing:update",
        senderId: userId,
        receiverId,
        typing: Boolean(payload.typing),
        at: Date.now(),
      });
    });

    socket.on("disconnect", () => {
      if (removeSocketUser(userId, socket.id)) {
        onPresenceChange();
      }
    });
  });

  return ioInstance;
};
