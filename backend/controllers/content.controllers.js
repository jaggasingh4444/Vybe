import Loop from "../models/loop.model.js";
import Notification from "../models/notification.model.js";
import Post from "../models/post.model.js";
import Story from "../models/story.model.js";
import User from "../models/user.model.js";
import {
  inferMediaInfo,
  isDataUrl,
  isStoredMediaUrl,
  saveBinaryMedia,
  saveDataUrlMedia,
} from "../utils/mediaStorage.js";

const contentClients = new Map();
const notificationClients = new Map();
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

const getActiveStoryCutoff = () => new Date(Date.now() - STORY_LIFETIME_MS);

const getVisibleStoryAuthorIds = async (userId) => {
  const user = await User.findById(userId).select("following");
  if (!user) return [];

  return [userId, ...user.following.map((id) => id.toString())];
};

const serializeContent = (item, type) => ({
  _id: item._id,
  type,
  author: item.author,
  mediaType: item.mediaType || (type === "reel" ? "video" : "text"),
  media: item.media || "",
  caption: item.caption || "",
  likes: item.likes || [],
  comments: item.comments || [],
  createdAt: item.createdAt,
});

const serializeStory = (story) => ({
  _id: story._id,
  author: story.author,
  mediaType: story.mediaType,
  media: story.media,
  viewers: story.viewers || [],
  likes: story.likes || [],
  createdAt: story.createdAt,
});

const contentModels = {
  post: Post,
  reel: Loop,
};

const populateContent = (query) =>
  query
    .populate("author", "name userName profileImage isVerified")
    .populate("comments.author", "name userName profileImage isVerified")
    .populate("comments.replies.author", "name userName profileImage isVerified");

const persistLegacyMedia = async (item, folder, req) => {
  if (!isDataUrl(item.media)) return item;

  item.media = await saveDataUrlMedia(item.media, folder, req);
  await item.save();
  return item;
};

const persistLegacyProfileImage = async (user, req) => {
  if (!user || !isDataUrl(user.profileImage)) return user;

  const profileImage = await saveDataUrlMedia(user.profileImage, "profiles", req);
  user.profileImage = profileImage;
  await User.findByIdAndUpdate(user._id, { $set: { profileImage } });
  return user;
};

const getContentUsers = (items) => {
  const users = new Map();
  const addUser = (user) => {
    if (user?._id) users.set(user._id.toString(), user);
  };

  for (const item of items) {
    addUser(item.author);

    for (const comment of item.comments || []) {
      addUser(comment.author);

      for (const reply of comment.replies || []) {
        addUser(reply.author);
      }
    }
  }

  return [...users.values()];
};

const writeEvent = (client, payload) => {
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const addContentClient = (userId, res) => {
  const key = userId.toString();
  const userClients = contentClients.get(key) || new Set();
  userClients.add(res);
  contentClients.set(key, userClients);
};

const removeContentClient = (userId, res) => {
  const key = userId.toString();
  const userClients = contentClients.get(key);
  if (!userClients) return;

  userClients.delete(res);
  if (userClients.size === 0) {
    contentClients.delete(key);
  }
};

const sendContentEventToUser = (userId, payload) => {
  const userClients = contentClients.get(userId.toString());
  if (!userClients) return;

  for (const client of [...userClients]) {
    try {
      writeEvent(client, payload);
    } catch {
      userClients.delete(client);
    }
  }

  if (userClients.size === 0) {
    contentClients.delete(userId.toString());
  }
};

const broadcastContentUpdate = (type = "content:new", extra = {}) => {
  const payload = { type, at: Date.now(), ...extra };

  for (const [userId, userClients] of contentClients) {
    for (const client of [...userClients]) {
      try {
        writeEvent(client, payload);
      } catch {
        userClients.delete(client);
      }
    }

    if (userClients.size === 0) {
      contentClients.delete(userId);
    }
  }
};

const cleanupExpiredStories = async () => {
  const expiredStories = await Story.find({
    createdAt: { $lte: getActiveStoryCutoff() },
  }).select("_id");

  if (expiredStories.length === 0) return 0;

  const expiredStoryIds = expiredStories.map((story) => story._id);

  await Promise.all([
    Story.deleteMany({ _id: { $in: expiredStoryIds } }),
    User.updateMany(
      { story: { $in: expiredStoryIds } },
      { $unset: { story: "" } }
    ),
  ]);

  return expiredStoryIds.length;
};

const cleanupExpiredStoriesAndBroadcast = async () => {
  const expiredCount = await cleanupExpiredStories();
  if (expiredCount > 0) {
    broadcastContentUpdate("story:expired", { expiredCount });
  }
};

const addNotificationClient = (userId, res) => {
  const key = userId.toString();
  const userClients = notificationClients.get(key) || new Set();
  userClients.add(res);
  notificationClients.set(key, userClients);
};

const removeNotificationClient = (userId, res) => {
  const key = userId.toString();
  const userClients = notificationClients.get(key);
  if (!userClients) return;

  userClients.delete(res);
  if (userClients.size === 0) {
    notificationClients.delete(key);
  }
};

const sendNotificationEvent = (userId, payload) => {
  const userClients = notificationClients.get(userId.toString());
  if (!userClients) return;

  for (const client of userClients) {
    writeEvent(client, payload);
  }
};

export const createNotification = async ({
  recipient,
  actor,
  type,
  contentType,
  contentId,
  commentId = null,
  replyId = null,
  text = "",
}) => {
  if (!recipient || recipient.toString() === actor.toString()) return null;

  const notification = await Notification.create({
    recipient,
    actor,
    type,
    contentType,
    contentId,
    commentId,
    replyId,
    text,
  });

  const populatedNotification = await notification.populate("actor", "name userName profileImage isVerified");
  sendNotificationEvent(recipient, {
    type: "notification:new",
    notification: populatedNotification,
  });
  sendContentEventToUser(recipient, {
    type: "notification:new",
    notification: populatedNotification,
  });

  return populatedNotification;
};

export const contentEvents = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  cleanupExpiredStoriesAndBroadcast().catch(() => {});
  writeEvent(res, { type: "connected" });
  addContentClient(req.userId, res);

  req.on("close", () => {
    removeContentClient(req.userId, res);
  });
};

