import express from "express";
import {
  contentEvents,
  createStory,
  deleteContent,
  deleteStory,
  createPost,
  createReel,
  uploadContentMedia,
  addComment,
  addCommentReply,
  getFeed,
  getNotifications,
  getStories,
  markNotificationsRead,
  notificationEvents,
  toggleLike,
  viewStory,
  deleteComment,
} from "../controllers/content.controllers.js";
import isAuth from "../middlewares/isAuth.js";

const contentRouter = express.Router();

contentRouter.get("/feed", isAuth, getFeed);
contentRouter.get("/events", isAuth, contentEvents);
contentRouter.get("/stories", isAuth, getStories);
contentRouter.get("/notifications", isAuth, getNotifications);
contentRouter.get("/notifications/events", isAuth, notificationEvents);
contentRouter.patch("/notifications/read", isAuth, markNotificationsRead);
contentRouter.post(
  "/uploads",
  isAuth,
  express.raw({ type: ["image/*", "video/*", "application/octet-stream"], limit: "80mb" }),
  uploadContentMedia
);
contentRouter.post("/posts", isAuth, createPost);
contentRouter.post("/reels", isAuth, createReel);
contentRouter.post("/stories", isAuth, createStory);
contentRouter.post("/stories/:storyId/view", isAuth, viewStory);
contentRouter.delete("/stories/:storyId", isAuth, deleteStory);
contentRouter.post("/:type/:id/like", isAuth, toggleLike);
contentRouter.post("/:type/:id/comments", isAuth, addComment);
contentRouter.post("/:type/:id/comments/:commentId/replies", isAuth, addCommentReply);
contentRouter.delete("/:type/:id/comments/:commentId", isAuth, deleteComment);
contentRouter.delete("/:type/:id", isAuth, deleteContent);

export default contentRouter;
