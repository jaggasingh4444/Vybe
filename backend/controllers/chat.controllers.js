import mongoose from "mongoose";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import Post from "../models/post.model.js";
import Loop from "../models/loop.model.js";
import { isDataUrl, isStoredMediaUrl, saveBinaryMedia, saveDataUrlMedia } from "../utils/mediaStorage.js";

const chatClients = new Map();

const safeUserSelect = "name userName profileImage followers following";
const messageUserSelect = "name userName";
const reactionUserSelect = "name userName profileImage";
const sharedContentModels = {
  post: Post,
  reel: Loop,
};
const allowedReactionEmojis = ["❤️", "😂", "🔥", "👏", "😮", "😢", "👍", "😍", "🙌", "💯"];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const visibleToUserFilter = (userId) => ({
  deletedFor: { $ne: userId },
});

const normalizeChatAttachments = (body) => {
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  const attachments = rawAttachments
    .map((item) => ({
      mediaType: item?.mediaType || "",
      media: item?.media || "",
    }))
    .filter((item) => item.media && item.mediaType);

  if (attachments.length === 0 && body.media && body.mediaType) {
    attachments.push({ mediaType: body.mediaType, media: body.media });
  }

  if (attachments.length > 6) {
    const error = new Error("You can send up to 6 photos or videos at once");
    error.status = 400;
    throw error;
  }

  for (const attachment of attachments) {
    if (!["image", "video"].includes(attachment.mediaType)) {
      const error = new Error("Chat media must be an image or video");
      error.status = 400;
      throw error;
    }

    if (!isDataUrl(attachment.media) && !isStoredMediaUrl(attachment.media)) {
      const error = new Error("Valid chat media is required");
      error.status = 400;
      throw error;
    }
  }

  return attachments;
};

const populateMessage = (query) =>
  query
    .populate("sender", messageUserSelect)
    .populate("receiver", messageUserSelect)
    .populate("reactions.user", reactionUserSelect);

const getIdString = (value) => value?._id?.toString?.() || value?.toString?.() || "";

const isMessageParticipant = (message, userId) =>
  [getIdString(message.sender), getIdString(message.receiver)].includes(userId);

const areMutualConnections = (currentUser, otherUserId) => {
  const otherId = otherUserId.toString();
  const followers = currentUser?.followers || [];
  const following = currentUser?.following || [];

  return (
    followers.some((id) => id.toString() === otherId) &&
    following.some((id) => id.toString() === otherId)
  );
};

const persistLegacyProfileImage = async (user, req) => {
  if (!user || !isDataUrl(user.profileImage)) return user;

  const profileImage = await saveDataUrlMedia(user.profileImage, "profiles", req);
  user.profileImage = profileImage;
  await User.findByIdAndUpdate(user._id, { $set: { profileImage } });
  return user;
};

const getReactionUsers = (messages) => {
  const users = new Map();

  for (const message of messages) {
    for (const reaction of message.reactions || []) {
      const user = reaction.user;
      if (user?._id) users.set(user._id.toString(), user);
    }
  }

  return [...users.values()];
};

const buildSharedContentSnapshot = async (sharedContent, req) => {
  if (!sharedContent) return null;

  const contentType = sharedContent.type || sharedContent.contentType;
  const contentId = sharedContent.id || sharedContent.contentId;
  const Model = sharedContentModels[contentType];

  if (!Model || !contentId) {
    const error = new Error("Shared content is invalid");
    error.status = 400;
    throw error;
  }

  const item = await Model.findById(contentId).populate("author", "name userName profileImage");
  if (!item) {
    const error = new Error("Shared content not found");
    error.status = 404;
    throw error;
  }
  await persistLegacyProfileImage(item.author, req);

  return {
    contentType,
    contentId: item._id.toString(),
    mediaType: item.mediaType || "video",
    media: item.media,
    caption: item.caption || "",
    author: {
      _id: item.author?._id?.toString() || "",
      name: item.author?.name || "",
      userName: item.author?.userName || "",
      profileImage: item.author?.profileImage || "",
    },
    createdAt: item.createdAt,
  };
};