export const getFeed = async (req, res) => {
  try {
    const [posts, reels] = await Promise.all([
      populateContent(Post.find())
        .sort({ createdAt: -1 })
        .limit(15),
      populateContent(Loop.find())
        .sort({ createdAt: -1 })
        .limit(15),
    ]);

    await Promise.all([
      ...posts.map((post) => persistLegacyMedia(post, "content", req)),
      ...reels.map((reel) => persistLegacyMedia(reel, "content", req)),
      ...getContentUsers([...posts, ...reels]).map((user) => persistLegacyProfileImage(user, req)),
    ]);

    const feed = [
      ...posts.map((post) => serializeContent(post, "post")),
      ...reels.map((reel) => serializeContent(reel, "reel")),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json(feed.slice(0, 24));
  } catch (error) {
    return res.status(500).json({ message: `feed error ${error.message}` });
  }
};

export const getContentById = async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const item = await populateContent(Model.findById(id));
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    await persistLegacyMedia(item, "content", req);
    await Promise.all(getContentUsers([item]).map((user) => persistLegacyProfileImage(user, req)));

    return res.status(200).json(serializeContent(item, type));
  } catch (error) {
    return res.status(500).json({ message: `content error ${error.message}` });
  }
};

export const getStories = async (req, res) => {
  try {
    await cleanupExpiredStoriesAndBroadcast();
    const visibleAuthorIds = await getVisibleStoryAuthorIds(req.userId);

    const stories = await Story.find({
      createdAt: { $gt: getActiveStoryCutoff() },
      author: { $in: visibleAuthorIds },
    })
      .populate("author", "name userName profileImage isVerified")
      .sort({ createdAt: -1 })
      .limit(30);

    await Promise.all([
      ...stories.map((story) => persistLegacyMedia(story, "stories", req)),
      ...stories.map((story) => persistLegacyProfileImage(story.author, req)),
    ]);

    return res.status(200).json(stories.map(serializeStory));
  } catch (error) {
    return res.status(500).json({ message: `stories error ${error.message}` });
  }
};

