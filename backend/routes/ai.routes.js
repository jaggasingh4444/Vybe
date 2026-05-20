import express from "express";
import {
  generateCaptions,
  generateChatReplies,
  moderateText,
} from "../controllers/ai.controllers.js";
import isAuth from "../middlewares/isAuth.js";

const aiRouter = express.Router();

aiRouter.post("/captions", isAuth, generateCaptions);
aiRouter.post("/chat-replies", isAuth, generateChatReplies);
aiRouter.post("/moderate", isAuth, moderateText);

export default aiRouter;
