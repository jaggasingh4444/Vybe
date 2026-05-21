import express from "express";
import { uploadBufferToS3 } from "../config/s3.js";
import upload from "../middleware/upload.js";
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
  getContentById,
  getNotifications,
  getStories,
  deleteNotification,
  markNotificationsRead,
  notificationEvents,
  toggleLike,
  viewStory,
  deleteComment,
} from "../controllers/content.controllers.js";
import isAuth from "../middlewares/isAuth.js";

const contentRouter = express.Router();

const uploadMediaToS3 = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Media file is required" });
    }

    const uploadedMedia = await uploadBufferToS3(req.file);
    return res.status(201).json(uploadedMedia);
  } catch (error) {
    return res.status(500).json({ message: `upload error ${error.message}` });
  }
};

contentRouter.get("/feed", isAuth, getFeed);
contentRouter.get("/events", isAuth, contentEvents);
contentRouter.get("/stories", isAuth, getStories);
contentRouter.get("/notifications", isAuth, getNotifications);
contentRouter.get("/notifications/events", isAuth, notificationEvents);
contentRouter.patch("/notifications/read", isAuth, markNotificationsRead);
contentRouter.delete("/notifications/:notificationId", isAuth, deleteNotification);
contentRouter.post(
  "/uploads",
  isAuth,
  express.raw({ type: ["image/*", "video/*", "application/octet-stream"], limit: "80mb" }),
  uploadContentMedia
);
contentRouter.post("/posts", isAuth, createPost);
contentRouter.post("/reels", isAuth, createReel);
contentRouter.post("/upload-media", isAuth, upload.single("media"), uploadMediaToS3);
contentRouter.post("/stories", isAuth, createStory);
contentRouter.post("/stories/:storyId/view", isAuth, viewStory);
contentRouter.delete("/stories/:storyId", isAuth, deleteStory);
contentRouter.get("/:type/:id", isAuth, getContentById);
contentRouter.post("/:type/:id/like", isAuth, toggleLike);
contentRouter.post("/:type/:id/comments", isAuth, addComment);
contentRouter.post("/:type/:id/comments/:commentId/replies", isAuth, addCommentReply);
contentRouter.delete("/:type/:id/comments/:commentId", isAuth, deleteComment);
contentRouter.delete("/:type/:id", isAuth, deleteContent);

export default contentRouter;