export const createStory = async (req, res) => {
  try {
    const { media: bodyMedia, mediaType: bodyMediaType } = req.body;
    const uploadedFile = req.file;
    const fileInfo = inferMediaInfo({
      mimeType: uploadedFile?.mimetype,
      fileName: uploadedFile?.originalname,
      fallbackMediaType: bodyMediaType,
    });
    const fileMediaType = fileInfo.mediaKind;
    const mediaType = uploadedFile ? fileMediaType : bodyMediaType;

    if (!["image", "video"].includes(mediaType)) {
      return res.status(400).json({ message: "Story media must be an image or video" });
    }

    if (!uploadedFile && !isDataUrl(bodyMedia) && !isStoredMediaUrl(bodyMedia)) {
      return res.status(400).json({ message: "Valid story media is required" });
    }

    const storedMedia = uploadedFile
      ? await saveBinaryMedia(uploadedFile.buffer, fileInfo.mimeType, "stories", req, {
          fileName: uploadedFile.originalname,
          mediaType,
        })
      : isDataUrl(bodyMedia)
        ? await saveDataUrlMedia(bodyMedia, "stories", req)
        : bodyMedia;

    if (!storedMedia) {
      return res.status(400).json({ message: "Story media upload failed" });
    }

    const story = await Story.create({
      author: req.userId,
      mediaType,
      media: storedMedia,
      viewers: [],
    });

    await User.findByIdAndUpdate(req.userId, { $set: { story: story._id } });

    const populatedStory = await story.populate("author", "name userName profileImage isVerified");
    broadcastContentUpdate("story:update", { storyId: story._id });

    return res.status(201).json(serializeStory(populatedStory));
  } catch (error) {
    return res.status(500).json({ message: `create story error ${error.message}` });
  }
};

export const viewStory = async (req, res) => {
  try {
    await cleanupExpiredStoriesAndBroadcast();
    const visibleAuthorIds = await getVisibleStoryAuthorIds(req.userId);

    const story = await Story.findOneAndUpdate(
      {
        _id: req.params.storyId,
        createdAt: { $gt: getActiveStoryCutoff() },
        author: { $in: visibleAuthorIds },
      },
      { $addToSet: { viewers: req.userId } },
      { new: true }
    ).populate("author", "name userName profileImage isVerified");

    if (!story) {
      return res.status(404).json({ message: "Story expired or not found" });
    }

    return res.status(200).json(serializeStory(story));
  } catch (error) {
    return res.status(500).json({ message: `view story error ${error.message}` });
  }
};

export const toggleStoryReaction = async (req, res) => {
  try {
    await cleanupExpiredStoriesAndBroadcast();
    const visibleAuthorIds = await getVisibleStoryAuthorIds(req.userId);

    const story = await Story.findOne({
      _id: req.params.storyId,
      createdAt: { $gt: getActiveStoryCutoff() },
      author: { $in: visibleAuthorIds },
    });

    if (!story) {
      return res.status(404).json({ message: "Story expired or not found" });
    }

    const alreadyReacted = (story.likes || []).some(
      (userId) => userId.toString() === req.userId
    );

    if (alreadyReacted) {
      story.likes = (story.likes || []).filter((userId) => userId.toString() !== req.userId);
    } else {
      story.likes = [...(story.likes || []), req.userId];
    }

    await story.save();

    const populatedStory = await Story.findById(story._id).populate(
      "author",
      "name userName profileImage isVerified"
    );

    if (!alreadyReacted) {
      await createNotification({
        recipient: story.author,
        actor: req.userId,
        type: "like",
        contentType: "story",
        contentId: story._id,
      });
    }

    broadcastContentUpdate("story:update", { storyId: story._id });

    return res.status(200).json(serializeStory(populatedStory));
  } catch (error) {
    return res.status(500).json({ message: `story reaction error ${error.message}` });
  }
};

export const deleteStory = async (req, res) => {
  try {
    const story = await Story.findById(req.params.storyId);

    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    if (story.author.toString() !== req.userId) {
      return res.status(403).json({ message: "You can only delete your own story" });
    }

    await Story.findByIdAndDelete(req.params.storyId);

    const latestStory = await Story.findOne({
      author: req.userId,
      createdAt: { $gt: getActiveStoryCutoff() },
    }).sort({ createdAt: -1 });

    if (latestStory) {
      await User.findByIdAndUpdate(req.userId, { $set: { story: latestStory._id } });
    } else {
      await User.findByIdAndUpdate(req.userId, { $unset: { story: "" } });
    }

    broadcastContentUpdate("story:update", { storyId: req.params.storyId });

    return res.status(200).json({ message: "Story deleted", id: req.params.storyId });
  } catch (error) {
    return res.status(500).json({ message: `delete story error ${error.message}` });
  }
};