const buildReplySnapshot = async (messageId, userId) => {
  if (!messageId) return undefined;

  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    const error = new Error("Reply message is invalid");
    error.status = 400;
    throw error;
  }

  const message = await Message.findOne({
    _id: messageId,
    ...visibleToUserFilter(userId),
  }).populate("sender", messageUserSelect);

  if (!message) {
    const error = new Error("Reply message not found");
    error.status = 404;
    throw error;
  }

  if (!isMessageParticipant(message, userId)) {
    const error = new Error("You cannot reply to this message");
    error.status = 403;
    throw error;
  }

  return {
    messageId: message._id.toString(),
    sender: {
      _id: message.sender?._id?.toString() || message.sender?.toString() || "",
      name: message.sender?.name || "",
      userName: message.sender?.userName || "",
    },
    text: message.text || "",
    mediaType: message.mediaType || message.attachments?.[0]?.mediaType || "",
    media: message.media || message.attachments?.[0]?.media || "",
    sharedContentType: message.sharedContent?.contentType || "",
    createdAt: message.createdAt,
  };
};

const getOnlineUserIds = () => [...chatClients.keys()];

const addClient = (userId, res) => {
  const key = userId.toString();
  const clients = chatClients.get(key) || new Set();
  clients.add(res);
  chatClients.set(key, clients);
};

const removeClient = (userId, res) => {
  const key = userId.toString();
  const clients = chatClients.get(key);
  if (!clients) return;

  clients.delete(res);
  if (clients.size === 0) {
    chatClients.delete(key);
  }
};

const sendToUser = (userId, payload) => {
  const key = userId.toString();
  const clients = chatClients.get(key);
  if (!clients) return;

  const event = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...clients]) {
    try {
      client.write(event);
      client.flush?.();
    } catch {
      clients.delete(client);
    }
  }

  if (clients.size === 0) {
    chatClients.delete(key);
  }
};

const broadcastPresence = () => {
  const payload = {
    type: "presence:update",
    onlineUserIds: getOnlineUserIds(),
  };

  for (const userId of getOnlineUserIds()) {
    sendToUser(userId, payload);
  }
};

const notifyDeliveredMessages = async (receiverId) => {
  const pendingMessages = await Message.find({
    ...visibleToUserFilter(receiverId),
    receiver: receiverId,
    delivered: { $ne: true },
  }).select("_id sender");

  if (pendingMessages.length === 0) return;

  const deliveredAt = new Date();
  const messageIds = pendingMessages.map((message) => message._id);

  await Message.updateMany(
    { _id: { $in: messageIds } },
    { $set: { delivered: true, deliveredAt } }
  );

  const deliveredBySender = new Map();
  for (const message of pendingMessages) {
    const senderId = message.sender.toString();
    const ids = deliveredBySender.get(senderId) || [];
    ids.push(message._id.toString());
    deliveredBySender.set(senderId, ids);
  }

  for (const [senderId, ids] of deliveredBySender) {
    const payload = {
      type: "messages:delivered",
      receiverId,
      senderId,
      messageIds: ids,
      deliveredAt,
    };

    sendToUser(senderId, payload);
    sendToUser(receiverId, payload);
  }
};

