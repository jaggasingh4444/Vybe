import express from "express";
import {
  chatEvents,
  deleteConversation,
  deleteMessage,
  getChatUsers,
  getMessages,
  reactToMessage,
  searchConnectedChatUsers,
  sendMessage,
  sendTypingStatus,
} from "../controllers/chat.controllers.js";
import isAuth from "../middlewares/isAuth.js";

const chatRouter = express.Router();

chatRouter.get("/events", isAuth, chatEvents);
chatRouter.get("/users", isAuth, getChatUsers);
chatRouter.get("/search-users", isAuth, searchConnectedChatUsers);
chatRouter.get("/:userId/messages", isAuth, getMessages);
chatRouter.post("/:userId/messages", isAuth, sendMessage);
chatRouter.post("/:userId/typing", isAuth, sendTypingStatus);
chatRouter.post("/messages/:messageId/reactions", isAuth, reactToMessage);
chatRouter.delete("/conversation/:userId", isAuth, deleteConversation);
chatRouter.delete("/messages/:messageId", isAuth, deleteMessage);

export default chatRouter;