export const createPost = async (req, res) => {
  try {
    const { caption = "", media: bodyMedia, mediaType: bodyMediaType } = req.body;
    const trimmedCaption = caption.trim();
    const uploadedFile = req.file;
    const fileInfo = inferMediaInfo({
      mimeType: uploadedFile?.mimetype,
      fileName: uploadedFile?.originalname,
      fallbackMediaType: bodyMediaType,
    });
    const fileMediaType = fileInfo.mediaKind;
    const mediaType = uploadedFile ? fileMediaType : bodyMediaType;
    const media = uploadedFile
      ? await saveBinaryMedia(uploadedFile.buffer, fileInfo.mimeType, "content", req, {
          fileName: uploadedFile.originalname,
          mediaType,
        })
      : bodyMedia;
    const hasMedia = Boolean(media);

    if (!hasMedia && !trimmedCaption) {
      return res.status(400).json({ message: "Write something or choose a photo/video" });
    }

    if (hasMedia && !["image", "video"].includes(mediaType)) {
      return res.status(400).json({ message: "Post media must be an image or video" });
    }

    if (hasMedia && !isDataUrl(media) && !isStoredMediaUrl(media)) {
      return res.status(400).json({ message: "Valid media file is required" });
    }

    const storedMedia = hasMedia && isDataUrl(media)
      ? await saveDataUrlMedia(media, "content", req)
      : media || "";
    const post = await Post.create({
      author: req.userId,
      mediaType: hasMedia ? mediaType : "text",
      media: storedMedia,
      caption: trimmedCaption,
    });

    await User.findByIdAndUpdate(req.userId, { $push: { posts: post._id } });

    const populatedPost = await post.populate("author", "name userName profileImage isVerified");
    broadcastContentUpdate();

    return res.status(201).json(serializeContent(populatedPost, "post"));
  } catch (error) {
    return res.status(500).json({ message: `create post error ${error.message}` });
  }
};

export const createReel = async (req, res) => {
  try {
    const { caption = "", media: bodyMedia, mediaType: bodyMediaType = "video" } = req.body;
    const uploadedFile = req.file;
    const fileInfo = inferMediaInfo({
      mimeType: uploadedFile?.mimetype,
      fileName: uploadedFile?.originalname,
      fallbackMediaType: "video",
    });
    const mediaType = uploadedFile ? fileInfo.mediaKind : bodyMediaType;
    const media = uploadedFile
      ? await saveBinaryMedia(uploadedFile.buffer, fileInfo.mimeType, "content", req, {
          fileName: uploadedFile.originalname,
          mediaType,
        })
      : bodyMedia;

    if (
      mediaType !== "video" ||
      !media ||
      (!uploadedFile && !isStoredMediaUrl(media) && (!isDataUrl(media) || !media.startsWith("data:video/")))
    ) {
      return res.status(400).json({ message: "Reel upload must be a video file" });
    }

    const storedMedia = uploadedFile
      ? media
      : isDataUrl(media)
        ? await saveDataUrlMedia(media, "content", req)
        : media;
    const reel = await Loop.create({
      author: req.userId,
      mediaType: "video",
      media: storedMedia,
      caption: caption.trim(),
    });

    await User.findByIdAndUpdate(req.userId, { $push: { loop: reel._id } });

    const populatedReel = await reel.populate("author", "name userName profileImage isVerified");
    broadcastContentUpdate();

    return res.status(201).json(serializeContent(populatedReel, "reel"));
  } catch (error) {
    return res.status(500).json({ message: `create reel error ${error.message}` });
  }
};

export const uploadContentMedia = async (req, res) => {
  try {
    const contentType = req.get("content-type")?.split(";")[0]?.trim() || "";
    const mediaInfo = inferMediaInfo({
      mimeType: contentType,
      fileName: req.get("x-media-name") || "",
      fallbackMediaType: req.get("x-media-type") || "",
    });
    const mediaType = mediaInfo.mediaKind;

    if (!mediaType) {
      return res.status(400).json({ message: "Upload must be an image or video" });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "Media file is empty" });
    }

    const media = await saveBinaryMedia(req.body, mediaInfo.mimeType, "content", req, {
      fileName: req.get("x-media-name") || "",
      mediaType,
    });
    if (!media) {
      return res.status(400).json({ message: "Media upload failed" });
    }

    return res.status(201).json({ media, mediaType });
  } catch (error) {
    return res.status(500).json({ message: `content upload error ${error.message}` });
  }
};

export const deleteContent = async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const item = await Model.findById(id);
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    if (item.author.toString() !== req.userId) {
      return res.status(403).json({ message: "You can only delete your own content" });
    }

    await Model.findByIdAndDelete(id);

    if (type === "post") {
      await User.findByIdAndUpdate(req.userId, { $pull: { posts: id } });
    } else {
      await User.findByIdAndUpdate(req.userId, { $pull: { loop: id } });
    }

    await Notification.deleteMany({ contentType: type, contentId: id });
    broadcastContentUpdate();

    return res.status(200).json({ message: "Deleted successfully", type, id });
  } catch (error) {
    return res.status(500).json({ message: `delete content error ${error.message}` });
  }
};

