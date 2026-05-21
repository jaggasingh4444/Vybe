import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    clientId: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },
    mediaType: {
      type: String,
      enum: ["image", "video"],
    },
    media: {
      type: String,
    },
    attachments: [
      {
        mediaType: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
        media: {
          type: String,
          required: true,
        },
      },
    ],
    sharedContent: {
      contentType: {
        type: String,
        enum: ["post", "reel"],
      },
      contentId: String,
      mediaType: String,
      media: String,
      caption: String,
      author: {
        _id: String,
        name: String,
        userName: String,
        profileImage: String,
      },
      createdAt: Date,
    },
    replyTo: {
      messageId: String,
      sender: {
        _id: String,
        name: String,
        userName: String,
      },
      text: String,
      mediaType: String,
      media: String,
      sharedContentType: String,
      createdAt: Date,
    },
    connectionStatus: {
      type: String,
      enum: ["connected", "pending"],
      default: "connected",
    },
    read: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
    delivered: {
      type: Boolean,
      default: false,
    },
    deliveredAt: {
      type: Date,
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        emoji: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, read: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, delivered: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, connectionStatus: 1, createdAt: -1 });
messageSchema.index({ updatedAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