export const chatEvents = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  addClient(req.userId, res);
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      onlineUserIds: getOnlineUserIds(),
    })}\n\n`
  );
  res.flush?.();
  broadcastPresence();
  notifyDeliveredMessages(req.userId).catch(() => {});

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
      res.flush?.();
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(req.userId, res);
    broadcastPresence();
  });
};

export const getChatUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select("_id");
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const messageThreads = await Message.find({
      ...visibleToUserFilter(req.userId),
      $or: [{ sender: req.userId }, { receiver: req.userId }],
    })
      .select("sender receiver updatedAt")
      .sort({ updatedAt: -1 })
      .limit(100);

    const unreadMessages = await Message.find({
      ...visibleToUserFilter(req.userId),
      receiver: req.userId,
      read: { $ne: true },
    }).select("sender");

    const unreadCountMap = new Map();
    for (const message of unreadMessages) {
      const senderId = message.sender.toString();
      unreadCountMap.set(senderId, (unreadCountMap.get(senderId) || 0) + 1);
    }

    const ids = [
      ...messageThreads.map((message) =>
        message.sender.toString() === req.userId
          ? message.receiver.toString()
          : message.sender.toString()
      ),
    ];

    const uniqueIds = [...new Set(ids)];
    const users = await User.find({ _id: { $in: uniqueIds } }).select(safeUserSelect);
    await Promise.all(users.map((user) => persistLegacyProfileImage(user, req)));
    const userMap = new Map(users.map((user) => [user._id.toString(), user]));
    const orderedUsers = uniqueIds
      .map((id) => userMap.get(id))
      .filter(Boolean)
      .map((user) => ({
        ...user.toObject(),
        unreadCount: unreadCountMap.get(user._id.toString()) || 0,
        isOnline: chatClients.has(user._id.toString()),
      }));

    return res.status(200).json(orderedUsers);
  } catch (error) {
    return res.status(500).json({ message: `chat users error ${error.message}` });
  }
};

export const searchConnectedChatUsers = async (req, res) => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const includeAllConnections = req.query.all === "1";

    if (!rawQuery && !includeAllConnections) {
      return res.status(200).json([]);
    }

    const currentUser = await User.findById(req.userId).select("followers following");
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const followerIds = new Set(currentUser.followers.map((id) => id.toString()));
    const followingIds = new Set(currentUser.following.map((id) => id.toString()));
    const mutualConnectionIds = [...followingIds].filter((id) => followerIds.has(id));

    if (mutualConnectionIds.length === 0) {
      return res.status(200).json([]);
    }

    const userQuery = {
      _id: { $in: mutualConnectionIds },
    };

    if (rawQuery) {
      const normalizedQuery = rawQuery.replace(/^@/, "");
      const searchRegex = new RegExp(escapeRegex(normalizedQuery), "i");
      const searchConditions = [
        { userName: searchRegex },
        { name: searchRegex },
      ];

      if (mongoose.Types.ObjectId.isValid(normalizedQuery)) {
        searchConditions.push({ _id: normalizedQuery });
      }

      userQuery.$or = searchConditions;
    }

    const users = await User.find(userQuery)
      .select(safeUserSelect)
      .sort({ userName: 1 })
      .limit(20);

    await Promise.all(users.map((user) => persistLegacyProfileImage(user, req)));

    return res.status(200).json(
      users.map((user) => ({
        ...user.toObject(),
        unreadCount: 0,
        isOnline: chatClients.has(user._id.toString()),
      }))
    );
  } catch (error) {
    return res.status(500).json({ message: `chat search error ${error.message}` });
  }
};

export const getMessages = async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const sinceDate = typeof req.query.since === "string" ? new Date(req.query.since) : null;
    const hasSince = sinceDate && Number.isFinite(sinceDate.getTime());
    const sinceFilter = hasSince ? { createdAt: { $gt: sinceDate } } : {};
    const conversationFilter = {
      ...visibleToUserFilter(req.userId),
      $or: [
        { sender: req.userId, receiver: otherUserId },
        { sender: otherUserId, receiver: req.userId },
      ],
      ...sinceFilter,
    };

    const unreadMessages = await Message.find({
      ...visibleToUserFilter(req.userId),
      sender: otherUserId,
      receiver: req.userId,
      read: { $ne: true },
      ...sinceFilter,
    }).select("_id delivered");

    const unreadMessageIds = unreadMessages.map((message) => message._id);

    if (unreadMessageIds.length > 0) {
      const readAt = new Date();

      await Message.updateMany(
        { _id: { $in: unreadMessageIds } },
        { $set: { read: true, readAt, delivered: true, deliveredAt: readAt } }
      );

      const newlyDeliveredIds = unreadMessages
        .filter((message) => !message.delivered)
        .map((message) => message._id.toString());

      if (newlyDeliveredIds.length > 0) {
        const deliveredPayload = {
          type: "messages:delivered",
          receiverId: req.userId,
          senderId: otherUserId,
          messageIds: newlyDeliveredIds,
          deliveredAt: readAt,
        };

        sendToUser(req.userId, deliveredPayload);
        sendToUser(otherUserId, deliveredPayload);
      }

      const payload = {
        type: "messages:seen",
        readerId: req.userId,
        senderId: otherUserId,
        messageIds: unreadMessageIds.map((id) => id.toString()),
        readAt,
      };

      sendToUser(req.userId, payload);
      sendToUser(otherUserId, payload);
    }

    const messages = await Message.find(conversationFilter)
      .populate("sender", messageUserSelect)
      .populate("receiver", messageUserSelect)
      .populate("reactions.user", reactionUserSelect)
      .sort({ createdAt: hasSince ? 1 : -1 })
      .limit(hasSince ? 30 : 100);
    const orderedMessages = hasSince ? messages : messages.reverse();

    await Promise.all(getReactionUsers(orderedMessages).map((user) => persistLegacyProfileImage(user, req)));

    return res.status(200).json(orderedMessages);
  } catch (error) {
    return res.status(500).json({ message: `messages error ${error.message}` });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const receiverId = req.params.userId;
    const sharedContent = await buildSharedContentSnapshot(req.body.sharedContent, req);
    const replyTo = await buildReplySnapshot(
      req.body.replyToMessageId || req.body.replyTo?.messageId || req.body.replyTo,
      req.userId
    );
    const attachments = normalizeChatAttachments(req.body);
    const text = req.body.text?.trim() || (sharedContent ? `Shared a ${sharedContent.contentType}` : "");
    const clientId =
      typeof req.body.clientId === "string" ? req.body.clientId.trim().slice(0, 80) : "";
    const hasMedia = attachments.length > 0;

    if (req.userId === receiverId) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }

    if (!text && !sharedContent && !hasMedia) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const currentUser = await User.findById(req.userId).select("followers following");
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (sharedContent && !areMutualConnections(currentUser, receiverId)) {
      return res.status(403).json({ message: "You can share only with connected users" });
    }

    const receiver = await User.findById(receiverId).select("_id");
    if (!receiver) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    const receiverOnline = chatClients.has(receiverId.toString());
    const deliveredAt = receiverOnline ? new Date() : undefined;
    const storedAttachments = await Promise.all(
      attachments.map(async (attachment) => ({
        mediaType: attachment.mediaType,
        media: isDataUrl(attachment.media)
          ? await saveDataUrlMedia(attachment.media, "chat", req)
          : attachment.media,
      }))
    );

    const message = await Message.create({
      sender: req.userId,
      receiver: receiverId,
      text,
      clientId,
      mediaType: storedAttachments[0]?.mediaType,
      media: storedAttachments[0]?.media,
      attachments: storedAttachments,
      sharedContent,
      replyTo,
      delivered: receiverOnline,
      deliveredAt,
    });

    const populatedMessage = await populateMessage(Message.findById(message._id));

    const payload = {
      type: "message:new",
      message: populatedMessage,
    };

    sendToUser(req.userId, payload);
    sendToUser(receiverId, payload);

    return res.status(201).json(populatedMessage);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return res.status(500).json({ message: `send message error ${error.message}` });
  }
};

export const uploadChatMedia = async (req, res) => {
  try {
    const contentType = req.get("content-type")?.split(";")[0]?.trim() || "";
    const mediaType = contentType.startsWith("video/")
      ? "video"
      : contentType.startsWith("image/")
        ? "image"
        : "";

    if (!mediaType) {
      return res.status(400).json({ message: "Chat upload must be an image or video" });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: "Chat media is empty" });
    }

    const media = await saveBinaryMedia(req.body, contentType, "chat", req);
    if (!media) {
      return res.status(400).json({ message: "Chat media upload failed" });
    }

    return res.status(201).json({ media, mediaType });
  } catch (error) {
    return res.status(500).json({ message: `chat upload error ${error.message}` });
  }
};

export const sendTypingStatus = async (req, res) => {
  try {
    const receiverId = req.params.userId;
    const typing = Boolean(req.body.typing);

    if (req.userId === receiverId) {
      return res.status(400).json({ message: "You cannot type to yourself" });
    }

    sendToUser(receiverId, {
      type: "typing:update",
      senderId: req.userId,
      receiverId,
      typing,
      at: Date.now(),
    });

    return res.status(200).json({ typing });
  } catch (error) {
    return res.status(500).json({ message: `typing status error ${error.message}` });
  }
};

export const reactToMessage = async (req, res) => {
  try {
    const emoji = req.body.emoji?.trim();

    if (!allowedReactionEmojis.includes(emoji)) {
      return res.status(400).json({ message: "Reaction is not supported" });
    }

    const message = await Message.findOne({
      _id: req.params.messageId,
      ...visibleToUserFilter(req.userId),
    });

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (!isMessageParticipant(message, req.userId)) {
      return res.status(403).json({ message: "You cannot react to this message" });
    }

    const existingReaction = message.reactions.find(
      (reaction) => reaction.user.toString() === req.userId
    );

    if (existingReaction?.emoji === emoji) {
      message.reactions.pull(existingReaction._id);
    } else if (existingReaction) {
      existingReaction.emoji = emoji;
      existingReaction.createdAt = new Date();
    } else {
      message.reactions.push({ user: req.userId, emoji });
    }

    await message.save();

    const populatedMessage = await populateMessage(Message.findById(message._id));
    const payload = {
      type: "message:reaction",
      message: populatedMessage,
    };

    sendToUser(message.sender, payload);
    sendToUser(message.receiver, payload);

    return res.status(200).json(populatedMessage);
  } catch (error) {
    return res.status(500).json({ message: `message reaction error ${error.message}` });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const scope = req.query.scope === "everyone" ? "everyone" : "me";
    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (!isMessageParticipant(message, req.userId)) {
      return res.status(403).json({ message: "You cannot delete this message" });
    }

    if (scope === "everyone") {
      if (getIdString(message.sender) !== req.userId) {
        return res.status(403).json({ message: "Only the sender can delete for everyone" });
      }

      await Message.findByIdAndDelete(req.params.messageId);

      const payload = {
        type: "message:delete",
        scope,
        messageId: req.params.messageId,
        sender: message.sender,
        receiver: message.receiver,
      };

      sendToUser(message.sender, payload);
      sendToUser(message.receiver, payload);

      return res.status(200).json({
        message: "Message deleted for everyone",
        id: req.params.messageId,
        scope,
      });
    }

    await Message.findByIdAndUpdate(req.params.messageId, {
      $addToSet: { deletedFor: req.userId },
    });

    sendToUser(req.userId, {
      type: "message:delete",
      scope,
      messageId: req.params.messageId,
      sender: message.sender,
      receiver: message.receiver,
    });

    return res.status(200).json({
      message: "Message deleted for you",
      id: req.params.messageId,
      scope,
    });
  } catch (error) {
    return res.status(500).json({ message: `delete message error ${error.message}` });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const otherUserId = req.params.userId;

    if (req.userId === otherUserId) {
      return res.status(400).json({ message: "You cannot delete a conversation with yourself" });
    }

    const otherUser = await User.findById(otherUserId).select("_id");
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await Message.updateMany({
      $or: [
        { sender: req.userId, receiver: otherUserId },
        { sender: otherUserId, receiver: req.userId },
      ],
      ...visibleToUserFilter(req.userId),
    }, {
      $addToSet: { deletedFor: req.userId },
    });

    const payload = {
      type: "conversation:delete",
      userIds: [req.userId, otherUserId],
      deletedFor: req.userId,
    };

    sendToUser(req.userId, payload);

    return res.status(200).json({ message: "Conversation deleted for you", userId: otherUserId });
  } catch (error) {
    return res.status(500).json({ message: `delete conversation error ${error.message}` });
  }
};