export const toggleLike = async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const item = await Model.findById(id);
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    const liked = item.likes.some((userId) => userId.toString() === req.userId);

    if (liked) {
      item.likes = item.likes.filter((userId) => userId.toString() !== req.userId);
    } else {
      item.likes.push(req.userId);
    }

    await item.save();

    const populatedItem = await populateContent(Model.findById(id));

    if (!liked) {
      await createNotification({
        recipient: item.author,
        actor: req.userId,
        type: "like",
        contentType: type,
        contentId: item._id,
      });
    }

    broadcastContentUpdate();

    return res.status(200).json(serializeContent(populatedItem, type));
  } catch (error) {
    return res.status(500).json({ message: `like error ${error.message}` });
  }
};

export const addComment = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { text } = req.body;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const cleanText = text?.trim();
    if (!cleanText) {
      return res.status(400).json({ message: "Comment cannot be empty" });
    }

    const item = await Model.findById(id);
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    item.comments.push({
      author: req.userId,
      text: cleanText,
    });
    const newComment = item.comments[item.comments.length - 1];

    await item.save();

    const populatedItem = await populateContent(Model.findById(id));

    await createNotification({
      recipient: item.author,
      actor: req.userId,
      type: "comment",
      contentType: type,
      contentId: item._id,
      commentId: newComment?._id,
      text: cleanText,
    });

    broadcastContentUpdate();

    return res.status(201).json(serializeContent(populatedItem, type));
  } catch (error) {
    return res.status(500).json({ message: `comment error ${error.message}` });
  }
};

export const addCommentReply = async (req, res) => {
  try {
    const { type, id, commentId } = req.params;
    const { text } = req.body;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const cleanText = text?.trim();
    if (!cleanText) {
      return res.status(400).json({ message: "Reply cannot be empty" });
    }

    const item = await Model.findById(id);
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    const comment = item.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    comment.replies = comment.replies || [];
    comment.replies.push({
      author: req.userId,
      text: cleanText,
    });
    const newReply = comment.replies[comment.replies.length - 1];

    await item.save();

    const populatedItem = await populateContent(Model.findById(id));
    const replyRecipient = comment.author?.toString();
    if (replyRecipient && replyRecipient !== req.userId) {
      await createNotification({
        recipient: comment.author,
        actor: req.userId,
        type: "reply",
        contentType: type,
        contentId: item._id,
        commentId: comment._id,
        replyId: newReply?._id,
        text: cleanText,
      });
    }

    broadcastContentUpdate();

    return res.status(201).json(serializeContent(populatedItem, type));
  } catch (error) {
    return res.status(500).json({ message: `reply error ${error.message}` });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const { type, id, commentId } = req.params;
    const Model = contentModels[type];

    if (!Model) {
      return res.status(400).json({ message: "Invalid content type" });
    }

    const item = await Model.findById(id);
    if (!item) {
      return res.status(404).json({ message: "Content not found" });
    }

    const comment = item.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const ownsComment = comment.author.toString() === req.userId;
    const ownsContent = item.author.toString() === req.userId;

    if (!ownsComment && !ownsContent) {
      return res.status(403).json({ message: "You cannot delete this comment" });
    }

    item.comments.pull(commentId);
    await item.save();

    const populatedItem = await populateContent(Model.findById(id));
    broadcastContentUpdate();

    return res.status(200).json(serializeContent(populatedItem, type));
  } catch (error) {
    return res.status(500).json({ message: `delete comment error ${error.message}` });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.userId })
      .populate("actor", "name userName profileImage isVerified")
      .sort({ createdAt: -1 })
      .limit(30);

    return res.status(200).json(notifications);
  } catch (error) {
    return res.status(500).json({ message: `notifications error ${error.message}` });
  }
};

export const notificationEvents = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  addNotificationClient(req.userId, res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  req.on("close", () => {
    removeNotificationClient(req.userId, res);
  });
};

export const markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.userId, read: false }, { $set: { read: true } });
    return res.status(200).json({ message: "Notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ message: `notification update error ${error.message}` });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const result = await Notification.deleteOne({
      _id: req.params.notificationId,
      recipient: req.userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    return res.status(200).json({
      id: req.params.notificationId,
      message: "Notification deleted",
    });
  } catch (error) {
    return res.status(500).json({ message: `notification delete error ${error.message}` });
  }
};

const storyExpiryTimer = setInterval(() => {
  cleanupExpiredStoriesAndBroadcast().catch(() => {});
}, 60 * 1000);

storyExpiryTimer.unref?.();
