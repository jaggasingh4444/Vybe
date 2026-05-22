import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import dp from "../assets/dp.png";
import { FaHeart, FaRegBookmark, FaRegComment, FaRegHeart } from "react-icons/fa6";
import { FiArrowLeft, FiBell, FiCamera, FiCheck, FiChevronLeft, FiChevronRight, FiDownload, FiHome, FiImage, FiLock, FiLogOut, FiMessageCircle, FiMoon, FiMoreVertical, FiPlus, FiSave, FiSearch, FiSend, FiSettings, FiSmile, FiSun, FiTrash2, FiUser, FiVideo, FiX } from "react-icons/fi";
import { apiUrl, mediaUrl } from "../config/api";
import { logout, setUserData } from "../redux/userSlice";
import { getTabAuthHeaders, markTabLoggedOut, withTabAuth } from "../utils/tabAuth";
import { downloadMediaFile } from "../utils/mediaDownload";
import { useThemePreference } from "../utils/theme";
import AdminVerificationPanel from "./AdminVerificationPanel";
import VerifiedBadge from "./VerifiedBadge";

const ONE_MB = 1024 * 1024;
const MAX_IMAGE_SIZE = 10 * ONE_MB;
const MAX_VIDEO_SIZE = 45 * ONE_MB;
const MESSAGE_TIMEOUT_MS = 12000;
const CHAT_MEDIA_UPLOAD_TIMEOUT_MS = 120000;
const EMOJI_OPTIONS = ["😀", "😂", "😍", "🔥", "❤️", "🙌", "👏", "😎", "🥹", "👍", "✨", "💯"];
const REACTION_OPTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "👍"];
const STORY_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STORY_VIEW_DURATION_MS = 7000;
const STATUS_AUTO_DISMISS_MS = 1800;
const CAPTION_LIMIT = 500;
const TYPING_IDLE_MS = 1400;
const TYPING_REFRESH_MS = 2000;
const TYPING_VISIBLE_MS = 3000;
const CONTENT_MEDIA_UPLOAD_TIMEOUT_MS = 120000;
const formatUnreadCount = (count) => (count > 10 ? "10+" : count);
const shouldAutoDismissStatus = (status) => /\b(uploaded|deleted)\b/i.test(status || "");
const isInternalAiSetupStatus = (status) => /OPENAI_API_KEY/i.test(status || "");
const getContentKey = (item) => (item?._id && item?.type ? `${item.type}-${item._id}` : "");
const getIdString = (value) => (value?._id || value || "").toString();
const uniqueCount = (items = []) => new Set(items.map(getIdString).filter(Boolean)).size;
const getReplyKey = (item, commentId) => `${getContentKey(item)}-${commentId}-reply`;
const isTextPost = (item) =>
  item?.type === "post" && (item?.mediaType === "text" || !item?.media);
const getContentTypeLabel = (item) => (item?.type === "reel" ? "reel" : "post");
const getNotificationContentLabel = (notification) => {
  if (notification?.contentType === "reel") return "reel";
  if (notification?.contentType === "story") return "story";
  if (notification?.contentType === "user") return "profile";
  return "post";
};
const getNotificationActionLabel = (notification) => {
  const contentLabel = getNotificationContentLabel(notification);

  switch (notification?.type) {
    case "follow":
      return "followed you";
    case "like":
      return `liked your ${contentLabel}`;
    case "comment":
      return `commented on your ${contentLabel}`;
    case "reply":
      return "replied to your comment";
    case "story_reply":
      return "replied to your story";
    default:
      return "sent you a notification";
  }
};
const getMediaSizeLimit = (file) =>
  file?.type?.startsWith("video/") ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
const formatMediaSize = (bytes) => `${Math.round(bytes / ONE_MB)} MB`;
const sharedContentToFeedItem = (sharedContent) => {
  if (!sharedContent?.contentId) return null;

  return {
    _id: sharedContent.contentId,
    type: sharedContent.contentType,
    mediaType: sharedContent.mediaType,
    media: sharedContent.media,
    caption: sharedContent.caption || "",
    author: sharedContent.author || {},
    likes: [],
    comments: [],
    createdAt: sharedContent.createdAt,
    sharedSnapshot: true,
  };
};

const getMessageAttachments = (message) => {
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    return message.attachments;
  }

  if (message.media && message.mediaType) {
    return [{ media: message.media, mediaType: message.mediaType }];
  }

  return [];
};

const getChatMediaTileClass = (count, index) => {
  if (count <= 1) return "max-h-72";
  if (count === 2) return "h-44";
  if (count === 3) return index === 0 ? "row-span-2 h-56" : "h-[6.875rem]";
  return "h-36";
};

const getMessageSenderId = (message) => message?.sender?._id || message?.sender || "";
const getMessageReceiverId = (message) => message?.receiver?._id || message?.receiver || "";
const isSameId = (left, right) =>
  Boolean(left && right) && left.toString() === right.toString();
const createChatListMessagePreview = (message, currentUserId) => {
  if (!message?._id) return null;

  const senderId = getMessageSenderId(message);
  return {
    _id: message._id,
    sender: senderId,
    receiver: getMessageReceiverId(message),
    text: message.text || "",
    mediaType: message.mediaType || getMessageAttachments(message)[0]?.mediaType || "",
    sharedContentType: message.sharedContent?.contentType || "",
    connectionStatus: message.connectionStatus || "connected",
    isMine: isSameId(senderId, currentUserId),
    createdAt: message.createdAt,
  };
};
const getChatPreviewText = (user, fallbackText) => {
  const latestMessage = user?.latestMessage;
  if (!latestMessage) return fallbackText;

  const prefix = latestMessage.isMine ? "You: " : "";
  const pendingPrefix =
    latestMessage.connectionStatus === "pending"
      ? latestMessage.isMine
        ? "Pending · "
        : "Request · "
      : "";
  if (latestMessage.text) return `${pendingPrefix}${prefix}${latestMessage.text}`;
  if (latestMessage.mediaType === "video") return `${pendingPrefix}${prefix}Video`;
  if (latestMessage.mediaType === "image") return `${pendingPrefix}${prefix}Photo`;
  if (latestMessage.sharedContentType) {
    return `${pendingPrefix}${prefix}Shared ${latestMessage.sharedContentType}`;
  }
  return `${pendingPrefix}${prefix}Message`;
};
const getReplyPreviewText = (reply) => {
  if (!reply) return "";
  if (reply.text) return reply.text;
  if (reply.mediaType === "video") return "Video";
  if (reply.mediaType === "image") return "Photo";
  if (reply.sharedContentType) return `Shared ${reply.sharedContentType}`;
  return "Message";
};
const createMessageReplySnapshot = (message) => ({
  messageId: message?._id || "",
  sender: {
    _id: getMessageSenderId(message),
    name: message?.sender?.name || "",
    userName: message?.sender?.userName || "",
  },
  text: message?.text || "",
  mediaType: message?.mediaType || getMessageAttachments(message)[0]?.mediaType || "",
  media: message?.media || getMessageAttachments(message)[0]?.media || "",
  sharedContentType: message?.sharedContent?.contentType || "",
  createdAt: message?.createdAt,
});

const getStoryExpiresAt = (story) => new Date(story?.createdAt || 0).getTime() + STORY_EXPIRY_MS;
const isStoryActive = (story, now = Date.now()) => getStoryExpiresAt(story) > now;
const getStoryAgeLabel = (story, now = Date.now()) => {
  const createdAt = new Date(story?.createdAt || 0).getTime();
  const millisecondsOld = Math.max(0, now - createdAt);
  const minutesOld = Math.floor(millisecondsOld / (60 * 1000));

  if (minutesOld < 1) return "now";
  if (minutesOld < 60) return `${minutesOld}m`;

  const hoursOld = Math.min(23, Math.floor(minutesOld / 60));
  return `${hoursOld}h`;
};
const formatContentTime = (createdAt, now = Date.now()) => {
  const createdTime = new Date(createdAt || 0).getTime();
  if (!Number.isFinite(createdTime)) return "";

  const millisecondsOld = Math.max(0, now - createdTime);
  const minutesOld = Math.floor(millisecondsOld / (60 * 1000));

  if (minutesOld < 1) return "now";
  if (minutesOld < 60) return `${minutesOld} min ago`;

  const hoursOld = Math.floor(minutesOld / 60);
  if (hoursOld < 24) {
    return `${hoursOld} ${hoursOld === 1 ? "hour" : "hours"} ago`;
  }

  const daysOld = Math.floor(hoursOld / 24);
  if (daysOld <= 2) return `${daysOld}d`;

  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(createdAt).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
};
const getStoryTimeLeftLabel = (story, now = Date.now()) => {
  const millisecondsLeft = getStoryExpiresAt(story) - now;
  if (millisecondsLeft <= 0) return "Expired";

  const hoursLeft = Math.floor(millisecondsLeft / (60 * 60 * 1000));
  if (hoursLeft >= 1) return `${hoursLeft}h left`;

  const minutesLeft = Math.max(1, Math.ceil(millisecondsLeft / (60 * 1000)));
  return `${minutesLeft}m left`;
};
const getStoryViewProgressPercent = (startedAt, now = Date.now()) => {
  if (!startedAt) return 0;

  const progress = ((now - startedAt) / STORY_VIEW_DURATION_MS) * 100;
  return Math.max(0, Math.min(100, progress));
};
const getStoryAuthorId = (story) => {
  const author = story?.author;
  if (!author) return "";

  return (author._id || author).toString();
};
const sortStoriesByCreatedAt = (a, b) =>
  new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();

const getMessageClientId = (message) => message?.clientId || "";
const getMessageReplyId = (message) => message?.replyTo?.messageId || "";
const MessageStatusTicks = ({ message }) => {
  if (!message || message.failed) return null;

  if (message.pending) {
    return (
      <span className="mt-1 flex justify-end text-[10px] font-medium text-white/70">
        Sending...
      </span>
    );
  }

  if (message.connectionStatus === "pending") {
    return (
      <span className="mt-1 flex justify-end text-[10px] font-semibold text-amber-200">
        Pending
      </span>
    );
  }

  const seen = Boolean(message.read);
  const delivered = seen || Boolean(message.delivered);
  const label = seen ? "Seen" : delivered ? "Delivered" : "Sent";

  return (
    <span
      className={`mt-1 flex items-center justify-end text-[13px] ${
        seen ? "text-sky-300" : "text-white/70"
      }`}
      aria-label={label}
      title={label}
    >
      <FiCheck />
      {delivered ? <FiCheck className="-ml-1.5" /> : null}
    </span>
  );
};
const hasMatchingPendingMessage = (pendingMessage, confirmedMessage) => {
  if (!pendingMessage?.pending || !confirmedMessage?._id) return false;

  const pendingClientId = getMessageClientId(pendingMessage);
  if (pendingClientId && pendingClientId === getMessageClientId(confirmedMessage)) {
    return true;
  }

  if (!isSameId(getMessageSenderId(pendingMessage), getMessageSenderId(confirmedMessage))) return false;
  if (!isSameId(getMessageReceiverId(pendingMessage), getMessageReceiverId(confirmedMessage))) return false;
  if ((pendingMessage.text || "") !== (confirmedMessage.text || "")) return false;
  if (getMessageReplyId(pendingMessage) !== getMessageReplyId(confirmedMessage)) return false;

  const pendingAttachments = getMessageAttachments(pendingMessage);
  const confirmedAttachments = getMessageAttachments(confirmedMessage);
  if (pendingAttachments.length !== confirmedAttachments.length) return false;
  if (
    pendingAttachments.some(
      (attachment, index) => attachment.mediaType !== confirmedAttachments[index]?.mediaType
    )
  ) {
    return false;
  }

  const pendingTime = new Date(pendingMessage.createdAt || 0).getTime();
  const confirmedTime = new Date(confirmedMessage.createdAt || 0).getTime();
  if (!Number.isFinite(pendingTime) || !Number.isFinite(confirmedTime)) return true;

  return Math.abs(confirmedTime - pendingTime) < 60 * 1000;
};
const mergeMessageIntoList = (messages, message) => {
  if (!message?._id) return messages;

  let merged = false;
  const nextMessages = messages.map((currentMessage) => {
    if (isSameId(currentMessage._id, message._id)) {
      merged = true;
      return message;
    }

    if (!merged && hasMatchingPendingMessage(currentMessage, message)) {
      merged = true;
      return message;
    }

    return currentMessage;
  });

  return merged ? nextMessages : [...nextMessages, message];
};
const mergeServerMessagesIntoList = (currentMessages, serverMessages) => {
  const serverMessageIds = new Set(serverMessages.map((message) => message._id?.toString()));
  const pendingMessages = currentMessages.filter(
    (message) =>
      message.pending &&
      !serverMessageIds.has(message._id?.toString()) &&
      !serverMessages.some((serverMessage) => hasMatchingPendingMessage(message, serverMessage))
  );

  return [...serverMessages, ...pendingMessages].sort(
    (left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0)
  );
};
const getLatestMessageSyncTime = (messages) => {
  const latestTime = messages.reduce((latest, message) => {
    if (message.pending) return latest;
    const messageTime = new Date(message.createdAt || 0).getTime();
    return Number.isFinite(messageTime) ? Math.max(latest, messageTime) : latest;
  }, 0);

  return latestTime ? new Date(Math.max(0, latestTime - 3000)).toISOString() : "";
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const fetchJsonWithTimeout = async (url, options = {}, timeoutMessage = "Request timed out.") => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MESSAGE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const uploadJsonWithProgress = ({ url, payload, onProgress, errorMessage = "Upload failed" }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    getTabAuthHeaders({ "Content-Type": "application/json" }).forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const progress = Math.max(1, Math.min(98, Math.round((event.loaded / event.total) * 98)));
      onProgress?.(progress);
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.message || errorMessage));
        return;
      }

      onProgress?.(100);
      resolve(data);
    };

    xhr.onerror = () => reject(new Error(errorMessage));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(JSON.stringify(payload));
  });

const uploadContentWithFile = ({ url, file, caption, mediaType, onProgress }) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Choose a media file."));
      return;
    }

    const formData = new FormData();
    formData.append("caption", caption || "");
    formData.append("mediaType", mediaType || (file.type.startsWith("video/") ? "video" : "image"));
    formData.append("media", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.timeout = CONTENT_MEDIA_UPLOAD_TIMEOUT_MS;

    getTabAuthHeaders().forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;

      const progress = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress?.(progress);
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.message || "Upload failed"));
        return;
      }

      onProgress?.(100);
      resolve(data);
    };

    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.ontimeout = () => reject(new Error("Upload is taking too long"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(formData);
  });

const uploadChatAttachment = (attachment) =>
  new Promise((resolve, reject) => {
    if (!attachment?.file) {
      resolve({ media: attachment.media, mediaType: attachment.mediaType });
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/chat/uploads"), true);
    xhr.withCredentials = true;
    xhr.timeout = CHAT_MEDIA_UPLOAD_TIMEOUT_MS;

    getTabAuthHeaders({
      "Content-Type": attachment.file.type || "application/octet-stream",
    }).forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.onload = () => {
      let data = {};

      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.message || "Media upload failed"));
        return;
      }

      resolve({
        media: data.media,
        mediaType: data.mediaType || attachment.mediaType,
      });
    };

    xhr.onerror = () => reject(new Error("Media upload failed"));
    xhr.ontimeout = () => reject(new Error("Media upload is taking too long"));
    xhr.onabort = () => reject(new Error("Media upload cancelled"));
    xhr.send(attachment.file);
  });

function Feed() {
  const { suggestedUsers, userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();
  const displayName = userData?.name || userData?.userName || "Friend";
  const [theme, setTheme] = useThemePreference();

  const [mode, setMode] = useState("post");
  const [caption, setCaption] = useState("");
  const [captionEmojiOpen, setCaptionEmojiOpen] = useState(false);
  const [aiCaptionLoading, setAiCaptionLoading] = useState(false);
  const [aiCaptionSuggestions, setAiCaptionSuggestions] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [feed, setFeed] = useState([]);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedUserResults, setFeedUserResults] = useState([]);
  const [feedUserSearchLoading, setFeedUserSearchLoading] = useState(false);
  const [feedUserBusyId, setFeedUserBusyId] = useState("");
  const [hiddenMobileSuggestionIds, setHiddenMobileSuggestionIds] = useState(() => new Set());
  const [hiddenSuggestionsReadyForUserId, setHiddenSuggestionsReadyForUserId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileHistory, setProfileHistory] = useState([]);
  const [profileReturnTab, setProfileReturnTab] = useState("home");
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileContentType, setProfileContentType] = useState("all");
  const [profileBusy, setProfileBusy] = useState(false);
  const [selectedProfileItem, setSelectedProfileItem] = useState(null);
  const [focusedNotificationTarget, setFocusedNotificationTarget] = useState(null);
  const [profileItemMenuOpen, setProfileItemMenuOpen] = useState(false);
  const [connectionsPanel, setConnectionsPanel] = useState({
    open: false,
    type: "followers",
    owner: null,
    users: [],
    loading: false,
    error: "",
  });
  const [connectionsBusyUserId, setConnectionsBusyUserId] = useState("");
  const [stories, setStories] = useState([]);
  const [selectedStory, setSelectedStory] = useState(null);
  const [storyMediaError, setStoryMediaError] = useState(false);
  const [storyMenuOpen, setStoryMenuOpen] = useState(false);
  const [storyClock, setStoryClock] = useState(Date.now());
  const [storyViewStartedAt, setStoryViewStartedAt] = useState(0);
  const [storyViewerClock, setStoryViewerClock] = useState(Date.now());
  const [storyReplyText, setStoryReplyText] = useState("");
  const [storyReplyStatus, setStoryReplyStatus] = useState("");
  const [storyReplySending, setStoryReplySending] = useState(false);
  const [storyUploading, setStoryUploading] = useState(false);
  const [storyUploadProgress, setStoryUploadProgress] = useState(0);
  const [likedStoryIds, setLikedStoryIds] = useState(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState("home");
  const [commentInputs, setCommentInputs] = useState({});
  const [replyInputs, setReplyInputs] = useState({});
  const [commentEmojiKey, setCommentEmojiKey] = useState("");
  const [activeReplyKey, setActiveReplyKey] = useState("");
  const [pendingLikeIds, setPendingLikeIds] = useState(() => new Set());
  const [pendingCommentIds, setPendingCommentIds] = useState(() => new Set());
  const [pendingReplyIds, setPendingReplyIds] = useState(() => new Set());
  const [pendingContentDeleteIds, setPendingContentDeleteIds] = useState(() => new Set());
  const [pendingCommentDeleteIds, setPendingCommentDeleteIds] = useState(() => new Set());
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [deletingNotificationIds, setDeletingNotificationIds] = useState(() => new Set());
  const [mobileChatUsers, setMobileChatUsers] = useState([]);
  const [mobileChatSearch, setMobileChatSearch] = useState("");
  const [mobileChatSearchResults, setMobileChatSearchResults] = useState([]);
  const [mobileChatSearchLoading, setMobileChatSearchLoading] = useState(false);
  const [selectedMobileChat, setSelectedMobileChat] = useState(null);
  const [mobileMessages, setMobileMessages] = useState([]);
  const [mobileMessageText, setMobileMessageText] = useState("");
  const [mobileMessageMedia, setMobileMessageMedia] = useState([]);
  const [mobileReplyToMessage, setMobileReplyToMessage] = useState(null);
  const [mobileChatStatus, setMobileChatStatus] = useState("");
  const [mobileChatEmojiOpen, setMobileChatEmojiOpen] = useState(false);
  const [mobileMessageMenuId, setMobileMessageMenuId] = useState("");
  const [aiReplyLoading, setAiReplyLoading] = useState(false);
  const [aiReplySuggestions, setAiReplySuggestions] = useState([]);
  const [chatMediaViewer, setChatMediaViewer] = useState(null);
  const [mobileTypingUserIds, setMobileTypingUserIds] = useState(() => new Set());
  const [mobileBusyUserId, setMobileBusyUserId] = useState("");
  const [mobileConversationMenuOpen, setMobileConversationMenuOpen] = useState(false);
  const [mobileChatListMenuUserId, setMobileChatListMenuUserId] = useState("");
  const [mobileChatViewportHeight, setMobileChatViewportHeight] = useState(0);
  const [, setMobileKeyboardOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 1023px)").matches
  );
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileName, setMobileName] = useState("");
  const [mobileUserName, setMobileUserName] = useState("");
  const [mobileProfileImage, setMobileProfileImage] = useState("");
  const [mobileSettingsStatus, setMobileSettingsStatus] = useState("");
  const [mobileSaving, setMobileSaving] = useState(false);
  const [mobileCurrentPassword, setMobileCurrentPassword] = useState("");
  const [mobileNewPassword, setMobileNewPassword] = useState("");
  const [mobileConfirmPassword, setMobileConfirmPassword] = useState("");
  const [mobilePasswordStatus, setMobilePasswordStatus] = useState("");
  const [mobilePasswordSaving, setMobilePasswordSaving] = useState(false);
  const [mobilePasswordPanelOpen, setMobilePasswordPanelOpen] = useState(false);
  const [shareItem, setShareItem] = useState(null);
  const [shareSearch, setShareSearch] = useState("");
  const [shareUsers, setShareUsers] = useState([]);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [sharingUserId, setSharingUserId] = useState("");
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [feedVideosMuted, setFeedVideosMuted] = useState(true);
  const [brokenMediaKeys, setBrokenMediaKeys] = useState(() => new Set());
  const feedRootRef = useRef(null);
  const refreshHomeFeedRef = useRef(null);
  const feedVideosMutedRef = useRef(true);
  const onlineUserIdsRef = useRef(new Set());
  const pendingLikeIdsRef = useRef(new Set());
  const pendingCommentIdsRef = useRef(new Set());
  const pendingReplyIdsRef = useRef(new Set());

  const markBrokenMedia = useCallback((item) => {
    const key = getContentKey(item);
    if (!key) return;

    setBrokenMediaKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, []);

  const syncMobileChatUserFromMessage = useCallback((message) => {
    const currentUserId = userData?._id?.toString();
    if (!currentUserId || !message?._id) return;

    const senderId = getMessageSenderId(message)?.toString();
    const receiverId = getMessageReceiverId(message)?.toString();
    const otherUser = senderId === currentUserId ? message.receiver : message.sender;
    const otherUserId = otherUser?._id?.toString();
    if (!otherUserId || otherUserId === currentUserId) return;

    const selectedId = selectedMobileChatRef.current?._id?.toString();
    const isIncoming = receiverId === currentUserId;
    const isOpenChat = selectedId === otherUserId;

    setMobileChatUsers((currentUsers) => {
      const existing = currentUsers.find((user) => user._id?.toString() === otherUserId);
      const unreadCount =
        isIncoming && !isOpenChat
          ? (existing?.unreadCount || 0) + 1
          : isOpenChat
            ? 0
            : existing?.unreadCount || 0;
      const nextUser = {
        ...existing,
        ...otherUser,
        _id: otherUserId,
        profileImage: otherUser.profileImage || existing?.profileImage || "",
        isVerified: Boolean(otherUser.isVerified || existing?.isVerified),
        pendingConnection:
          message.connectionStatus === "pending"
            ? true
            : existing?.pendingConnection && message.connectionStatus !== "connected",
        unreadCount,
        isOnline: existing?.isOnline || onlineUserIdsRef.current.has(otherUserId),
        latestMessage: createChatListMessagePreview(message, currentUserId),
      };

      return [
        nextUser,
        ...currentUsers.filter((user) => user._id?.toString() !== otherUserId),
      ];
    });
  }, [userData?._id]);
  const pendingContentDeleteIdsRef = useRef(new Set());
  const pendingCommentDeleteIdsRef = useRef(new Set());
  const selectedMobileChatRef = useRef(null);
  const mobileMessagesRef = useRef([]);
  const feedSearchInputRef = useRef(null);
  const mobileMessageSyncingRef = useRef(false);
  const mobileChatUsersSyncingRef = useRef(false);
  const mobileMessagesListRef = useRef(null);
  const mobileMessageInputRef = useRef(null);
  const mobileMessageMediaInputRef = useRef(null);
  const mobileKeepKeyboardAfterSendRef = useRef(false);
  const mobileSendPointerHandledRef = useRef(false);
  const mobileMessageHoldRef = useRef({ timer: null, x: 0, y: 0 });
  const mobileChatListHoldRef = useRef({ timer: null, x: 0, y: 0, suppressClickUntil: 0 });
  const mobileOutgoingTypingRef = useRef({ receiverId: "", active: false, lastSentAt: 0 });
  const mobileStopTypingTimeoutRef = useRef(null);
  const mobileIncomingTypingTimeoutsRef = useRef(new Map());
  const notificationMenuRef = useRef(null);
  const selectedProfileItemModalRef = useRef(null);
  const mobileFollowingIds = useMemo(
    () => new Set((userData?.following || []).map((id) => id.toString())),
    [userData?.following]
  );
  const mobileFollowerIds = useMemo(
    () => new Set((userData?.followers || []).map((id) => id.toString())),
    [userData?.followers]
  );
  const mobileSuggestedUsers = useMemo(
    () =>
      suggestedUsers
        .filter(
          (user) =>
            user._id !== userData?._id &&
            !mobileFollowingIds.has(user._id) &&
            !mobileFollowerIds.has(user._id) &&
            !hiddenMobileSuggestionIds.has(user._id)
        )
        .slice(0, 10),
    [hiddenMobileSuggestionIds, mobileFollowerIds, mobileFollowingIds, suggestedUsers, userData?._id]
  );
  const isUserOnline = (user) => Boolean(user?.isOnline || onlineUserIds.has(user?._id));
  const selectedMobileChatTyping = Boolean(
    selectedMobileChat?._id && mobileTypingUserIds.has(selectedMobileChat._id)
  );
  const connectionsOwnerIsCurrentUser = isSameId(connectionsPanel.owner?._id, userData?._id);
  const focusMobileMessageInput = useCallback(() => {
    if (!isMobile || activeMobileTab !== "chat" || !selectedMobileChat?._id) return;

    window.requestAnimationFrame(() => {
      try {
        mobileMessageInputRef.current?.focus({ preventScroll: true });
      } catch {
        mobileMessageInputRef.current?.focus();
      }
      setMobileKeyboardOpen(true);
    });
  }, [activeMobileTab, isMobile, selectedMobileChat?._id]);

  useEffect(() => {
    if (!shouldAutoDismissStatus(message)) return undefined;

    const timeoutId = window.setTimeout(() => setMessage(""), STATUS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!shouldAutoDismissStatus(mobileChatStatus)) return undefined;

    const timeoutId = window.setTimeout(() => setMobileChatStatus(""), STATUS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [mobileChatStatus]);

  useEffect(() => {
    if (!chatMediaViewer) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setChatMediaViewer(null);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      setChatMediaViewer((current) => {
        if (!current?.attachments?.length) return current;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          (current.index + direction + current.attachments.length) % current.attachments.length;
        return { ...current, index: nextIndex };
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chatMediaViewer]);

  useEffect(
    () => () => {
      if (mobileMessageHoldRef.current.timer) {
        window.clearTimeout(mobileMessageHoldRef.current.timer);
      }
      if (mobileChatListHoldRef.current.timer) {
        window.clearTimeout(mobileChatListHoldRef.current.timer);
      }
    },
    []
  );

  const setMobileTypingIndicator = useCallback((senderId, typing) => {
    if (!senderId) return;

    const existingTimeout = mobileIncomingTypingTimeoutsRef.current.get(senderId);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
      mobileIncomingTypingTimeoutsRef.current.delete(senderId);
    }

    setMobileTypingUserIds((current) => {
      const next = new Set(current);
      if (typing) {
        next.add(senderId);
      } else {
        next.delete(senderId);
      }
      return next;
    });

    if (typing) {
      const timeoutId = window.setTimeout(() => {
        setMobileTypingUserIds((current) => {
          const next = new Set(current);
          next.delete(senderId);
          return next;
        });
        mobileIncomingTypingTimeoutsRef.current.delete(senderId);
      }, TYPING_VISIBLE_MS);
      mobileIncomingTypingTimeoutsRef.current.set(senderId, timeoutId);
    }
  }, []);

  const sendMobileTypingState = useCallback(async (receiverId, typing) => {
    if (!receiverId || !userData?._id || receiverId === userData._id) return;

    try {
      await fetch(apiUrl(`/api/chat/${receiverId}/typing`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ typing }),
      });
    } catch {
      // Typing indicators are intentionally silent if the network misses one.
    }
  }, [userData?._id]);

  const stopMobileOutgoingTyping = useCallback((receiverId = mobileOutgoingTypingRef.current.receiverId) => {
    if (mobileStopTypingTimeoutRef.current) {
      window.clearTimeout(mobileStopTypingTimeoutRef.current);
      mobileStopTypingTimeoutRef.current = null;
    }

    if (mobileOutgoingTypingRef.current.active && receiverId) {
      sendMobileTypingState(receiverId, false);
    }

    mobileOutgoingTypingRef.current = { receiverId: "", active: false, lastSentAt: 0 };
  }, [sendMobileTypingState]);

  const handleMobileMessageTextChange = (event) => {
    const value = event.target.value;
    const receiverId = selectedMobileChat?._id;
    setMobileMessageText(value);

    if (!receiverId) return;

    if (!value.trim()) {
      stopMobileOutgoingTyping(receiverId);
      return;
    }

    const now = Date.now();
    const shouldSendTyping =
      !mobileOutgoingTypingRef.current.active ||
      mobileOutgoingTypingRef.current.receiverId !== receiverId ||
      now - mobileOutgoingTypingRef.current.lastSentAt > TYPING_REFRESH_MS;

    if (shouldSendTyping) {
      sendMobileTypingState(receiverId, true);
      mobileOutgoingTypingRef.current = { receiverId, active: true, lastSentAt: now };
    }

    if (mobileStopTypingTimeoutRef.current) {
      window.clearTimeout(mobileStopTypingTimeoutRef.current);
    }

    mobileStopTypingTimeoutRef.current = window.setTimeout(() => {
      stopMobileOutgoingTyping(receiverId);
    }, TYPING_IDLE_MS);
  };

  const handleMobileMessageMediaChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setMobileChatStatus("");

    if (files.length === 0) return;

    if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
      setMobileChatStatus("Choose an image or video.");
      return;
    }

    const oversizedFile = files.find((file) => file.size > getMediaSizeLimit(file));
    if (oversizedFile) {
      setMobileChatStatus(
        `Each ${oversizedFile.type.startsWith("video/") ? "video" : "image"} must be under ${formatMediaSize(getMediaSizeLimit(oversizedFile))}.`
      );
      return;
    }

    if (mobileMessageMedia.length + files.length > 6) {
      setMobileChatStatus("You can send up to 6 photos or videos at once.");
      return;
    }

    try {
      const mediaItems = files.map((file) => ({
        file,
        media: URL.createObjectURL(file),
        mediaType: file.type.startsWith("video/") ? "video" : "image",
        name: file.name,
      }));
      setMobileChatEmojiOpen(false);
      setMobileMessageMedia((current) => [...current, ...mediaItems]);
    } catch {
      setMobileChatStatus("Unable to read media.");
    }
  };

  const generateAiReplies = async () => {
    if (!selectedMobileChat?._id || aiReplyLoading) return;

    setAiReplyLoading(true);
    setAiReplySuggestions([]);
    setMobileChatStatus("");

    const recentMessages = mobileMessages
      .filter((message) => !message.pending && !message.failed)
      .slice(-8)
      .map((message) => ({
        mine: isSameId(getMessageSenderId(message), userData?._id),
        text: message.text || "",
        mediaType: message.mediaType || getMessageAttachments(message)[0]?.mediaType || "",
        sharedContentType: message.sharedContent?.contentType || "",
      }));

    try {
      const { res, data } = await fetchJsonWithTimeout(
        apiUrl("/api/ai/chat-replies"),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            receiverName: selectedMobileChat.userName,
            messages: recentMessages,
          }),
        },
        "AI replies are taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "AI replies failed.");

      setAiReplySuggestions(data.suggestions || []);
    } catch (error) {
      setMobileChatStatus(error.message || "AI replies failed.");
    } finally {
      setAiReplyLoading(false);
    }
  };

  const clearMobileMessageMedia = (indexToRemove) => {
    setMobileMessageMedia((current) =>
      typeof indexToRemove === "number"
        ? current.filter((_, index) => index !== indexToRemove)
        : []
    );
  };

  const activeStories = useMemo(
    () => stories.filter((story) => isStoryActive(story, storyClock)),
    [stories, storyClock]
  );
  const storyGroups = useMemo(() => {
    const groupedStories = new Map();

    activeStories.forEach((story) => {
      const authorId = getStoryAuthorId(story);
      if (!authorId) return;

      const group = groupedStories.get(authorId) || {
        authorId,
        author: story.author,
        stories: [],
      };

      group.author = story.author || group.author;
      group.stories.push(story);
      groupedStories.set(authorId, group);
    });

    return Array.from(groupedStories.values())
      .map((group) => {
        const orderedStories = [...group.stories].sort(sortStoriesByCreatedAt);
        const latestStory = orderedStories[orderedStories.length - 1];
        const hasUnviewed = orderedStories.some(
          (story) => !story.viewers?.some((id) => id.toString() === userData?._id)
        );

        return {
          ...group,
          author: latestStory?.author || group.author,
          stories: orderedStories,
          latestStory,
          hasUnviewed,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.latestStory?.createdAt || 0).getTime() -
          new Date(a.latestStory?.createdAt || 0).getTime()
      );
  }, [activeStories, userData?._id]);
  const ownStoryGroup = storyGroups.find((group) => group.authorId === userData?._id);
  const visibleStoryGroups = storyGroups.filter((group) => group.authorId !== userData?._id);

  const selectedMediaType = useMemo(() => {
    if (!selectedFile) return "";
    return selectedFile.type.startsWith("video/") ? "video" : "image";
  }, [selectedFile]);

  const closeStoryViewer = useCallback(() => {
    setSelectedStory(null);
    setStoryMediaError(false);
    setStoryMenuOpen(false);
    setStoryReplyText("");
    setStoryReplyStatus("");
    setStoryViewStartedAt(0);
    setStoryViewerClock(Date.now());
  }, []);

  useEffect(() => {
    if (!userData) return;
    setMobileName(userData.name || "");
    setMobileUserName(userData.userName || "");
    setMobileProfileImage(userData.profileImage || "");
  }, [userData]);

  useEffect(() => {
    if (!userData?._id) return;

    try {
      const storedIds = JSON.parse(
        localStorage.getItem(`vybe-hidden-mobile-suggestions-${userData._id}`) || "[]"
      );

      setHiddenMobileSuggestionIds(new Set(Array.isArray(storedIds) ? storedIds : []));
    } catch {
      setHiddenMobileSuggestionIds(new Set());
    } finally {
      setHiddenSuggestionsReadyForUserId(userData._id);
    }
  }, [userData?._id]);

  useEffect(() => {
    if (!userData?._id || hiddenSuggestionsReadyForUserId !== userData._id) return;

    localStorage.setItem(
      `vybe-hidden-mobile-suggestions-${userData._id}`,
      JSON.stringify([...hiddenMobileSuggestionIds])
    );
  }, [hiddenMobileSuggestionIds, hiddenSuggestionsReadyForUserId, userData?._id]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateScreen = () => setIsMobile(mediaQuery.matches);

    updateScreen();
    mediaQuery.addEventListener("change", updateScreen);

    return () => mediaQuery.removeEventListener("change", updateScreen);
  }, []);

  useEffect(() => {
    feedVideosMutedRef.current = feedVideosMuted;

    feedRootRef.current
      ?.querySelectorAll("video[data-feed-video]")
      .forEach((video) => {
        video.muted = feedVideosMuted;
      });
  }, [feedVideosMuted, activeMobileTab, feed]);

  useEffect(() => {
    mobileMessagesRef.current = mobileMessages;
  }, [mobileMessages]);

  useEffect(() => {
    selectedMobileChatRef.current = selectedMobileChat;
  }, [selectedMobileChat]);

  useEffect(() => {
    onlineUserIdsRef.current = onlineUserIds;
  }, [onlineUserIds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStoryClock(Date.now());
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedStory) return undefined;

    const timer = window.setInterval(() => {
      setStoryViewerClock(Date.now());
    }, 100);

    return () => window.clearInterval(timer);
  }, [selectedStory]);

  useEffect(() => {
    setStories((currentStories) => {
      const activeItems = currentStories.filter((story) => isStoryActive(story, storyClock));
      return activeItems.length === currentStories.length ? currentStories : activeItems;
    });

    if (selectedStory && !isStoryActive(selectedStory, storyClock)) {
      closeStoryViewer();
    }
  }, [closeStoryViewer, selectedStory, storyClock]);

  const fetchFeed = async () => {
    try {
      const res = await fetch(apiUrl("/api/content/feed"), {
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to load feed");

      const data = await res.json();
      setFeed(data);
    } catch {
      setMessage("Unable to load feed right now.");
    } finally {
      setLoadingFeed(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch(apiUrl("/api/content/notifications"), {
        credentials: "include",
      });

      if (!res.ok) return;

      const data = await res.json();
      setNotifications(data);
    } catch {
      setNotifications([]);
    }
  };

  useEffect(() => {
    if (!notificationsOpen) return;

    const closeNotificationsOnOutsideClick = (event) => {
      if (notificationMenuRef.current?.contains(event.target)) return;
      setNotificationsOpen(false);
    };

    document.addEventListener("pointerdown", closeNotificationsOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeNotificationsOnOutsideClick);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!selectedProfileItem || !focusedNotificationTarget) return undefined;
    if (focusedNotificationTarget.contentKey !== getContentKey(selectedProfileItem)) return undefined;

    const targetId = focusedNotificationTarget.replyId || focusedNotificationTarget.commentId;
    if (!targetId) return undefined;

    const attributeName = focusedNotificationTarget.replyId
      ? "data-vybe-reply-id"
      : "data-vybe-comment-id";
    const selector = `[${attributeName}="${targetId}"]`;
    const scrollTimer = window.setTimeout(() => {
      selectedProfileItemModalRef.current?.querySelector(selector)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 120);
    const clearTimer = window.setTimeout(() => {
      setFocusedNotificationTarget(null);
    }, 2800);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [focusedNotificationTarget, selectedProfileItem]);

  const fetchStories = async () => {
    try {
      const res = await fetch(apiUrl("/api/content/stories"), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) return;

      const data = await res.json();
      const activeServerStories = data.filter((story) => isStoryActive(story));
      const serverStoryIds = new Set(activeServerStories.map((story) => story._id));

      setStories((currentStories) => [
        ...currentStories.filter(
          (story) =>
            story._localUpload &&
            isStoryActive(story) &&
            !serverStoryIds.has(story._id)
        ),
        ...activeServerStories,
      ]);
    } catch {
      // Keep already-loaded stories visible if a refresh briefly fails.
    }
  };

  const scrollFeedToTop = () => {
    requestAnimationFrame(() => {
      feedRootRef.current?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  };

  const refreshHomeFeed = () => {
    setActiveMobileTab("home");
    setFeedSearch("");
    setCreateOpen(false);
    setSelectedStory(null);
    setSelectedProfileItem(null);
    setMessage("");
    setLoadingFeed(true);
    fetchFeed();
    fetchStories();
    fetchNotifications();
    scrollFeedToTop();
  };
  refreshHomeFeedRef.current = refreshHomeFeed;

  const fetchMobileChatUsers = async (options = {}) => {
    try {
      const res = await fetch(apiUrl("/api/chat/users"), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) return;

      const data = await res.json();
      setMobileChatUsers(data);
    } catch {
      if (!options.silent) {
        setMobileChatStatus("Unable to load chats.");
      }
    }
  };

  const fetchShareUsers = useCallback(async (query = "", signal) => {
    setShareSearchLoading(true);

    try {
      const params = new URLSearchParams({ all: "1" });
      const normalizedQuery = query.trim();
      if (normalizedQuery) params.set("q", normalizedQuery);

      const res = await fetch(apiUrl(`/api/chat/search-users?${params.toString()}`), {
        credentials: "include",
        headers: getTabAuthHeaders(),
        signal,
      });

      if (!res.ok) throw new Error("Unable to load share users");

      const data = await res.json();
      if (!signal?.aborted) {
        setShareUsers(data);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setShareUsers([]);
      }
    } finally {
      if (!signal?.aborted) {
        setShareSearchLoading(false);
      }
    }
  }, []);

  const fetchMobileMessages = async (userId, options = {}) => {
    try {
      const since = options.since
        ? `?since=${encodeURIComponent(options.since)}`
        : "";
      const res = await fetch(apiUrl(`/api/chat/${userId}/messages${since}`), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) throw new Error("Failed to load messages");

      const data = await res.json();
      setMobileMessages((current) =>
        options.since
          ? data.reduce((messages, message) => mergeMessageIntoList(messages, message), current)
          : mergeServerMessagesIntoList(current, data)
      );
    } catch {
      if (!options.silent) {
        setMobileChatStatus("Unable to load messages.");
      }
    }
  };

  const markMobileOpenChatRead = useCallback(async (userId) => {
    if (!userId) return;

    try {
      const res = await fetch(apiUrl(`/api/chat/${userId}/messages/read`), {
        method: "PATCH",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.messageIds?.length) {
        const seenIds = new Set(data.messageIds.map((id) => id.toString()));
        setMobileMessages((current) =>
          current.map((message) =>
            seenIds.has(message._id?.toString())
              ? { ...message, read: true, readAt: data.readAt }
              : message
          )
        );
      }
    } catch {
      // The next realtime/read refresh will repair receipt state if this tiny request fails.
    }
  }, []);

  useEffect(() => {
    const query = mobileChatSearch.trim();

    if (!query || activeMobileTab !== "chat" || !userData?._id) {
      setMobileChatSearchResults([]);
      setMobileChatSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const searchTimer = window.setTimeout(async () => {
      setMobileChatSearchLoading(true);

      try {
        const res = await fetch(apiUrl(`/api/chat/search-users?q=${encodeURIComponent(query)}`), {
          credentials: "include",
          headers: getTabAuthHeaders(),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Chat search failed");

        const data = await res.json();
        setMobileChatSearchResults(data);
      } catch (error) {
        if (error.name !== "AbortError") {
          setMobileChatSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setMobileChatSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [activeMobileTab, mobileChatSearch, userData?._id]);

  useEffect(() => {
    if (!shareItem || !userData?._id) {
      setShareUsers([]);
      setShareSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const searchTimer = window.setTimeout(() => {
      fetchShareUsers(shareSearch, controller.signal);
    }, 200);

    return () => {
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [fetchShareUsers, shareItem, shareSearch, userData?._id]);

  useEffect(() => {
    const query = feedSearch.trim();

    if (!query || activeMobileTab !== "search") {
      setFeedUserResults([]);
      setFeedUserSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const searchTimer = setTimeout(async () => {
      setFeedUserSearchLoading(true);

      try {
        const res = await fetch(apiUrl(`/api/users/search?q=${encodeURIComponent(query)}`), {
          credentials: "include",
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("User search failed");

        const data = await res.json();
        setFeedUserResults(data);
      } catch (error) {
        if (error.name !== "AbortError") {
          setFeedUserResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setFeedUserSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(searchTimer);
      controller.abort();
    };
  }, [feedSearch, activeMobileTab]);

  useEffect(() => {
    fetchFeed();
    fetchNotifications();
    fetchStories();
    fetchMobileChatUsers();

    const events = new EventSource(withTabAuth(apiUrl("/api/content/events")), {
      withCredentials: true,
    });

    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "notification:new") {
          setNotifications((current) => [data.notification, ...current]);
          return;
        }

        if (data.type === "content:new") {
          fetchFeed();
          fetchStories();
          return;
        }

        if (data.type === "story:update" || data.type === "story:expired") {
          fetchStories();
        }
      } catch {
        fetchFeed();
        fetchStories();
      }
    };

    events.onerror = () => {
      events.close();
    };

    return () => events.close();
  }, []);

  useEffect(() => {
    if (!userData?._id || !isMobile) return;

    const events = new EventSource(withTabAuth(apiUrl("/api/chat/events")), {
      withCredentials: true,
    });

    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected" || data.type === "presence:update") {
          setOnlineUserIds(new Set(data.onlineUserIds || []));
          return;
        }

        if (data.type === "typing:update") {
          if (data.receiverId === userData?._id) {
            setMobileTypingIndicator(data.senderId, data.typing);
          }
          return;
        }

        if (data.type === "message:delete") {
          setMobileMessages((current) =>
            current.filter((item) => item._id !== data.messageId)
          );
          setMobileReplyToMessage((current) =>
            current?._id === data.messageId ? null : current
          );
          fetchMobileChatUsers();
          return;
        }

        if (data.type === "message:reaction") {
          setMobileMessages((current) =>
            current.map((item) => (item._id === data.message._id ? data.message : item))
          );
          return;
        }

        if (data.type === "messages:delivered") {
          markMobileMessagesDelivered(data.messageIds, data.deliveredAt);
          return;
        }

        if (data.type === "messages:seen") {
          markMobileMessagesSeen(data.messageIds, data.readAt);
          return;
        }

        if (data.type === "conversation:delete") {
          const selectedId = selectedMobileChatRef.current?._id;
          const currentUserId = userData?._id;
          const deletedUserIds = data.userIds || [];
          const isOpenChatDeleted =
            selectedId &&
            currentUserId &&
            deletedUserIds.includes(selectedId) &&
            deletedUserIds.includes(currentUserId);

          if (isOpenChatDeleted) {
            setMobileMessages([]);
            setSelectedMobileChat(null);
            setMobileConversationMenuOpen(false);
            setMobileChatStatus("Conversation deleted.");
          }

          fetchMobileChatUsers();
          return;
        }

        if (data.type !== "message:new") return;

        const incoming = data.message;
        setMobileTypingIndicator(incoming.sender?._id, false);
        syncMobileChatUserFromMessage(incoming);

        const selectedId = selectedMobileChatRef.current?._id;
        const currentUserId = userData?._id;
        const belongsToOpenChat =
          selectedId &&
          currentUserId &&
          [incoming.sender?._id, incoming.receiver?._id].includes(selectedId) &&
          [incoming.sender?._id, incoming.receiver?._id].includes(currentUserId);

        if (belongsToOpenChat) {
          setMobileMessages((current) => mergeMessageIntoList(current, incoming));

          if (incoming.receiver?._id === currentUserId) {
            markMobileOpenChatRead(selectedId);
          }
        }
      } catch {
        fetchMobileChatUsers();
      }
    };

    events.onerror = () => {
      fetchMobileChatUsers();
    };

    return () => events.close();
  }, [isMobile, markMobileOpenChatRead, setMobileTypingIndicator, syncMobileChatUserFromMessage, userData?._id]);

  useEffect(() => {
    if (!isMobile || activeMobileTab !== "chat" || !selectedMobileChat?._id) return undefined;

    let stopped = false;
    const syncOpenChat = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (mobileMessageSyncingRef.current) return;

      const since = getLatestMessageSyncTime(mobileMessagesRef.current);
      mobileMessageSyncingRef.current = true;
      fetchMobileMessages(selectedMobileChat._id, { silent: true, since })
        .finally(() => {
          mobileMessageSyncingRef.current = false;
        });
    };

    const firstSync = window.setTimeout(syncOpenChat, 250);
    const interval = window.setInterval(syncOpenChat, 700);

    return () => {
      stopped = true;
      window.clearTimeout(firstSync);
      window.clearInterval(interval);
    };
  }, [activeMobileTab, isMobile, selectedMobileChat?._id]);

  useEffect(() => {
    if (!userData?._id || !isMobile || activeMobileTab !== "chat") return undefined;

    let stopped = false;
    const syncMobileChatList = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (mobileChatUsersSyncingRef.current) return;

      mobileChatUsersSyncingRef.current = true;
      fetchMobileChatUsers({ silent: true }).finally(() => {
        mobileChatUsersSyncingRef.current = false;
      });
    };

    const firstSync = window.setTimeout(syncMobileChatList, 250);
    const interval = window.setInterval(syncMobileChatList, 1000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncMobileChatList();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      window.clearTimeout(firstSync);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeMobileTab, isMobile, userData?._id]);

  useEffect(() => {
    const handleSidebarAction = (event) => {
      const action = event.detail?.action;

      if (action === "home") {
        refreshHomeFeedRef.current?.();
      }

      if (action === "search") {
        setActiveMobileTab("search");
        setCreateOpen(false);
        setSelectedStory(null);
        setSelectedProfileItem(null);
        setMessage("");
        requestAnimationFrame(() => feedSearchInputRef.current?.focus());
      }

      if (action === "create") {
        setMode("post");
        setActiveMobileTab("home");
        setCreateOpen(true);
        setMessage("");
      }

      if (action === "messages" && window.innerWidth < 1024) {
        setActiveMobileTab("chat");
        setMessage("");
      }

      if (action === "saved") {
        setActiveMobileTab("home");
        setMessage("Saved posts will appear here when you save content.");
      }
    };

    window.addEventListener("vybe:sidebar-action", handleSidebarAction);
    return () => window.removeEventListener("vybe:sidebar-action", handleSidebarAction);
  }, []);

  useEffect(() => {
    const messagesList = mobileMessagesListRef.current;
    if (!messagesList) return;

    messagesList.scrollTo({
      top: messagesList.scrollHeight,
      behavior: "auto",
    });
  }, [mobileMessages, selectedMobileChat?._id, selectedMobileChatTyping]);

  useEffect(() => {
    stopMobileOutgoingTyping();
    setMobileTypingUserIds(new Set());
    setMobileMessageMenuId("");
    setMobileReplyToMessage(null);
    setAiReplySuggestions([]);
  }, [selectedMobileChat?._id, stopMobileOutgoingTyping]);

  useEffect(() => () => {
    stopMobileOutgoingTyping();
    mobileIncomingTypingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    mobileIncomingTypingTimeoutsRef.current.clear();
  }, [stopMobileOutgoingTyping]);

  useEffect(() => {
    setMobileConversationMenuOpen(false);
  }, [selectedMobileChat?._id]);

  useEffect(() => {
    setProfileItemMenuOpen(false);
  }, [selectedProfileItem?._id, selectedProfileItem?.type]);

  const clearSelectedFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(null);
    setPreview("");
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    clearSelectedFile();
    setCaptionEmojiOpen(false);
    setAiCaptionSuggestions([]);
    setMessage("");
  };

  const addEmojiToCaption = (emoji) => {
    setCaption((currentCaption) => {
      if (currentCaption.length + emoji.length > 220) return currentCaption;
      return `${currentCaption}${emoji}`;
    });
  };

  const generateAiCaptions = async () => {
    if (aiCaptionLoading || uploading) return;

    setAiCaptionLoading(true);
    setAiCaptionSuggestions([]);
    setMessage("");

    try {
      const { res, data } = await fetchJsonWithTimeout(
        apiUrl("/api/ai/captions"),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            mode,
            caption,
            mediaType: selectedMediaType || (selectedFile ? "media" : "text"),
          }),
        },
        "AI captions are taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "AI caption failed.");

      setAiCaptionSuggestions(data.suggestions || []);
      setMessage(data.message || "AI captions ready.");
    } catch (error) {
      setMessage(error.message || "AI caption failed.");
    } finally {
      setAiCaptionLoading(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMessage("");

    if (!file) return;

    if (file.size > getMediaSizeLimit(file)) {
      setMessage(`Please choose a file under ${formatMediaSize(getMediaSizeLimit(file))}.`);
      return;
    }

    if (mode === "reel" && !file.type.startsWith("video/")) {
      setMessage("Reels must be video files.");
      return;
    }

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setMessage("Please choose an image or video.");
      return;
    }

    if (file.type.startsWith("video/") && mode === "post") {
      setMode("reel");
    }

    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleStoryFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMessage("");

    if (!file) return;

    if (file.size > getMediaSizeLimit(file)) {
      setMessage(`Please choose a story under ${formatMediaSize(getMediaSizeLimit(file))}.`);
      return;
    }

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setMessage("Stories must be an image or video.");
      return;
    }

    setStoryUploading(true);
    setStoryUploadProgress(4);

    try {
      const mediaType = file.type.startsWith("video/") ? "video" : "image";

      const data = await uploadContentWithFile({
        url: apiUrl("/api/content/stories"),
        file,
        caption: "",
        mediaType,
        onProgress: (progress) => setStoryUploadProgress(Math.max(4, progress)),
      });

      const uploadedStory = {
        ...data,
        author: data.author || {
          _id: userData?._id,
          name: userData?.name,
          userName: userData?.userName,
          profileImage: userData?.profileImage,
        },
        media: data.media || "",
        mediaType: data.mediaType || mediaType,
        viewers: Array.isArray(data.viewers) ? data.viewers : [],
        createdAt: data.createdAt || new Date().toISOString(),
        _localUpload: true,
      };

      setStories((currentStories) => [
        uploadedStory,
        ...currentStories.filter(
          (story) =>
            story._id !== uploadedStory._id &&
            isStoryActive(story)
        ),
      ]);
      setSelectedStory(uploadedStory);
      setStoryMediaError(false);
      setStoryMenuOpen(false);
      setStoryViewStartedAt(Date.now());
      setStoryViewerClock(Date.now());
      setStoryReplyText("");
      setStoryReplyStatus("");
      fetchStories();
      setMessage("Story uploaded.");
    } catch (error) {
      setMessage(error.message || "Story upload failed.");
      setStoryUploadProgress(0);
    } finally {
      setStoryUploading(false);
      window.setTimeout(() => setStoryUploadProgress(0), 800);
    }
  };

  const handleMobileAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMobileSettingsStatus("");

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMobileSettingsStatus("Choose an image file.");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setMobileSettingsStatus("Profile photo must be under 3 MB.");
      return;
    }

    setMobileProfileImage(await readFileAsDataUrl(file));
  };

  const handleMobileSaveProfile = async (event) => {
    event.preventDefault();
    setMobileSaving(true);
    setMobileSettingsStatus("");

    try {
      const res = await fetch(apiUrl("/api/users/profile"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mobileName,
          userName: mobileUserName,
          profileImage: mobileProfileImage,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Profile update failed");

      dispatch(setUserData(data));
      setProfileData((currentProfile) =>
        currentProfile?.user?._id === data._id
          ? { ...currentProfile, user: data }
          : currentProfile
      );
      setMobileSettingsStatus("Profile updated.");
    } catch (error) {
      setMobileSettingsStatus(error.message || "Profile update failed.");
    } finally {
      setMobileSaving(false);
    }
  };

  const handleMobileChangePassword = async () => {
    setMobilePasswordStatus("");

    if (!mobileCurrentPassword || !mobileNewPassword || !mobileConfirmPassword) {
      setMobilePasswordStatus("Fill all password fields.");
      return;
    }

    if (mobileNewPassword.length < 6) {
      setMobilePasswordStatus("New password must be at least 6 characters.");
      return;
    }

    if (mobileNewPassword !== mobileConfirmPassword) {
      setMobilePasswordStatus("New passwords do not match.");
      return;
    }

    setMobilePasswordSaving(true);

    try {
      const res = await fetch(apiUrl("/api/auth/change-password"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: mobileCurrentPassword,
          newPassword: mobileNewPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Password change failed");

      setMobileCurrentPassword("");
      setMobileNewPassword("");
      setMobileConfirmPassword("");
      setMobilePasswordStatus("Password changed successfully.");
      setMobilePasswordPanelOpen(false);
    } catch (error) {
      setMobilePasswordStatus(error.message || "Password change failed.");
    } finally {
      setMobilePasswordSaving(false);
    }
  };

  const handleMobileLogout = async () => {
    markTabLoggedOut();
    dispatch(logout());
  };

  const handleMobileForgotPassword = async () => {
    markTabLoggedOut();
    dispatch(logout());
    window.location.assign("/forgot-password");
  };

  const openStory = useCallback(async (story) => {
    if (!isStoryActive(story)) {
      setStories((currentStories) => currentStories.filter((item) => item._id !== story._id));
      setSelectedStory(null);
      setStoryMenuOpen(false);
      setMessage("This story has expired.");
      return;
    }

    setSelectedStory(story);
    setStoryMediaError(false);
    setStoryMenuOpen(false);
    setStoryViewStartedAt(Date.now());
    setStoryViewerClock(Date.now());
    setStoryReplyText("");
    setStoryReplyStatus("");

    try {
      const res = await fetch(apiUrl(`/api/content/stories/${story._id}/view`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      const data = await res.json();
      if (!res.ok) {
        setStories((currentStories) => currentStories.filter((item) => item._id !== story._id));
        setSelectedStory(null);
        setStoryMenuOpen(false);
        setMessage(data.message || "Story is no longer available.");
        return;
      }

      setSelectedStory(data);
      setStories((currentStories) =>
        currentStories.map((item) => (item._id === data._id ? data : item))
      );
    } catch {
      setSelectedStory(story);
    }
  }, []);

  const handleStoryReplySubmit = async (event) => {
    event.preventDefault();

    const text = storyReplyText.trim();
    const authorId = selectedStory?.author?._id;
    if (!text || !authorId) return;

    if (authorId === userData?._id) {
      setStoryReplyStatus("This is your story.");
      return;
    }

    setStoryReplySending(true);
    setStoryReplyStatus("");

    try {
      const { res, data } = await fetchJsonWithTimeout(
        apiUrl(`/api/chat/${authorId}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ text: `Replied to your story: ${text}` }),
        },
        "Story reply is taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "Story reply failed");

      setStoryReplyText("");
      setStoryReplyStatus("Reply sent.");
      await fetchMobileChatUsers();
    } catch (error) {
      setStoryReplyStatus(error.message || "Story reply failed.");
    } finally {
      setStoryReplySending(false);
    }
  };

  const toggleStoryLike = () => {
    if (!selectedStory?._id) return;

    setLikedStoryIds((current) => {
      const next = new Set(current);
      if (next.has(selectedStory._id)) {
        next.delete(selectedStory._id);
      } else {
        next.add(selectedStory._id);
      }
      return next;
    });
  };

  const openStoryByOffset = useCallback((offset) => {
    if (!selectedStory) return;

    const currentAuthorId = getStoryAuthorId(selectedStory);
    const currentGroupIndex = storyGroups.findIndex(
      (group) => group.authorId === currentAuthorId
    );

    if (currentGroupIndex < 0) {
      if (offset > 0) closeStoryViewer();
      return;
    }

    const currentGroup = storyGroups[currentGroupIndex];
    const currentStoryIndex = currentGroup.stories.findIndex(
      (story) => story._id === selectedStory._id
    );

    if (currentStoryIndex < 0) {
      if (offset > 0) closeStoryViewer();
      return;
    }

    if (offset > 0) {
      const nextStoryInGroup = currentGroup.stories[currentStoryIndex + 1];
      if (nextStoryInGroup) {
        openStory(nextStoryInGroup);
        return;
      }

      const nextGroup = storyGroups[currentGroupIndex + 1];
      const nextGroupStory = nextGroup?.stories?.[0];
      if (nextGroupStory) {
        openStory(nextGroupStory);
        return;
      }

      closeStoryViewer();
      return;
    }

    if (offset < 0) {
      const previousStoryInGroup = currentGroup.stories[currentStoryIndex - 1];
      if (previousStoryInGroup) {
        openStory(previousStoryInGroup);
        return;
      }

      const previousGroup = storyGroups[currentGroupIndex - 1];
      const previousGroupStory = previousGroup?.stories?.[previousGroup.stories.length - 1];
      if (previousGroupStory) {
        openStory(previousGroupStory);
      }
    }
  }, [closeStoryViewer, openStory, selectedStory, storyGroups]);

  useEffect(() => {
    if (!selectedStory || !storyViewStartedAt) return;

    const currentStoryStillVisible = activeStories.some(
      (story) => story._id === selectedStory._id
    );

    if (!currentStoryStillVisible) {
      if (isStoryActive(selectedStory)) return;
      closeStoryViewer();
      return;
    }

    if (storyReplyText.trim()) return;

    const elapsed = storyViewerClock - storyViewStartedAt;
    if (elapsed >= STORY_VIEW_DURATION_MS) {
      openStoryByOffset(1);
    }
  }, [activeStories, closeStoryViewer, openStoryByOffset, selectedStory, storyReplyText, storyViewStartedAt, storyViewerClock]);

  const handleDeleteStory = async (story) => {
    if (!story?._id) return;

    try {
      const storyId = story._id;
      const res = await fetch(apiUrl(`/api/content/stories/${storyId}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Story delete failed");

      setStories((currentStories) => currentStories.filter((item) => item._id !== storyId));
      setSelectedStory(null);
      setStoryMediaError(false);
      setStoryMenuOpen(false);
      setMessage("Story deleted.");
    } catch (error) {
      setStoryMenuOpen(false);
      setMessage(error.message || "Story delete failed.");
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    setMessage("");
    const trimmedCaption = caption.trim();

    if (mode === "reel" && !selectedFile) {
      setMessage("Choose a video before sharing a reel.");
      return;
    }

    if (!selectedFile && !trimmedCaption) {
      setMessage("Write something or choose a photo/video.");
      return;
    }

    setUploading(true);
    setUploadProgress(4);

    try {
      const uploadMode = selectedFile && selectedMediaType === "video" ? "reel" : "post";
      const endpoint = uploadMode === "reel" ? "/api/content/reels" : "/api/content/posts";
      const data = selectedFile
        ? await uploadContentWithFile({
            url: apiUrl(endpoint),
            file: selectedFile,
            caption: trimmedCaption,
            mediaType: uploadMode === "reel" ? "video" : selectedMediaType,
            onProgress: (progress) => setUploadProgress(Math.max(6, progress)),
          })
        : await uploadJsonWithProgress({
            url: apiUrl(endpoint),
            payload: { caption: trimmedCaption },
            onProgress: (progress) => setUploadProgress(Math.max(8, progress)),
            errorMessage: "Upload failed",
          });

      setFeed((currentFeed) => [
        data,
        ...currentFeed.filter((item) => `${item.type}-${item._id}` !== `${data.type}-${data._id}`),
      ]);
      setProfileData((currentProfile) => {
        if (currentProfile?.user?._id !== userData?._id) return currentProfile;

        return {
          ...currentProfile,
          content: [
            data,
            ...(currentProfile.content || []).filter(
              (item) => `${item.type}-${item._id}` !== `${data.type}-${data._id}`
            ),
          ],
        };
      });
      setCaption("");
      setFeedSearch("");
      setActiveMobileTab(uploadMode === "reel" ? "reels" : "home");
      await fetchFeed();
      setCaptionEmojiOpen(false);
      clearSelectedFile();
      setMessage(`${uploadMode === "reel" ? "Reel" : "Post"} uploaded.`);
      setCreateOpen(false);
    } catch (error) {
      setMessage(error.message || "Upload failed.");
      setUploadProgress(0);
    } finally {
      setUploading(false);
      window.setTimeout(() => setUploadProgress(0), 800);
    }
  };

  const beginPendingAction = (pendingRef, setPendingState, key) => {
    if (!key || pendingRef.current.has(key)) return false;

    pendingRef.current.add(key);
    setPendingState((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    return true;
  };

  const endPendingAction = (pendingRef, setPendingState, key) => {
    pendingRef.current.delete(key);
    setPendingState((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const patchContentItem = (targetItem, updater) => {
    const key = getContentKey(targetItem);
    if (!key) return;

    setFeed((currentFeed) =>
      currentFeed.map((item) =>
        getContentKey(item) === key ? updater(item) : item
      )
    );
    setProfileData((currentProfile) => {
      if (!currentProfile?.content) return currentProfile;

      return {
        ...currentProfile,
        content: currentProfile.content.map((item) =>
          getContentKey(item) === key ? updater(item) : item
        ),
      };
    });
    setSelectedProfileItem((currentItem) =>
      getContentKey(currentItem) === key ? updater(currentItem) : currentItem
    );
  };

  const updateContentItem = (updatedItem) => {
    patchContentItem(updatedItem, () => updatedItem);
  };

  const removeContentItem = (targetItem) => {
    const key = getContentKey(targetItem);
    if (!key) return;

    setFeed((currentFeed) => currentFeed.filter((item) => getContentKey(item) !== key));
    setProfileData((currentProfile) => {
      if (!currentProfile?.content) return currentProfile;

      return {
        ...currentProfile,
        content: currentProfile.content.filter((item) => getContentKey(item) !== key),
      };
    });
    setSelectedProfileItem((currentItem) => (getContentKey(currentItem) === key ? null : currentItem));
  };

  const handleLike = async (item) => {
    if (!userData?._id) return;

    const key = getContentKey(item);
    if (!beginPendingAction(pendingLikeIdsRef, setPendingLikeIds, key)) return;
    setMessage("");

    const wasLiked = item.likes?.some((id) => id.toString() === userData?._id);

    patchContentItem(item, (currentItem) => {
      const currentLikes = currentItem.likes || [];
      const currentlyLiked = currentLikes.some((id) => id.toString() === userData?._id);

      return {
        ...currentItem,
        likes: currentlyLiked
          ? currentLikes.filter((id) => id.toString() !== userData?._id)
          : [...currentLikes, userData?._id],
      };
    });

    try {
      const res = await fetch(apiUrl(`/api/content/${item.type}/${item._id}/like`), {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Like failed");

      updateContentItem(data);
    } catch {
      patchContentItem(item, (currentItem) => {
        const currentLikes = currentItem.likes || [];

        return {
          ...currentItem,
          likes: wasLiked
            ? Array.from(new Set([...currentLikes, userData?._id]))
            : currentLikes.filter((id) => id.toString() !== userData?._id),
        };
      });
      setMessage("Like failed.");
    } finally {
      endPendingAction(pendingLikeIdsRef, setPendingLikeIds, key);
    }
  };

  const handleCommentSubmit = async (event, item) => {
    event.preventDefault();
    if (!userData?._id) return;

    const key = getContentKey(item);
    const text = commentInputs[key]?.trim();
    if (!text || !beginPendingAction(pendingCommentIdsRef, setPendingCommentIds, key)) return;
    setMessage("");

    const tempCommentId = `pending-${key}-${Date.now()}`;
    const optimisticComment = {
      _id: tempCommentId,
      author: userData,
      text,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setCommentInputs((current) => ({ ...current, [key]: "" }));
    setCommentEmojiKey("");
    patchContentItem(item, (currentItem) => ({
      ...currentItem,
      comments: [...(currentItem.comments || []), optimisticComment],
    }));

    try {
      const res = await fetch(apiUrl(`/api/content/${item.type}/${item._id}/comments`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Comment failed");

      updateContentItem(data);
    } catch {
      patchContentItem(item, (currentItem) => ({
        ...currentItem,
        comments: (currentItem.comments || []).filter((comment) => comment._id !== tempCommentId),
      }));
      setCommentInputs((current) => ({ ...current, [key]: text }));
      setMessage("Comment failed.");
    } finally {
      endPendingAction(pendingCommentIdsRef, setPendingCommentIds, key);
    }
  };

  const addEmojiToComment = (item, emoji) => {
    const key = `${item.type}-${item._id}`;
    setCommentInputs((current) => ({
      ...current,
      [key]: `${current[key] || ""}${emoji}`,
    }));
  };

  const handleReplySubmit = async (event, item, comment) => {
    event.preventDefault();
    if (!userData?._id || !comment?._id) return;

    const replyKey = getReplyKey(item, comment._id);
    const text = replyInputs[replyKey]?.trim();
    if (!text || !beginPendingAction(pendingReplyIdsRef, setPendingReplyIds, replyKey)) return;

    const tempReplyId = `pending-${replyKey}-${Date.now()}`;
    const optimisticReply = {
      _id: tempReplyId,
      author: userData,
      text,
      createdAt: new Date().toISOString(),
      pending: true,
    };

    setReplyInputs((current) => ({ ...current, [replyKey]: "" }));
    setActiveReplyKey("");
    patchContentItem(item, (currentItem) => ({
      ...currentItem,
      comments: (currentItem.comments || []).map((currentComment) =>
        currentComment._id === comment._id
          ? {
              ...currentComment,
              replies: [...(currentComment.replies || []), optimisticReply],
            }
          : currentComment
      ),
    }));

    try {
      const res = await fetch(apiUrl(`/api/content/${item.type}/${item._id}/comments/${comment._id}/replies`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reply failed");

      updateContentItem(data);
    } catch (error) {
      patchContentItem(item, (currentItem) => ({
        ...currentItem,
        comments: (currentItem.comments || []).map((currentComment) =>
          currentComment._id === comment._id
            ? {
                ...currentComment,
                replies: (currentComment.replies || []).filter((reply) => reply._id !== tempReplyId),
              }
            : currentComment
        ),
      }));
      setReplyInputs((current) => ({ ...current, [replyKey]: text }));
      setActiveReplyKey(replyKey);
      setMessage(error.message || "Reply failed.");
    } finally {
      endPendingAction(pendingReplyIdsRef, setPendingReplyIds, replyKey);
    }
  };

  const handleDeleteComment = async (item, commentId) => {
    const contentKey = getContentKey(item);
    const deleteKey = `${contentKey}-${commentId}`;
    if (!beginPendingAction(pendingCommentDeleteIdsRef, setPendingCommentDeleteIds, deleteKey)) return;
    setMessage("");

    const comments = item.comments || [];
    const deletedComment = comments.find((comment) => comment._id === commentId);
    const deletedCommentIndex = comments.findIndex((comment) => comment._id === commentId);

    patchContentItem(item, (currentItem) => ({
      ...currentItem,
      comments: (currentItem.comments || []).filter((comment) => comment._id !== commentId),
    }));

    try {
      const res = await fetch(apiUrl(`/api/content/${item.type}/${item._id}/comments/${commentId}`), {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Comment delete failed");

      updateContentItem(data);
    } catch (error) {
      if (deletedComment) {
        patchContentItem(item, (currentItem) => {
          if ((currentItem.comments || []).some((comment) => comment._id === commentId)) return currentItem;

          const nextComments = [...(currentItem.comments || [])];
          nextComments.splice(Math.max(0, deletedCommentIndex), 0, deletedComment);
          return { ...currentItem, comments: nextComments };
        });
      }
      setMessage(error.message || "Comment delete failed.");
    } finally {
      endPendingAction(pendingCommentDeleteIdsRef, setPendingCommentDeleteIds, deleteKey);
    }
  };

  const handleDeleteContent = async (item) => {
    const key = getContentKey(item);
    if (!beginPendingAction(pendingContentDeleteIdsRef, setPendingContentDeleteIds, key)) return;
    setMessage("");

    const feedIndex = feed.findIndex((feedItem) => getContentKey(feedItem) === key);
    const profileContentIndex =
      profileData?.content?.findIndex((profileItem) => getContentKey(profileItem) === key) ?? -1;
    const selectedProfileSnapshot = selectedProfileItem;

    removeContentItem(item);

    try {
      const res = await fetch(apiUrl(`/api/content/${item.type}/${item._id}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Delete failed");

      setMessage(`${item.type === "reel" ? "Reel" : "Post"} deleted.`);
    } catch (error) {
      setFeed((currentFeed) => {
        if (currentFeed.some((feedItem) => getContentKey(feedItem) === key)) return currentFeed;

        const nextFeed = [...currentFeed];
        nextFeed.splice(feedIndex >= 0 ? Math.min(feedIndex, nextFeed.length) : 0, 0, item);
        return nextFeed;
      });
      setProfileData((currentProfile) => {
        if (!currentProfile?.content || profileContentIndex < 0) return currentProfile;
        if (currentProfile.content.some((profileItem) => getContentKey(profileItem) === key)) return currentProfile;

        const nextContent = [...currentProfile.content];
        nextContent.splice(Math.min(profileContentIndex, nextContent.length), 0, item);
        return { ...currentProfile, content: nextContent };
      });
      if (getContentKey(selectedProfileSnapshot) === key) {
        setSelectedProfileItem(selectedProfileSnapshot);
      }
      setMessage(error.message || "Delete failed.");
    } finally {
      endPendingAction(pendingContentDeleteIdsRef, setPendingContentDeleteIds, key);
    }
  };

  const saveConfirmedMobileMessage = (message, tempId) => {
    setMobileMessages((current) => {
      const withoutTemp = tempId
        ? current.filter((item) => item._id !== tempId)
        : current;

      return mergeMessageIntoList(withoutTemp, message);
    });
  };

  const updateMobileMessage = (message) => {
    setMobileMessages((current) =>
      current.map((item) => (item._id === message._id ? message : item))
    );
  };

  const markMobileMessageFailed = (tempId) => {
    setMobileMessages((current) =>
      current.map((message) =>
        message._id === tempId
          ? { ...message, pending: false, failed: true }
          : message
      )
    );
  };

  const markMobileMessagesSeen = (messageIds, readAt) => {
    const seenIds = new Set((messageIds || []).map((id) => id.toString()));

    setMobileMessages((current) =>
      current.map((message) =>
        seenIds.has(message._id?.toString())
          ? { ...message, read: true, readAt }
          : message
      )
    );
  };

  const markMobileMessagesDelivered = (messageIds, deliveredAt) => {
    const deliveredIds = new Set((messageIds || []).map((id) => id.toString()));

    setMobileMessages((current) =>
      current.map((message) =>
        deliveredIds.has(message._id?.toString())
          ? { ...message, delivered: true, deliveredAt }
          : message
      )
    );
  };

  const applyRelationshipUpdate = ({ currentUser, targetUser }, options = {}) => {
    const updatedUsers = [currentUser, targetUser].filter((user) => user?._id);
    const findUpdatedUser = (userId) =>
      updatedUsers.find((user) => isSameId(user._id, userId));

    if (currentUser?._id) {
      dispatch(setUserData(currentUser));
    }

    setProfileData((currentProfile) => {
      const updatedProfileUser = findUpdatedUser(currentProfile?.user?._id);
      if (!updatedProfileUser) return currentProfile;

      return {
        ...currentProfile,
        user: updatedProfileUser,
      };
    });

    setFeedUserResults((currentUsers) =>
      currentUsers.map((user) => findUpdatedUser(user._id) || user)
    );
    setMobileChatUsers((currentUsers) =>
      currentUsers.map((user) => findUpdatedUser(user._id) || user)
    );
    setConnectionsPanel((currentPanel) => {
      const updatedOwner = findUpdatedUser(currentPanel.owner?._id) || currentPanel.owner;
      const removedUserId = options.removeConnectionUserId;

      return {
        ...currentPanel,
        owner: updatedOwner,
        users: currentPanel.users
          .map((user) => findUpdatedUser(user._id) || user)
          .filter((user) => !removedUserId || !isSameId(user._id, removedUserId)),
      };
    });
  };

  const handleMobileFollow = async (targetUser) => {
    setMobileBusyUserId(targetUser._id);
    setMobileChatStatus("");

    try {
      const res = await fetch(apiUrl(`/api/users/${targetUser._id}/follow`), {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Follow failed");

      applyRelationshipUpdate(data, {
        removeConnectionUserId:
          connectionsOwnerIsCurrentUser && connectionsPanel.type === "following" && !data.following
            ? data.targetUser?._id
            : "",
      });
      await fetchMobileChatUsers();
    } catch (error) {
      setMobileChatStatus(error.message || "Follow failed.");
    } finally {
      setMobileBusyUserId("");
    }
  };

  const handleFeedUserFollow = async (targetUser) => {
    setFeedUserBusyId(targetUser._id);
    setMessage("");

    try {
      const res = await fetch(apiUrl(`/api/users/${targetUser._id}/follow`), {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Follow failed");

      applyRelationshipUpdate(data, {
        removeConnectionUserId:
          connectionsOwnerIsCurrentUser && connectionsPanel.type === "following" && !data.following
            ? data.targetUser?._id
            : "",
      });
      await fetchMobileChatUsers();
    } catch (error) {
      setMessage(error.message || "Follow failed.");
    } finally {
      setFeedUserBusyId("");
    }
  };

  const removeMobileSuggestion = (userId) => {
    setHiddenMobileSuggestionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(userId);
      return nextIds;
    });
  };

  const openProfile = useCallback(async (targetUser = userData, options = {}) => {
    const profileId = (targetUser?._id || targetUser || userData?._id)?.toString();
    if (!profileId) return;

    if (!options.fromHistory) {
      if (activeMobileTab === "profile" && selectedProfileId && selectedProfileId !== profileId) {
        setProfileHistory((currentHistory) => [...currentHistory, selectedProfileId]);
      } else if (activeMobileTab !== "profile") {
        setProfileHistory([]);
        setProfileReturnTab(activeMobileTab || "home");
      }
    }

    setActiveMobileTab("profile");
    setSelectedProfileId(profileId);
    setSelectedMobileChat(null);
    setMobileConversationMenuOpen(false);
    setCreateOpen(false);
    setMessage("");
    setProfileStatus("");
    setProfileContentType("all");
    setProfileLoading(true);
    setSelectedProfileItem(null);
    setFocusedNotificationTarget(null);
    setProfileData((currentProfile) =>
      currentProfile?.user?._id === profileId ? currentProfile : null
    );

    requestAnimationFrame(() => {
      document.querySelector("[data-vybe-feed-root]")?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    try {
      const res = await fetch(apiUrl(`/api/users/${profileId}/profile`), {
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Profile failed to load");

      setProfileData(data);
    } catch (error) {
      setProfileStatus(error.message || "Profile failed to load.");
    } finally {
      setProfileLoading(false);
    }
  }, [activeMobileTab, selectedProfileId, userData]);

  const handleProfileBack = useCallback(() => {
    const previousProfileId = profileHistory[profileHistory.length - 1];

    if (previousProfileId) {
      setProfileHistory((currentHistory) => currentHistory.slice(0, -1));
      openProfile(previousProfileId, { fromHistory: true });
      return;
    }

    setActiveMobileTab(profileReturnTab || "home");
    setSelectedProfileId("");
    setProfileData(null);
    setSelectedProfileItem(null);
    setFocusedNotificationTarget(null);
    setProfileStatus("");
    setProfileContentType("all");
  }, [openProfile, profileHistory, profileReturnTab]);

  const closeConnectionsPanel = () => {
    setConnectionsPanel((currentPanel) => ({
      ...currentPanel,
      open: false,
      error: "",
    }));
  };

  const openConnectionsList = useCallback(async ({ user, userId, type = "followers" } = {}) => {
    const connectionType = type === "following" ? "following" : "followers";
    const owner = user || profileData?.user || userData;
    const ownerId = (userId || owner?._id || "").toString();

    if (!ownerId) return;

    setConnectionsPanel({
      open: true,
      type: connectionType,
      owner: owner || { _id: ownerId },
      users: [],
      loading: true,
      error: "",
    });

    try {
      const res = await fetch(apiUrl(`/api/users/${ownerId}/connections?type=${connectionType}`), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Connections failed to load");

      setConnectionsPanel((currentPanel) => ({
        ...currentPanel,
        users: Array.isArray(data.users) ? data.users : [],
        loading: false,
        error: "",
      }));
    } catch (error) {
      setConnectionsPanel((currentPanel) => ({
        ...currentPanel,
        loading: false,
        error: error.message || "Connections failed to load.",
      }));
    }
  }, [profileData?.user, userData]);

  const handleProfileFollow = async () => {
    const profileUser = profileData?.user;
    if (!profileUser?._id || profileUser._id === userData?._id) return;

    setProfileBusy(true);
    setProfileStatus("");

    try {
      const res = await fetch(apiUrl(`/api/users/${profileUser._id}/follow`), {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Follow failed");

      applyRelationshipUpdate(data, {
        removeConnectionUserId:
          connectionsOwnerIsCurrentUser && connectionsPanel.type === "following" && !data.following
            ? data.targetUser?._id
            : "",
      });
    } catch (error) {
      setProfileStatus(error.message || "Follow failed.");
    } finally {
      setProfileBusy(false);
    }
  };

  const handleConnectionFollow = async (targetUser) => {
    if (!targetUser?._id || targetUser._id === userData?._id) return;

    setConnectionsBusyUserId(targetUser._id);

    try {
      const res = await fetch(apiUrl(`/api/users/${targetUser._id}/follow`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Follow failed");

      applyRelationshipUpdate(data, {
        removeConnectionUserId:
          connectionsOwnerIsCurrentUser && connectionsPanel.type === "following" && !data.following
            ? data.targetUser?._id
            : "",
      });
      await fetchMobileChatUsers();
    } catch (error) {
      setConnectionsPanel((currentPanel) => ({
        ...currentPanel,
        error: error.message || "Follow failed.",
      }));
    } finally {
      setConnectionsBusyUserId("");
    }
  };

  const handleRemoveFollower = async (targetUser) => {
    if (!targetUser?._id || targetUser._id === userData?._id) return;

    setConnectionsBusyUserId(targetUser._id);

    try {
      const res = await fetch(apiUrl(`/api/users/${targetUser._id}/follower`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Remove failed");

      applyRelationshipUpdate(data, {
        removeConnectionUserId: data.targetUser?._id || targetUser._id,
      });
      await fetchMobileChatUsers();
    } catch (error) {
      setConnectionsPanel((currentPanel) => ({
        ...currentPanel,
        error: error.message || "Remove failed.",
      }));
    } finally {
      setConnectionsBusyUserId("");
    }
  };

  useEffect(() => {
    const handleOpenProfile = (event) => {
      openProfile(event.detail?.user || event.detail?.userId);
    };

    window.addEventListener("vybe:open-profile", handleOpenProfile);
    return () => window.removeEventListener("vybe:open-profile", handleOpenProfile);
  }, [openProfile]);

  useEffect(() => {
    const handleOpenConnections = (event) => {
      openConnectionsList(event.detail || {});
    };

    window.addEventListener("vybe:open-profile-connections", handleOpenConnections);
    return () => window.removeEventListener("vybe:open-profile-connections", handleOpenConnections);
  }, [openConnectionsList]);

  useEffect(() => {
    const handleOpenSharedContent = (event) => {
      const sharedItem = event.detail?.item || sharedContentToFeedItem(event.detail?.sharedContent);
      if (sharedItem) {
        setSelectedProfileItem(sharedItem);
      }
    };

    const handleShareContent = (event) => {
      const sharedItem = event.detail?.item || sharedContentToFeedItem(event.detail?.sharedContent);
      if (sharedItem && ["post", "reel"].includes(sharedItem.type)) {
        setShareItem(sharedItem);
        setShareSearch("");
        setShareStatus("");
        setShareUsers([]);
        fetchMobileChatUsers();
      }
    };

    window.addEventListener("vybe:open-shared-content", handleOpenSharedContent);
    window.addEventListener("vybe:share-content", handleShareContent);
    return () => {
      window.removeEventListener("vybe:open-shared-content", handleOpenSharedContent);
      window.removeEventListener("vybe:share-content", handleShareContent);
    };
  }, []);

  const openMobileChat = async (user) => {
    const chatUser = { ...user, unreadCount: 0 };
    setSelectedMobileChat(chatUser);
    selectedMobileChatRef.current = chatUser;
    setMobileChatUsers((currentUsers) =>
      currentUsers.map((currentUser) =>
        currentUser._id === user._id ? { ...currentUser, unreadCount: 0 } : currentUser
      )
    );
    setMobileMessages([]);
    setMobileChatStatus("");
    setMobileConversationMenuOpen(false);
    setMobileChatEmojiOpen(false);
    setMobileMessageMedia([]);
    await fetchMobileMessages(user._id);
    fetchMobileChatUsers();
  };

  const openShareSheet = (item) => {
    if (!item || !["post", "reel"].includes(item.type)) {
      setMessage("This content cannot be shared.");
      return;
    }

    setShareItem(item);
    setShareSearch("");
    setShareStatus("");
    setShareUsers([]);
    fetchMobileChatUsers();
  };

  const shareContentToUser = async (targetUser) => {
    if (!shareItem?._id || !targetUser?._id || sharingUserId) return;
    const shareType = getContentTypeLabel(shareItem);

    setSharingUserId(targetUser._id);
    setShareStatus("");

    try {
      const { res, data } = await fetchJsonWithTimeout(
        apiUrl(`/api/chat/${targetUser._id}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            text: `Shared a ${shareType}`,
            sharedContent: {
              type: shareItem.type,
              id: shareItem._id,
            },
          }),
        },
        "Share is taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "Share failed");

      setShareStatus(`Shared to ${targetUser.userName}.`);
      await fetchMobileChatUsers();
      window.setTimeout(() => {
        setShareItem(null);
        setShareStatus("");
      }, 900);
    } catch (error) {
      setShareStatus(error.message || "Share failed.");
    } finally {
      setSharingUserId("");
    }
  };

  const submitMobileMessage = async () => {
    const text = mobileMessageText.trim();
    const mediaPayload = mobileMessageMedia;
    const replyTarget = mobileReplyToMessage;
    if ((!text && mediaPayload.length === 0) || !selectedMobileChat) return;

    mobileKeepKeyboardAfterSendRef.current = true;
    focusMobileMessageInput();
    window.setTimeout(() => {
      mobileKeepKeyboardAfterSendRef.current = false;
    }, 700);

    const receiver = selectedMobileChat;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempId = `temp-${clientId}`;
    const optimisticMessage = {
      _id: tempId,
      clientId,
      sender: userData,
      receiver,
      text,
      media: mediaPayload[0]?.media,
      mediaType: mediaPayload[0]?.mediaType,
      attachments: mediaPayload.map(({ media, mediaType }) => ({ media, mediaType })),
      replyTo: replyTarget ? createMessageReplySnapshot(replyTarget) : undefined,
      connectionStatus: receiver.pendingConnection ? "pending" : "connected",
      pending: true,
      createdAt: new Date().toISOString(),
    };

    setMobileMessages((current) => [...current, optimisticMessage]);
    syncMobileChatUserFromMessage(optimisticMessage);
    setMobileMessageText("");
    setMobileMessageMedia([]);
    setMobileReplyToMessage(null);
    setMobileMessageMenuId("");
    setAiReplySuggestions([]);
    setMobileChatStatus("");
    stopMobileOutgoingTyping(receiver._id);
    focusMobileMessageInput();

    try {
      if (mediaPayload.length > 0) {
        setMobileChatStatus("Uploading media...");
      }

      const uploadedAttachments = await Promise.all(
        mediaPayload.map((attachment) => uploadChatAttachment(attachment))
      );

      const { res, data } = await fetchJsonWithTimeout(
        apiUrl(`/api/chat/${receiver._id}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            text,
            clientId,
            attachments: uploadedAttachments,
            replyToMessageId: replyTarget?._id,
          }),
        },
        "Message is taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "Message failed");

      saveConfirmedMobileMessage(data, tempId);
      syncMobileChatUserFromMessage(data);
      if (data.connectionStatus === "pending") {
        setSelectedMobileChat((current) =>
          current && isSameId(current._id, receiver._id)
            ? { ...current, pendingConnection: true }
            : current
        );
      }
      setMobileChatEmojiOpen(false);
      setMobileChatStatus("");
      focusMobileMessageInput();
    } catch (error) {
      markMobileMessageFailed(tempId);
      setMobileChatStatus(error.message || "Message failed.");
      setMobileMessageText(text);
      setMobileMessageMedia(mediaPayload);
      setMobileReplyToMessage(replyTarget);
      fetchMobileChatUsers();
      focusMobileMessageInput();
    }
  };

  const sendMobileMessage = (event) => {
    event.preventDefault();
    void submitMobileMessage();
  };

  const handleMobileSendPointerDown = (event) => {
    if (!mobileMessageText.trim() && mobileMessageMedia.length === 0) return;

    event.preventDefault();
    mobileSendPointerHandledRef.current = true;
    window.setTimeout(() => {
      mobileSendPointerHandledRef.current = false;
    }, 500);
    void submitMobileMessage();
  };

  const handleMobileSendClick = () => {
    if (mobileSendPointerHandledRef.current) return;
    void submitMobileMessage();
  };

  const clearMobileMessageHold = () => {
    if (mobileMessageHoldRef.current.timer) {
      window.clearTimeout(mobileMessageHoldRef.current.timer);
      mobileMessageHoldRef.current.timer = null;
    }
  };

  const openMobileMessageActions = (chatMessage) => {
    if (chatMessage.pending || chatMessage.failed) return;
    clearMobileMessageHold();
    setMobileMessageMenuId(chatMessage._id);
  };

  const startMobileMessageHold = (event, chatMessage) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button,a,input,video")) return;
    if (chatMessage.pending || chatMessage.failed) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearMobileMessageHold();
    mobileMessageHoldRef.current.x = event.clientX;
    mobileMessageHoldRef.current.y = event.clientY;
    mobileMessageHoldRef.current.timer = window.setTimeout(() => {
      openMobileMessageActions(chatMessage);
    }, 420);
  };

  const moveMobileMessageHold = (event) => {
    const hold = mobileMessageHoldRef.current;
    if (!hold.timer) return;

    const movedX = Math.abs(event.clientX - hold.x);
    const movedY = Math.abs(event.clientY - hold.y);
    if (movedX > 10 || movedY > 10) {
      clearMobileMessageHold();
    }
  };

  const clearMobileChatListHold = () => {
    if (mobileChatListHoldRef.current.timer) {
      window.clearTimeout(mobileChatListHoldRef.current.timer);
      mobileChatListHoldRef.current.timer = null;
    }
  };

  const openMobileChatListActions = (chatUser) => {
    if (!chatUser?._id) return;
    clearMobileChatListHold();
    mobileChatListHoldRef.current.suppressClickUntil = Date.now() + 700;
    setMobileChatListMenuUserId(chatUser._id);
  };

  const startMobileChatListHold = (event, chatUser) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-mobile-chat-direct-action],input")) {
      return;
    }
    if (!chatUser?._id) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearMobileChatListHold();
    mobileChatListHoldRef.current.x = event.clientX;
    mobileChatListHoldRef.current.y = event.clientY;
    mobileChatListHoldRef.current.timer = window.setTimeout(() => {
      openMobileChatListActions(chatUser);
    }, 420);
  };

  const moveMobileChatListHold = (event) => {
    const hold = mobileChatListHoldRef.current;
    if (!hold.timer) return;

    const movedX = Math.abs(event.clientX - hold.x);
    const movedY = Math.abs(event.clientY - hold.y);
    if (movedX > 10 || movedY > 10) {
      clearMobileChatListHold();
    }
  };

  const shouldSkipMobileChatListClick = () => {
    if (Date.now() < mobileChatListHoldRef.current.suppressClickUntil) {
      mobileChatListHoldRef.current.suppressClickUntil = 0;
      return true;
    }

    return false;
  };

  const deleteMobileMessage = async (messageId, scope = "me") => {
    try {
      const res = await fetch(apiUrl(`/api/chat/messages/${messageId}?scope=${scope}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Delete failed");

      setMobileMessages((current) => current.filter((item) => item._id !== messageId));
      setMobileReplyToMessage((current) => (current?._id === messageId ? null : current));
      setMobileMessageMenuId("");
      setMobileChatStatus(scope === "everyone" ? "Message deleted for everyone." : "Message deleted for you.");
      await fetchMobileChatUsers();
    } catch (error) {
      setMobileChatStatus(error.message || "Delete failed.");
    }
  };

  const reactToMobileMessage = async (messageId, emoji) => {
    if (!messageId || messageId.startsWith("temp-")) return;

    setMobileMessageMenuId("");

    try {
      const res = await fetch(apiUrl(`/api/chat/messages/${messageId}/reactions`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Reaction failed");

      updateMobileMessage(data);
    } catch (error) {
      setMobileChatStatus(error.message || "Reaction failed.");
    }
  };

  const deleteMobileConversation = async (userId) => {
    try {
      const res = await fetch(apiUrl(`/api/chat/conversation/${userId}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Delete failed");

      setMobileChatUsers((currentUsers) =>
        currentUsers.filter((chatUser) => !isSameId(chatUser._id, userId))
      );
      if (isSameId(selectedMobileChat?._id, userId)) {
        setMobileMessages([]);
        setSelectedMobileChat(null);
        selectedMobileChatRef.current = null;
      }
      setMobileConversationMenuOpen(false);
      setMobileChatListMenuUserId("");
      setMobileChatStatus("Conversation deleted.");
      await fetchMobileChatUsers();
      setMobileChatUsers((currentUsers) =>
        currentUsers.filter((chatUser) => !isSameId(chatUser._id, userId))
      );
    } catch (error) {
      setMobileChatStatus(error.message || "Delete failed.");
    }
  };

  const markNotificationsRead = async () => {
    setNotificationsOpen((open) => !open);
    if (notificationsOpen) return;

    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    await fetch(apiUrl("/api/content/notifications/read"), {
      method: "PATCH",
      credentials: "include",
    });
  };

  const deleteNotification = async (notificationId) => {
    if (!notificationId || deletingNotificationIds.has(notificationId)) return;

    setDeletingNotificationIds((current) => {
      const next = new Set(current);
      next.add(notificationId);
      return next;
    });

    try {
      const res = await fetch(apiUrl(`/api/content/notifications/${notificationId}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) throw new Error("Delete failed");
      setNotifications((current) =>
        current.filter((notification) => notification._id !== notificationId)
      );
    } catch {
      setMessage("Unable to delete notification.");
    } finally {
      setDeletingNotificationIds((current) => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
    }
  };

  const resolveNotificationCommentTarget = (notification, item) => {
    let commentId = getIdString(notification?.commentId);
    let replyId = getIdString(notification?.replyId);
    const actorId = getIdString(notification?.actor);
    const notificationText = notification?.text || "";

    if ((!commentId || (notification?.type === "reply" && !replyId)) && item?.comments?.length) {
      for (const comment of item.comments) {
        if (
          notification?.type === "comment" &&
          getIdString(comment.author) === actorId &&
          comment.text === notificationText
        ) {
          commentId = getIdString(comment._id);
          break;
        }

        const matchingReply = (comment.replies || []).find(
          (reply) =>
            getIdString(reply.author) === actorId &&
            reply.text === notificationText
        );

        if (notification?.type === "reply" && matchingReply) {
          commentId = getIdString(comment._id);
          replyId = getIdString(matchingReply._id);
          break;
        }
      }
    }

    return { commentId, replyId };
  };

  const handleNotificationOpen = async (notification) => {
    setNotificationsOpen(false);

    const contentType = notification?.contentType;
    const contentId = getIdString(notification?.contentId);
    if (!["post", "reel"].includes(contentType) || !contentId) {
      if (notification?.actor) openProfile(notification.actor);
      return;
    }

    const contentKey = `${contentType}-${contentId}`;
    const knownItems = [
      selectedProfileItem,
      ...feed,
      ...(profileData?.content || []),
    ].filter(Boolean);
    let targetItem = knownItems.find((item) => getContentKey(item) === contentKey);

    if (!targetItem) {
      try {
        const res = await fetch(apiUrl(`/api/content/${contentType}/${contentId}`), {
          credentials: "include",
          headers: getTabAuthHeaders(),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.message || "Unable to open notification");

        targetItem = data;
        setFeed((currentFeed) =>
          currentFeed.some((item) => getContentKey(item) === contentKey)
            ? currentFeed.map((item) => (getContentKey(item) === contentKey ? data : item))
            : [data, ...currentFeed]
        );
      } catch (error) {
        setMessage(error.message || "This post is no longer available.");
        return;
      }
    }

    setActiveMobileTab("home");
    setSelectedMobileChat(null);
    setCreateOpen(false);
    setProfileItemMenuOpen(false);
    setSelectedProfileItem(targetItem);
    const { commentId, replyId } = resolveNotificationCommentTarget(notification, targetItem);
    setFocusedNotificationTarget({
      contentKey,
      commentId,
      replyId,
    });
  };

  const unreadCount = notifications.filter((item) => !item.read).length;
  const baseVisibleFeed = activeMobileTab === "reels"
    ? feed.filter((item) => item.type === "reel")
    : feed;
  const normalizedFeedSearch = activeMobileTab === "search" ? feedSearch.trim().toLowerCase() : "";
  const normalizedFeedSearchId = normalizedFeedSearch.replace(/^@/, "");
  const visibleFeed = normalizedFeedSearch
    ? baseVisibleFeed.filter((item) =>
        [
          item.author?._id,
          item.caption,
          item.author?.userName,
          item.author?.userName ? `@${item.author.userName}` : "",
          item.author?.name,
          item.type,
          ...(item.comments || []).map((comment) => comment.text),
          ...(item.comments || []).map((comment) => comment.author?._id),
          ...(item.comments || []).map((comment) => comment.author?.userName),
          ...(item.comments || []).map((comment) =>
            comment.author?.userName ? `@${comment.author.userName}` : ""
          ),
          ...(item.comments || []).flatMap((comment) =>
            (comment.replies || []).map((reply) => reply.text)
          ),
          ...(item.comments || []).flatMap((comment) =>
            (comment.replies || []).map((reply) => reply.author?._id)
          ),
          ...(item.comments || []).flatMap((comment) =>
            (comment.replies || []).map((reply) => reply.author?.userName)
          ),
          ...(item.comments || []).flatMap((comment) =>
            (comment.replies || []).map((reply) =>
              reply.author?.userName ? `@${reply.author.userName}` : ""
            )
          ),
        ]
          .filter(Boolean)
          .some((value) => {
            const lowerValue = value.toLowerCase();
            return (
              lowerValue.includes(normalizedFeedSearch) ||
              lowerValue.includes(normalizedFeedSearchId)
            );
          })
      )
    : baseVisibleFeed;
  const normalizedMobileChatSearch = mobileChatSearch.trim().toLowerCase();
  const localMobileChatMatches = normalizedMobileChatSearch
    ? mobileChatUsers.filter((chatUser) =>
        [chatUser.userName, chatUser.name]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedMobileChatSearch))
      )
    : mobileChatUsers;
  const visibleMobileChatUsers = normalizedMobileChatSearch
    ? [...localMobileChatMatches, ...mobileChatSearchResults].reduce((users, chatUser) => {
        if (!chatUser?._id || users.some((item) => item._id === chatUser._id)) return users;
        users.push(chatUser);
        return users;
      }, [])
    : mobileChatUsers;
  const shareCandidateMap = new Map();
  shareUsers.forEach((candidate) => {
    if (!candidate?._id || candidate._id === userData?._id) return;
    shareCandidateMap.set(candidate._id, {
      ...shareCandidateMap.get(candidate._id),
      ...candidate,
    });
  });
  const normalizedShareSearch = shareSearch.trim().toLowerCase();
  const visibleShareUsers = [...shareCandidateMap.values()]
    .filter((candidate) =>
      normalizedShareSearch
        ? [candidate.userName, candidate.name]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedShareSearch))
        : true
    )
    .slice(0, 20);
  const totalMobileUnreadCount = mobileChatUsers.reduce(
    (total, chatUser) =>
      total + (selectedMobileChat?._id === chatUser._id ? 0 : chatUser.unreadCount || 0),
    0
  );
  const activeMobileChatListUser = mobileChatListMenuUserId
    ? visibleMobileChatUsers.find((chatUser) => chatUser._id === mobileChatListMenuUserId) ||
      mobileChatUsers.find((chatUser) => chatUser._id === mobileChatListMenuUserId) ||
      mobileChatSearchResults.find((chatUser) => chatUser._id === mobileChatListMenuUserId)
    : null;
  const activeProfileUser = profileData?.user;
  const activeProfileContent = profileData?.content || [];
  const visibleProfileContent = profileContentType === "all"
    ? activeProfileContent
    : activeProfileContent.filter((item) => item.type === profileContentType);
  const profilePostCount = activeProfileContent.filter((item) => item.type === "post").length;
  const profileReelCount = activeProfileContent.filter((item) => item.type === "reel").length;
  const viewingOwnProfile = activeProfileUser?._id === userData?._id;
  const selectedProfileItemKey = getContentKey(selectedProfileItem);
  const selectedProfileItemIsTextPost =
    isTextPost(selectedProfileItem) || brokenMediaKeys.has(selectedProfileItemKey);
  const selectedProfileItemIsOwn = isSameId(selectedProfileItem?.author?._id, userData?._id);
  const selectedProfileItemDeletePending = pendingContentDeleteIds.has(selectedProfileItemKey);
  const profileIsFollowing = activeProfileUser?._id
    ? mobileFollowingIds.has(activeProfileUser._id)
    : false;
  const profileFollowsMe = activeProfileUser?._id
    ? mobileFollowerIds.has(activeProfileUser._id)
    : false;
  const profileTitle =
    activeMobileTab === "profile"
      ? activeProfileUser?.userName || (selectedProfileId ? "Profile" : "Profile")
      : "";
  const selectedStoryAuthorId = selectedStory ? getStoryAuthorId(selectedStory) : "";
  const selectedStoryGroup = selectedStoryAuthorId
    ? storyGroups.find((group) => group.authorId === selectedStoryAuthorId)
    : null;
  const selectedStoryGroupIndex = selectedStoryGroup?.stories?.findIndex(
    (story) => story._id === selectedStory?._id
  ) ?? -1;
  const selectedStoryStack =
    selectedStoryGroup?.stories?.length && selectedStoryGroupIndex >= 0
      ? selectedStoryGroup.stories
      : selectedStory
        ? [selectedStory]
        : [];
  const selectedStoryIndexInStack = selectedStoryGroupIndex >= 0 ? selectedStoryGroupIndex : 0;
  const selectedStoryProgress = selectedStory
    ? getStoryViewProgressPercent(storyViewStartedAt, storyViewerClock)
    : 0;
  const selectedStoryLiked = selectedStory
    ? likedStoryIds.has(selectedStory._id)
    : false;
  const isMobileReelFeed = isMobile && activeMobileTab === "reels";
  const isMobileChatTab = isMobile && activeMobileTab === "chat";
  const activeMobileActionMessage = mobileMessageMenuId
    ? mobileMessages.find((chatMessage) => chatMessage._id === mobileMessageMenuId)
    : null;
  const activeMobileActionMine =
    isSameId(getMessageSenderId(activeMobileActionMessage), userData?._id);
  const canShareCreate =
    mode === "reel" ? Boolean(selectedFile && selectedMediaType === "video") : Boolean(selectedFile || caption.trim());

  const renderCommentThread = (item, comment, options = {}) => {
    const contentKey = getContentKey(item);
    const replyKey = getReplyKey(item, comment._id);
    const replyPending = pendingReplyIds.has(replyKey);
    const commentDeleteKey = `${contentKey}-${comment._id}`;
    const commentDeleting = pendingCommentDeleteIds.has(commentDeleteKey);
    const commentId = getIdString(comment._id);
    const focusedTargetMatchesContent = focusedNotificationTarget?.contentKey === contentKey;
    const focusedComment =
      focusedTargetMatchesContent &&
      focusedNotificationTarget?.commentId === commentId &&
      !focusedNotificationTarget?.replyId;
    const replies = comment.replies || [];
    const replyLimit = options.replyLimit || 1;
    const targetReplyId = focusedTargetMatchesContent ? focusedNotificationTarget?.replyId : "";
    const visibleReplies = targetReplyId
      ? replies.filter(
          (reply, index) =>
            index >= replies.length - replyLimit || getIdString(reply._id) === targetReplyId
        )
      : replies.slice(-replyLimit);
    const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);
    const canDeleteComment =
      comment.author?._id === userData?._id || item.author?._id === userData?._id;

    return (
      <div
        key={comment._id || `${comment.author?._id}-${comment.createdAt}`}
        data-vybe-comment-id={commentId || undefined}
        className={`group rounded-md text-sm transition-colors ${
          focusedComment ? "bg-blue-600/15 ring-1 ring-blue-500/40 px-2 py-2" : ""
        } ${comment.pending || commentDeleting ? "opacity-70" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p>
              <span className="mr-2 inline-flex max-w-full items-center gap-1 align-bottom text-white font-semibold">
                <span className="truncate">{comment.author?.userName || "user"}</span>
                {comment.author?.isVerified ? <VerifiedBadge /> : null}
              </span>
              <span className="text-gray-300 break-words">{comment.text}</span>
              {comment.pending ? (
                <span className="ml-2 text-xs text-gray-500">Posting...</span>
              ) : null}
            </p>

            {!comment.pending && comment._id ? (
              <button
                type="button"
                onClick={() =>
                  setActiveReplyKey((currentKey) => (currentKey === replyKey ? "" : replyKey))
                }
                className="mt-1 text-xs font-semibold text-gray-500 hover:text-white"
              >
                Reply
              </button>
            ) : null}
          </div>

          {canDeleteComment && !comment.pending ? (
            <button
              type="button"
              onClick={() => handleDeleteComment(item, comment._id)}
              disabled={commentDeleting}
              className="mt-0.5 w-7 h-7 rounded-full text-gray-500 hover:text-red-400 hover:bg-[#111] flex items-center justify-center disabled:opacity-40"
              aria-label="Delete comment"
            >
              <FiTrash2 />
            </button>
          ) : null}
        </div>

        {visibleReplies.length > 0 ? (
          <div className="mt-2 ml-5 border-l border-gray-900 pl-3 flex flex-col gap-1.5">
            {hiddenReplyCount > 0 ? (
              <p className="text-xs text-gray-600">
                {hiddenReplyCount} older {hiddenReplyCount === 1 ? "reply" : "replies"}
              </p>
            ) : null}
            {visibleReplies.map((reply) => {
              const replyId = getIdString(reply._id);
              const focusedReply =
                focusedTargetMatchesContent && focusedNotificationTarget?.replyId === replyId;

              return (
                <p
                  key={reply._id || `${reply.author?._id}-${reply.createdAt}`}
                  data-vybe-reply-id={replyId || undefined}
                  className={`rounded-md text-xs transition-colors ${
                    focusedReply ? "bg-blue-600/15 ring-1 ring-blue-500/40 px-2 py-1" : ""
                  } ${reply.pending ? "opacity-70" : ""}`}
                >
                  <span className="mr-2 inline-flex max-w-full items-center gap-1 align-bottom font-semibold text-gray-200">
                    <span className="truncate">{reply.author?.userName || "user"}</span>
                    {reply.author?.isVerified ? <VerifiedBadge className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="text-gray-400 break-words">{reply.text}</span>
                  {reply.pending ? <span className="ml-2 text-gray-600">Sending...</span> : null}
                </p>
              );
            })}
          </div>
        ) : null}

        {activeReplyKey === replyKey ? (
          <form onSubmit={(event) => handleReplySubmit(event, item, comment)} className="mt-2 ml-5 flex items-center gap-2">
            <input
              value={replyInputs[replyKey] || ""}
              onChange={(event) =>
                setReplyInputs((current) => ({ ...current, [replyKey]: event.target.value }))
              }
              placeholder={`Reply to ${comment.author?.userName || "user"}...`}
              disabled={replyPending}
              className="min-w-0 flex-1 h-9 rounded-md bg-[#101010] px-3 text-xs text-white outline-none placeholder:text-gray-600 disabled:opacity-60"
              maxLength={500}
            />
            <button
              type="submit"
              disabled={!replyInputs[replyKey]?.trim() || replyPending}
              className="h-9 px-3 rounded-md text-xs font-semibold text-blue-500 disabled:text-gray-600"
            >
              {replyPending ? "Sending" : "Reply"}
            </button>
          </form>
        ) : null}
      </div>
    );
  };

  const renderCommentComposer = (item) => {
    const contentKey = getContentKey(item);
    const commentPending = pendingCommentIds.has(contentKey);

    return (
      <form onSubmit={(event) => handleCommentSubmit(event, item)} className="relative mt-4 flex items-center gap-2">
        {commentEmojiKey === contentKey ? (
          <div className="absolute bottom-12 left-0 z-10 grid grid-cols-6 gap-1 rounded-lg border border-gray-800 bg-[#080808] p-2 shadow-2xl">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => addEmojiToComment(item, emoji)}
                className="w-8 h-8 rounded-md text-lg hover:bg-[#151515]"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() =>
            setCommentEmojiKey((openKey) => (openKey === contentKey ? "" : contentKey))
          }
          disabled={commentPending}
          className="w-10 h-10 rounded-md bg-[#101010] text-gray-400 hover:text-white flex items-center justify-center disabled:opacity-60"
          aria-label="Add emoji to comment"
        >
          <FiSmile />
        </button>
        <input
          value={commentInputs[contentKey] || ""}
          onChange={(event) =>
            setCommentInputs((current) => ({
              ...current,
              [contentKey]: event.target.value,
            }))
          }
          placeholder="Add a comment..."
          disabled={commentPending}
          className="min-w-0 flex-1 h-10 bg-[#101010] rounded-md px-3 text-sm text-white outline-none placeholder:text-gray-600 disabled:opacity-60"
          maxLength={500}
        />
        <button
          type="submit"
          className="h-10 px-3 rounded-md text-blue-500 font-semibold disabled:text-gray-600"
          disabled={!commentInputs[contentKey]?.trim() || commentPending}
        >
          {commentPending ? "Posting" : "Post"}
        </button>
      </form>
    );
  };

  const renderSharedContentCard = (chatMessage) => {
    const sharedItem = sharedContentToFeedItem(chatMessage.sharedContent);
    if (!sharedItem) return null;
    const sharedTypeLabel = getContentTypeLabel(sharedItem);

    return (
      <div className="mt-2 w-64 max-w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 text-left">
        <button
          type="button"
          onClick={() => setSelectedProfileItem(sharedItem)}
          className="block w-full text-left"
        >
          <div className="flex gap-3 p-2">
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-black">
              {sharedItem.mediaType === "video" && sharedItem.media ? (
                <video src={mediaUrl(sharedItem.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : sharedItem.mediaType === "image" && sharedItem.media ? (
                <img src={mediaUrl(sharedItem.media)} alt="Shared media" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#101010] px-2">
                  <span className="line-clamp-3 text-center text-[10px] font-semibold leading-tight text-white/80">
                    {sharedItem.caption || "Text post"}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <p className="text-xs font-semibold text-white">Shared {sharedTypeLabel}</p>
              <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-white/70">
                <span className="truncate">@{sharedItem.author?.userName || "vybe_user"}</span>
                {sharedItem.author?.isVerified ? <VerifiedBadge className="h-3.5 w-3.5" /> : null}
              </p>
              {sharedItem.caption ? (
                <p className="mt-1 truncate text-xs text-white/60">{sharedItem.caption}</p>
              ) : null}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => openShareSheet(sharedItem)}
          className="flex h-9 w-full items-center justify-center gap-2 border-t border-white/10 text-xs font-semibold text-blue-300"
        >
          <FiSend /> Share
        </button>
      </div>
    );
  };

  const renderChatReplyPreview = (chatMessage) => {
    const reply = chatMessage.replyTo;
    if (!reply?.messageId) return null;

    const replyMine = reply.sender?._id === userData?._id;
    const authorLabel = replyMine ? "You" : reply.sender?.userName || "user";

    return (
      <div className="mb-2 max-w-full rounded-lg border-l-2 border-white/50 bg-black/20 px-2 py-1 text-left">
        <p className="text-[11px] font-semibold text-white/80">{authorLabel}</p>
        <p className="truncate text-[11px] text-white/60">{getReplyPreviewText(reply)}</p>
      </div>
    );
  };

  const renderChatMessageMedia = (chatMessage) => {
    const attachments = getMessageAttachments(chatMessage);
    if (attachments.length === 0) return null;

    const visibleAttachments = attachments.slice(0, 4);
    const hasMultiple = attachments.length > 1;

    return (
      <div
        className={`mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-lg shadow-black/20 ${
          hasMultiple ? "grid grid-cols-2 gap-0.5" : ""
        }`}
      >
        {visibleAttachments.map((attachment, index) => {
          const tileClass = getChatMediaTileClass(attachments.length, index);
          const mediaClass = hasMultiple
            ? "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            : "max-h-72 w-full object-contain";

          return (
            <button
              key={`attachment-${index}`}
              type="button"
              onClick={() => setChatMediaViewer({ attachments, index })}
              className={`group relative block w-full overflow-hidden bg-[#080808] ${
                hasMultiple ? tileClass : ""
              }`}
              aria-label={attachment.mediaType === "video" ? "Open video" : "Open photo"}
            >
              {attachment.mediaType === "video" ? (
                <>
                  <video
                    src={mediaUrl(attachment.media)}
                    muted
                    playsInline
                    preload="metadata"
                    className={`pointer-events-none ${mediaClass}`}
                  />
                  <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                    <FiVideo />
                  </span>
                </>
              ) : (
                <img
                  src={mediaUrl(attachment.media)}
                  alt="Chat media"
                  className={mediaClass}
                />
              )}
              {attachments.length > 4 && index === 3 ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xl font-bold text-white">
                  +{attachments.length - 4}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  };

  const renderChatMessageReactions = (chatMessage) => {
    const reactions = chatMessage.reactions || [];
    if (reactions.length === 0) return null;

    const reactionCounts = reactions.reduce((counts, reaction) => {
      counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
      return counts;
    }, new Map());

    const myReaction = reactions.find((reaction) => {
      const reactionUserId = reaction.user?._id || reaction.user;
      return reactionUserId === userData?._id;
    });

    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {[...reactionCounts.entries()].map(([emoji, count]) => (
          <button
            key={emoji}
            type="button"
            onClick={() => reactToMobileMessage(chatMessage._id, emoji)}
            className={`h-6 rounded-full border px-2 text-xs ${
              myReaction?.emoji === emoji
                ? "border-white/80 bg-white/20 text-white"
                : "border-white/10 bg-black/20 text-white/80"
            }`}
          >
            {emoji} {count > 1 ? count : ""}
          </button>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (!isMobileChatTab) {
      setMobileChatViewportHeight(0);
      setMobileKeyboardOpen(false);
      return undefined;
    }

    const viewport = window.visualViewport;
    const updateViewport = () => {
      const height = Math.round(viewport?.height || window.innerHeight || 0);
      const keyboardHeight = viewport
        ? window.innerHeight - viewport.height - viewport.offsetTop
        : 0;

      setMobileChatViewportHeight(height);
      setMobileKeyboardOpen(keyboardHeight > 120);
    };

    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [isMobileChatTab]);

  useEffect(() => {
    const root = feedRootRef.current;
    if (!root) return undefined;

    const videos = Array.from(root.querySelectorAll("video[data-feed-video]"));
    if (videos.length === 0 || !["home", "reels"].includes(activeMobileTab)) {
      videos.forEach((video) => video.pause());
      return undefined;
    }

    let animationFrame = 0;
    const scrollTarget = isMobileReelFeed || !isMobile ? root : window;

    const pauseVideo = (video) => {
      if (!video.paused) {
        video.pause();
      }
    };

    const playVideo = (video) => {
      video.muted = feedVideosMutedRef.current;
      video.playsInline = true;
      const playPromise = video.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {});
      }
    };

    const playMostVisibleVideo = () => {
      let bestVideo = null;
      let bestScore = 0;

      videos.forEach((video) => {
        const rect = video.getBoundingClientRect();
        const visibleWidth = Math.max(
          0,
          Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
        );
        const visibleHeight = Math.max(
          0,
          Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
        );
        const score = (visibleWidth * visibleHeight) / Math.max(1, rect.width * rect.height);

        if (score > bestScore) {
          bestScore = score;
          bestVideo = video;
        }
      });

      videos.forEach((video) => {
        if (video === bestVideo && bestScore >= 0.35 && document.visibilityState === "visible") {
          playVideo(video);
        } else {
          pauseVideo(video);
        }
      });
    };

    const schedulePlaybackCheck = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(playMostVisibleVideo);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        videos.forEach(pauseVideo);
        return;
      }

      schedulePlaybackCheck();
    };

    schedulePlaybackCheck();
    scrollTarget.addEventListener("scroll", schedulePlaybackCheck, { passive: true });
    window.addEventListener("resize", schedulePlaybackCheck);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      scrollTarget.removeEventListener("scroll", schedulePlaybackCheck);
      window.removeEventListener("resize", schedulePlaybackCheck);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      videos.forEach(pauseVideo);
    };
  }, [activeMobileTab, isMobile, isMobileReelFeed, visibleFeed]);

  const activeChatMedia = chatMediaViewer?.attachments?.[chatMediaViewer.index];
  const chatMediaTotal = chatMediaViewer?.attachments?.length || 0;
  const hideMobileChatNav = Boolean(isMobileChatTab && selectedMobileChat);
  const mobileChatViewportStyle =
    isMobileChatTab && mobileChatViewportHeight
      ? { height: `${mobileChatViewportHeight}px` }
      : undefined;
  const mobileChatContentStyle = isMobileChatTab
    ? { paddingBottom: hideMobileChatNav ? "0.75rem" : "4.75rem" }
    : undefined;
  const mobileBottomNavHeight = "var(--vybe-mobile-nav-height)";
  const mobileShellStyle = isMobileChatTab
    ? mobileChatViewportStyle
    : { paddingBottom: mobileBottomNavHeight };
  const feedOverlayOpen = createOpen || mobileSettingsOpen || shareItem;
  const mobileChatWallpaperStyle = {
    backgroundColor: "#0b141a",
    backgroundImage:
      "radial-gradient(circle at 18px 18px, rgba(255,255,255,0.045) 1.2px, transparent 1.3px), radial-gradient(circle at 58px 42px, rgba(0,168,132,0.06) 1.2px, transparent 1.4px), linear-gradient(135deg, rgba(255,255,255,0.025) 8%, transparent 8%, transparent 50%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.02) 58%, transparent 58%)",
    backgroundSize: "84px 84px, 96px 96px, 72px 72px",
  };
  const showChatMediaStep = (direction) => {
    setChatMediaViewer((current) => {
      if (!current?.attachments?.length) return current;
      const nextIndex =
        (current.index + direction + current.attachments.length) % current.attachments.length;
      return { ...current, index: nextIndex };
    });
  };

  return (
    <div
      ref={feedRootRef}
      data-vybe-feed-root
      style={mobileShellStyle}
      className={`vybe-feed-panel vybe-mobile-shell ${feedOverlayOpen ? "vybe-modal-host-open" : ""} w-full lg:flex-1 lg:max-w-[840px] xl:max-w-[900px] bg-black relative border-x border-gray-900 ${
        isMobileChatTab ? "pb-0" : ""
      } lg:pb-0 ${
        isMobileChatTab
          ? "fixed inset-x-0 top-0 z-30 flex flex-col h-[100svh] overflow-hidden lg:relative lg:inset-auto"
          : isMobileReelFeed
          ? "h-[100vh] overflow-y-auto snap-y snap-mandatory"
          : "min-h-[100vh] lg:h-[100vh] lg:overflow-y-auto"
      }`}
    >
      <div
        className={`sticky top-0 z-20 shrink-0 bg-black/95 border-b border-gray-900 px-5 py-4 items-center justify-between ${
          isMobileChatTab && selectedMobileChat ? "hidden" : "flex"
        }`}
      >
        <div className="min-w-0 flex items-center gap-3">
          {activeMobileTab === "profile" ? (
            <button
              type="button"
              onClick={handleProfileBack}
              className="w-10 h-10 rounded-full hover:bg-[#111] flex items-center justify-center text-white text-xl"
              aria-label="Back from profile"
            >
              <FiArrowLeft />
            </button>
          ) : null}
          <h1 className="min-w-0 truncate text-white text-xl font-semibold">
            {activeMobileTab === "chat"
              ? "Chat"
              : activeMobileTab === "reels"
                ? "Reels"
                : activeMobileTab === "profile"
                  ? profileTitle
                  : activeMobileTab === "search"
                    ? "Search"
                    : "Home"}
          </h1>
        </div>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (activeMobileTab === "reels") {
                setMode("reel");
              }
              setCreateOpen(true);
              setMessage("");
            }}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center text-xl hover:bg-gray-200"
            aria-label="Create post or reel"
          >
            <FiPlus />
          </button>
          <button
            type="button"
            onClick={() => setMobileSettingsOpen(true)}
            className="lg:hidden w-10 h-10 rounded-full hover:bg-[#111] flex items-center justify-center text-white text-xl"
            aria-label="Mobile settings"
          >
            <FiSettings />
          </button>
          <div ref={notificationMenuRef} className="relative">
            <button
              type="button"
              onClick={markNotificationsRead}
              className="relative w-10 h-10 rounded-full hover:bg-[#111] flex items-center justify-center text-white text-xl"
              aria-label="Notifications"
            >
              <FiBell />
              {unreadCount > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-xs flex items-center justify-center">
                  {unreadCount}
                </span>
              ) : null}
            </button>

            {notificationsOpen ? (
              <div
                data-vybe-notification-panel
                className="absolute right-0 mt-3 w-[320px] max-h-[420px] overflow-y-auto rounded-lg border border-gray-800 bg-[#050505] shadow-2xl"
              >
                <div className="px-4 py-3 border-b border-gray-900">
                  <p className="text-white font-semibold">Notifications</p>
                </div>
                {notifications.length > 0 ? (
                  notifications.map((notification) => {
                    const actorId = notification.actor?._id;
                    const isFollowNotification = notification.type === "follow";
                    const shouldShowNotificationText = ["comment", "reply", "story_reply"].includes(
                      notification.type
                    );
                    const alreadyFollowingActor = actorId ? mobileFollowingIds.has(actorId) : false;

                    return (
                      <div
                        key={notification._id}
                        data-vybe-notification-item
                        className="px-4 py-3 border-b border-gray-900 last:border-b-0"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => handleNotificationOpen(notification)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-sm text-gray-200">
                              <span className="font-semibold text-white">{notification.actor?.userName || "Someone"}</span>{" "}
                              {getNotificationActionLabel(notification)}.
                            </p>
                            {notification.text && shouldShowNotificationText ? (
                              <p className="text-xs text-gray-500 mt-1 truncate">{notification.text}</p>
                            ) : null}
                          </button>
                          {isFollowNotification && actorId ? (
                            <button
                              type="button"
                              onClick={() => handleFeedUserFollow(notification.actor)}
                              disabled={alreadyFollowingActor || feedUserBusyId === actorId}
                              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
                                alreadyFollowingActor ? "bg-[#171717] text-gray-400" : "bg-white text-black"
                              }`}
                            >
                              {feedUserBusyId === actorId
                                ? "..."
                                : alreadyFollowingActor
                                  ? "Following"
                                  : "Follow Back"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteNotification(notification._id);
                            }}
                            disabled={deletingNotificationIds.has(notification._id)}
                            className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-[#111] hover:text-red-400 disabled:opacity-50"
                            aria-label="Delete notification"
                            title="Delete notification"
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="px-4 py-6 text-sm text-gray-500">No notifications yet.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {activeMobileTab === "search" ? (
        <div className="border-b border-gray-900 px-5 py-3">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              ref={feedSearchInputRef}
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Search feed, reels, or username"
              className="w-full h-11 rounded-lg bg-[#101010] border border-gray-900 pl-10 pr-3 text-sm text-white outline-none placeholder:text-gray-600"
            />
          </div>
          {feedSearch.trim() ? (
            <div className="mt-3 flex flex-col gap-2">
              {feedUserSearchLoading ? (
                <p className="px-1 text-xs text-gray-500">Searching users...</p>
              ) : feedUserResults.length > 0 ? (
                feedUserResults.map((feedUser) => {
                  const followsMe = mobileFollowerIds.has(feedUser._id);
                  const isFollowing = mobileFollowingIds.has(feedUser._id);
                  const showFollowBack = followsMe && !isFollowing;

                  return (
                    <div
                      key={feedUser._id}
                      className="min-h-14 rounded-lg bg-[#080808] border border-gray-900 px-3 py-2 flex items-center gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => openProfile(feedUser)}
                        className="min-w-0 flex-1 flex items-center gap-3 text-left"
                      >
                        <span className="relative shrink-0">
                          <img
                            src={mediaUrl(feedUser.profileImage) || dp}
                            alt={feedUser.userName}
                            className="w-10 h-10 rounded-full object-cover"
                            onError={(event) => {
                              event.currentTarget.src = dp;
                            }}
                          />
                          {isUserOnline(feedUser) ? (
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-black" />
                          ) : null}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5 text-white text-sm font-semibold">
                            <span className="truncate">@{feedUser.userName}</span>
                            {feedUser.isVerified ? <VerifiedBadge /> : null}
                          </span>
                          <span className="block text-gray-500 text-xs truncate">
                            {[feedUser.name, isUserOnline(feedUser) ? "Online" : followsMe ? "Follows you" : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleFeedUserFollow(feedUser)}
                        disabled={feedUserBusyId === feedUser._id}
                        className={`h-9 px-3 rounded-md text-sm font-semibold disabled:opacity-60 ${
                          isFollowing ? "bg-[#171717] text-gray-300" : "bg-white text-black"
                        }`}
                      >
                        {feedUserBusyId === feedUser._id
                          ? "..."
                          : isFollowing
                            ? "Following"
                            : showFollowBack
                              ? "Follow Back"
                              : "Follow"}
                      </button>
                    </div>
                  );
                })
              ) : visibleFeed.length === 0 ? (
                <p className="px-1 text-xs text-gray-500">No user matches for this search.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`w-full overflow-x-auto border-b border-gray-900 px-5 py-4 ${
        activeMobileTab === "profile" || activeMobileTab === "search"
          ? "hidden"
          : activeMobileTab !== "home"
            ? "hidden lg:block"
            : ""
      }`}>
        <div className="flex gap-4 min-w-max">
          <div
            className={`relative flex flex-col items-center gap-2 ${
              storyUploading ? "opacity-60" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => {
                if (!ownStoryGroup?.stories?.length) return;
                const firstUnviewedStory = ownStoryGroup.stories.find(
                  (story) => !story.viewers?.some((id) => id.toString() === userData?._id)
                );
                openStory(firstUnviewedStory || ownStoryGroup.stories[0]);
              }}
              disabled={storyUploading || !ownStoryGroup?.stories?.length}
              className={`relative w-16 h-16 rounded-full p-[2px] ${
                ownStoryGroup?.stories?.length
                  ? ownStoryGroup.hasUnviewed
                    ? "bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-400"
                    : "bg-gray-700"
                  : "bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-400"
              } disabled:cursor-default`}
              aria-label={ownStoryGroup?.stories?.length ? "Open your story" : "No story yet"}
              title={
                ownStoryGroup?.stories?.length
                  ? `${ownStoryGroup.stories.length} ${ownStoryGroup.stories.length === 1 ? "story" : "stories"} · ${getStoryTimeLeftLabel(ownStoryGroup.latestStory, storyClock)}`
                  : "Add story"
              }
            >
              <img
                src={mediaUrl(userData?.profileImage) || dp}
                alt="Your story"
                className="w-full h-full rounded-full object-cover border-2 border-black"
                onError={(event) => {
                  event.currentTarget.src = dp;
                }}
              />
            </button>
            <label className="absolute right-0 bottom-5 w-6 h-6 rounded-full bg-blue-600 border-2 border-black text-white flex items-center justify-center text-sm cursor-pointer">
              <FiPlus />
              <input
                type="file"
                accept="image/*,video/*"
                onChange={handleStoryFileChange}
                disabled={storyUploading}
                className="hidden"
              />
            </label>
            <span className="text-white text-xs max-w-16 truncate">
              {ownStoryGroup?.stories?.length ? "Your story" : "You"}
            </span>
          </div>

          {visibleStoryGroups.map((group) => {
            const firstUnviewedStory = group.stories.find(
              (story) => !story.viewers?.some((id) => id.toString() === userData?._id)
            );
            const openingStory = firstUnviewedStory || group.stories[0];
            const viewed = !group.hasUnviewed;

            return (
              <button
                key={group.authorId}
                type="button"
                onClick={() => openStory(openingStory)}
                className="flex flex-col items-center gap-2"
                title={`${group.stories.length} ${group.stories.length === 1 ? "story" : "stories"} · ${getStoryTimeLeftLabel(group.latestStory, storyClock)}`}
              >
                <div
                  className={`w-16 h-16 rounded-full p-[2px] ${
                    viewed
                      ? "bg-gray-700"
                      : "bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-400"
                  }`}
                >
                  <img
                    src={mediaUrl(group.author?.profileImage) || dp}
                    alt={group.author?.userName || "Story"}
                    className="w-full h-full rounded-full object-cover border-2 border-black"
                    onError={(event) => {
                      event.currentTarget.src = dp;
                    }}
                  />
                </div>
                <span className="text-white text-xs max-w-16 truncate">
                  {group.authorId === userData?._id ? "Your story" : group.author?.userName}
                </span>
              </button>
            );
          })}
        </div>

        {storyUploading || storyUploadProgress > 0 ? (
          <div className="mt-4 min-w-[240px]">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-gray-300">Uploading story</span>
              <span className="text-gray-500">{storyUploadProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#171717]">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${storyUploadProgress}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {activeMobileTab === "home" && mobileSuggestedUsers.length > 0 ? (
        <section className="lg:hidden border-b border-gray-900 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-semibold">People</p>
              <p className="text-gray-500 text-xs">Find new users on VYBE</p>
            </div>
            <span className="text-xs text-gray-500">{mobileSuggestedUsers.length}</span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {mobileSuggestedUsers.map((suggestedUser) => {
              const followsMe = mobileFollowerIds.has(suggestedUser._id);
              const isFollowing = mobileFollowingIds.has(suggestedUser._id);
              const showFollowBack = followsMe && !isFollowing;

              return (
                <div
                  key={suggestedUser._id}
                  className="relative w-[150px] shrink-0 rounded-lg border border-gray-900 bg-[#050505] p-3"
                >
                  <button
                    type="button"
                    onClick={() => removeMobileSuggestion(suggestedUser._id)}
                    className="absolute right-2 top-2 w-7 h-7 rounded-full bg-[#111] text-gray-400 hover:text-white flex items-center justify-center"
                    aria-label={`Remove ${suggestedUser.userName} from suggestions`}
                  >
                    <FiX />
                  </button>

                  <button
                    type="button"
                    onClick={() => openProfile(suggestedUser)}
                    className="w-full flex flex-col items-center text-center pt-2"
                  >
                    <span className="relative">
                      <img
                        src={mediaUrl(suggestedUser.profileImage) || dp}
                        alt={suggestedUser.userName}
                        className="w-16 h-16 rounded-full object-cover border border-gray-800"
                        onError={(event) => {
                          event.currentTarget.src = dp;
                        }}
                      />
                      {isUserOnline(suggestedUser) ? (
                        <span className="absolute bottom-1 right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />
                      ) : null}
                    </span>
                    <span className="mt-2 flex w-full min-w-0 items-center justify-center gap-1 text-white text-sm font-semibold">
                      <span className="truncate">{suggestedUser.userName}</span>
                      {suggestedUser.isVerified ? <VerifiedBadge /> : null}
                    </span>
                    <span className="w-full text-gray-500 text-xs truncate">
                      {isUserOnline(suggestedUser)
                        ? "Online"
                        : followsMe
                          ? "Follows you"
                          : suggestedUser.name}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleFeedUserFollow(suggestedUser)}
                    disabled={feedUserBusyId === suggestedUser._id}
                    className={`mt-3 h-9 w-full rounded-md text-xs font-semibold disabled:opacity-60 ${
                      isFollowing ? "bg-[#171717] text-gray-300" : "bg-white text-black"
                    }`}
                  >
                    {feedUserBusyId === suggestedUser._id
                      ? "..."
                      : isFollowing
                        ? "Following"
                        : showFollowBack
                          ? "Follow Back"
                          : "Follow"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div
        style={mobileChatContentStyle}
        className={`w-full max-w-[660px] xl:max-w-[700px] mx-auto flex flex-col ${
          isMobileReelFeed
            ? "px-0 py-0 gap-0"
            : isMobileChatTab
              ? selectedMobileChat
                ? "flex-1 min-h-0 px-0 pt-0 gap-0 overflow-hidden"
                : "flex-1 min-h-0 px-4 pt-4 gap-4 overflow-hidden"
              : "px-4 py-5 gap-6"
        }`}
      >
        {message ? (
          <p className={`text-sm ${shouldAutoDismissStatus(message) ? "text-green-400" : "text-gray-500"}`}>
            {message}
          </p>
        ) : null}

        {activeMobileTab === "profile" ? (
          <section className="flex flex-col gap-5">
            {profileLoading && !activeProfileUser ? (
              <div className="py-16 text-center text-gray-500">Loading profile...</div>
            ) : activeProfileUser ? (
              <>
                <div className="rounded-2xl border border-gray-900 bg-[#050505] p-4 sm:p-5">
                  <div className="flex items-center gap-4 sm:gap-5">
                    <span className="relative shrink-0">
                      <img
                        src={mediaUrl(activeProfileUser.profileImage) || dp}
                        alt={activeProfileUser.userName || "Profile"}
                        className="h-20 w-20 rounded-full border border-gray-800 object-cover sm:h-24 sm:w-24"
                        onError={(event) => {
                          event.currentTarget.src = dp;
                        }}
                      />
                      {isUserOnline(activeProfileUser) ? (
                        <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-black bg-green-500" />
                      ) : null}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-2xl font-bold text-white">
                        <span className="truncate">{activeProfileUser.userName}</span>
                        {activeProfileUser.isVerified ? <VerifiedBadge className="h-5 w-5" /> : null}
                      </p>
                      <p className="mt-1 truncate text-sm text-gray-500">
                        {[activeProfileUser.name, isUserOnline(activeProfileUser) ? "Online" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-gray-900 bg-black">
                    <div className="px-2 py-3 text-center">
                      <p className="font-bold text-white">{activeProfileContent.length}</p>
                      <p className="text-xs text-gray-500">Posts</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openConnectionsList({ user: activeProfileUser, type: "followers" })}
                      className="border-l border-gray-900 px-2 py-3 text-center hover:bg-[#101010]"
                    >
                      <p className="font-bold text-white">{uniqueCount(activeProfileUser.followers)}</p>
                      <p className="text-xs text-gray-500">Followers</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => openConnectionsList({ user: activeProfileUser, type: "following" })}
                      className="border-l border-gray-900 px-2 py-3 text-center hover:bg-[#101010]"
                    >
                      <p className="font-bold text-white">{uniqueCount(activeProfileUser.following)}</p>
                      <p className="text-xs text-gray-500">Following</p>
                    </button>
                  </div>
                </div>

                <div className="flex gap-3">
                  {viewingOwnProfile ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setMobileSettingsOpen(true)}
                        className="h-10 flex-1 rounded-md bg-white text-black text-sm font-semibold"
                      >
                        Edit profile
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode("post");
                          setCreateOpen(true);
                        }}
                        className="h-10 flex-1 rounded-md bg-[#171717] text-white text-sm font-semibold"
                      >
                        New post
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleProfileFollow}
                        disabled={profileBusy}
                        className={`h-10 flex-1 rounded-md text-sm font-semibold disabled:opacity-60 ${
                          profileIsFollowing ? "bg-[#171717] text-gray-300" : "bg-white text-black"
                        }`}
                      >
                        {profileBusy
                          ? "..."
                          : profileIsFollowing
                            ? "Following"
                            : profileFollowsMe
                              ? "Follow Back"
                              : "Follow"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const chatTarget = {
                            ...activeProfileUser,
                            pendingConnection: !(profileIsFollowing && profileFollowsMe),
                          };
                          if (isMobile) {
                            setActiveMobileTab("chat");
                            openMobileChat(chatTarget);
                            return;
                          }

                          window.dispatchEvent(
                            new CustomEvent("vybe:open-chat", {
                              detail: { user: chatTarget },
                            })
                          );
                        }}
                        className="h-10 flex-1 rounded-md bg-[#171717] text-white text-sm font-semibold"
                      >
                        Message
                      </button>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-3 rounded-md border border-gray-900 overflow-hidden">
                  {[
                    { key: "all", label: "All", count: activeProfileContent.length },
                    { key: "post", label: "Posts", count: profilePostCount },
                    { key: "reel", label: "Reels", count: profileReelCount },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setProfileContentType(tab.key)}
                      className={`h-11 text-sm font-semibold border-r border-gray-900 last:border-r-0 ${
                        profileContentType === tab.key
                          ? "bg-white text-black"
                          : "bg-[#050505] text-gray-400"
                      }`}
                    >
                      {tab.label} {tab.count}
                    </button>
                  ))}
                </div>

                {visibleProfileContent.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1">
                    {visibleProfileContent.map((item) => {
                      const contentKey = getContentKey(item);
                      const renderAsTextPost = isTextPost(item) || brokenMediaKeys.has(contentKey);

                      return (
                        <button
                          type="button"
                          key={`${item.type}-${item._id}`}
                          className="relative aspect-square bg-[#101010] overflow-hidden"
                          onClick={() => setSelectedProfileItem(item)}
                          title={item.caption || item.type}
                        >
                          {renderAsTextPost ? (
                            <div className="flex h-full w-full items-center justify-center bg-[#080808] p-3">
                              <p className="max-h-full overflow-hidden break-words text-center text-sm font-semibold text-white">
                                {item.caption}
                              </p>
                            </div>
                          ) : item.mediaType === "video" ? (
                            <video
                              src={mediaUrl(item.media)}
                              muted
                              playsInline
                              preload="metadata"
                              onError={() => markBrokenMedia(item)}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <img
                              src={mediaUrl(item.media)}
                              alt={item.caption || "Profile post"}
                              onError={() => markBrokenMedia(item)}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                            {item.type === "reel" ? "Reel" : "Post"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-gray-900 rounded-lg bg-[#050505] px-6 py-12 text-center">
                    <p className="text-white font-semibold">No posts yet</p>
                    <p className="text-gray-500 text-sm mt-2">
                      {viewingOwnProfile
                        ? "Your uploaded posts and reels will appear here."
                        : "This profile has not shared anything yet."}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="border border-gray-900 rounded-lg bg-[#050505] px-6 py-12 text-center">
                <p className="text-white font-semibold">Profile unavailable</p>
                <p className="text-gray-500 text-sm mt-2">
                  {profileStatus || "Open a profile to see posts and reels."}
                </p>
              </div>
            )}

            {profileStatus ? <p className="text-sm text-red-400">{profileStatus}</p> : null}
          </section>
        ) : activeMobileTab === "chat" ? (
          <div
            className={`lg:hidden flex h-full min-h-0 flex-col gap-3 ${
              selectedMobileChat ? "overflow-hidden" : "overflow-y-auto overscroll-contain"
            }`}
          >
            {selectedMobileChat ? (
              <div
                className="flex h-full min-h-0 flex-col overflow-hidden text-white"
                style={mobileChatWallpaperStyle}
              >
                <div className="relative h-[70px] shrink-0 px-3 flex items-center justify-between bg-[#0b141a]/95 shadow-lg shadow-black/20">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMobileChat(null);
                        setMobileConversationMenuOpen(false);
                        setMobileMessageMenuId("");
                      }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-100 active:bg-white/10"
                      aria-label="Back to chats"
                    >
                      <FiArrowLeft className="text-xl" />
                    </button>
                  <button
                    type="button"
                    onClick={() => openProfile(selectedMobileChat)}
                    className="flex items-center gap-3 min-w-0 text-left"
                  >
                    <span className="relative shrink-0">
                      <img
                        src={mediaUrl(selectedMobileChat.profileImage) || dp}
                        alt={selectedMobileChat.userName}
                        className="w-10 h-10 rounded-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = dp;
                        }}
                      />
                      {isUserOnline(selectedMobileChat) ? (
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25d366] border-2 border-[#0b141a]" />
                      ) : null}
                    </span>
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1 text-white text-[15px] font-semibold">
                        <span className="truncate">{selectedMobileChat.userName}</span>
                        {selectedMobileChat.isVerified ? <VerifiedBadge /> : null}
                      </p>
                      <p className="text-[#aebac1] text-xs truncate">
                        {selectedMobileChat.pendingConnection
                          ? "Pending connection"
                          : isUserOnline(selectedMobileChat)
                            ? "Online"
                            : "Offline"}
                      </p>
                    </div>
                  </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileConversationMenuOpen((open) => !open)}
                      className="w-11 h-11 rounded-full bg-white/5 text-gray-100 flex items-center justify-center active:scale-95 active:bg-white/10 transition"
                      aria-label="Conversation options"
                    >
                      <FiMoreVertical className="text-xl" />
                    </button>
                  </div>

                  {mobileConversationMenuOpen ? (
                    <div className="absolute right-3 top-14 z-10 w-52 rounded-xl border border-white/10 bg-[#111b21] p-1 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => deleteMobileConversation(selectedMobileChat._id)}
                        className="w-full h-10 rounded-md px-3 text-left text-sm text-red-300 hover:bg-white/5"
                      >
                        Delete conversation
                      </button>
                    </div>
                  ) : null}
                </div>

                <div
                  ref={mobileMessagesListRef}
                  className="min-h-0 flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-2.5 overscroll-contain"
                >
                  {mobileMessages.length > 0 ? (
                    mobileMessages.map((chatMessage) => {
                      const mine = chatMessage.sender?._id === userData?._id;
                      const mediaOnly =
                        getMessageAttachments(chatMessage).length > 0 &&
                        !chatMessage.text &&
                        !chatMessage.sharedContent;
                      return (
                        <div
                          key={chatMessage._id}
                          onPointerDown={(event) => startMobileMessageHold(event, chatMessage)}
                          onPointerMove={moveMobileMessageHold}
                          onPointerUp={clearMobileMessageHold}
                          onPointerLeave={clearMobileMessageHold}
                          onPointerCancel={clearMobileMessageHold}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openMobileMessageActions(chatMessage);
                          }}
                          className={`relative max-w-[78%] select-none rounded-[18px] text-[15px] leading-snug shadow-sm shadow-black/20 transition-transform active:scale-[0.99] ${
                            mediaOnly ? "p-0" : "px-4 py-2.5"
                          } ${
                            mediaOnly
                              ? `bg-transparent text-white ${mine ? "self-end" : "self-start"} ${
                                  chatMessage.pending ? "opacity-70" : ""
                                }`
                              : mine
                                ? `self-end bg-[#005c4b] text-white rounded-br-md ${
                                    chatMessage.failed ? "bg-red-600" : chatMessage.pending ? "opacity-70" : ""
                                  }`
                                : "self-start bg-[#202c33] text-gray-100 rounded-bl-md"
                          } ${mobileMessageMenuId === chatMessage._id ? "ring-1 ring-white/20" : ""}`}
                        >
                          {renderChatReplyPreview(chatMessage)}
                          {chatMessage.text ? (
                            <p className="whitespace-pre-wrap break-words">{chatMessage.text}</p>
                          ) : null}
                          {renderChatMessageMedia(chatMessage)}
                          {renderSharedContentCard(chatMessage)}
                          {renderChatMessageReactions(chatMessage)}
                          {chatMessage.failed ? (
                            <p className="mt-1 text-[10px] text-white/80">Not sent</p>
                          ) : mine ? (
                            <MessageStatusTicks message={chatMessage} />
                          ) : null}
                        </div>
                      );
                    })
                  ) : !selectedMobileChatTyping ? (
                    <div className="h-full flex items-center justify-center text-[#aebac1] text-sm text-center">
                      Say hi to start the conversation.
                    </div>
                  ) : null}
                  {selectedMobileChatTyping ? (
                    <div className="self-start rounded-2xl rounded-bl-sm bg-[#202c33] px-3 py-2 text-xs font-semibold text-[#d1d7db]">
                      Typing...
                    </div>
                  ) : null}
                </div>

                <form
                  onSubmit={sendMobileMessage}
                  className="relative shrink-0 bg-[#0b141a]/95 px-3 py-2 pb-[max(0.65rem,env(safe-area-inset-bottom))]"
                >
                  {mobileReplyToMessage ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111b21] px-3 py-2">
                      <div className="min-w-0 border-l-2 border-[#00a884] pl-2">
                        <p className="text-xs font-semibold text-white">
                          Replying to {getMessageSenderId(mobileReplyToMessage) === userData?._id ? "your message" : mobileReplyToMessage.sender?.userName || "user"}
                        </p>
                        <p className="truncate text-xs text-[#8696a0]">
                          {getReplyPreviewText(createMessageReplySnapshot(mobileReplyToMessage))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileReplyToMessage(null)}
                        className="shrink-0 text-[#aebac1]"
                        aria-label="Cancel reply"
                      >
                        <FiX />
                      </button>
                    </div>
                  ) : null}
                  {mobileMessageMedia.length > 0 ? (
                    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                      {mobileMessageMedia.map((item, index) => (
                        <div key={`${item.name}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#202c33]">
                          {item.mediaType === "video" ? (
                            <video src={mediaUrl(item.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          ) : (
                            <img src={mediaUrl(item.media)} alt="Selected media" className="h-full w-full object-cover" />
                          )}
                          <button
                            type="button"
                            onClick={() => clearMobileMessageMedia(index)}
                            className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                            aria-label="Remove media"
                          >
                            <FiX className="text-xs" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={generateAiReplies}
                      disabled={aiReplyLoading}
                      className="h-8 shrink-0 rounded-full bg-[#00a884] px-3 text-xs font-semibold text-[#07100f] disabled:opacity-60"
                    >
                      {aiReplyLoading ? "Thinking..." : "AI replies"}
                    </button>
                    {aiReplySuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          setMobileMessageText(suggestion);
                          setAiReplySuggestions([]);
                          focusMobileMessageInput();
                        }}
                        className="h-8 shrink-0 rounded-full bg-[#202c33] px-3 text-xs font-semibold text-[#e9edef] active:bg-white/10"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  {mobileChatEmojiOpen ? (
                    <div className="absolute bottom-16 left-3 z-10 grid grid-cols-6 gap-1 rounded-2xl border border-white/10 bg-[#111b21] p-2 shadow-2xl">
                      {EMOJI_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setMobileMessageText((text) => `${text}${emoji}`)}
                          className="w-8 h-8 rounded-md text-lg hover:bg-white/5"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex flex-1 items-center gap-1 rounded-full bg-[#202c33] px-2 py-1.5 shadow-lg shadow-black/20">
                  <button
                    type="button"
                    onClick={() => setMobileChatEmojiOpen((open) => !open)}
                    className="w-9 h-9 shrink-0 rounded-full text-[#aebac1] flex items-center justify-center active:bg-white/10"
                    aria-label="Add emoji"
                  >
                    <FiSmile />
                  </button>
                  <input
                    ref={mobileMessageMediaInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleMobileMessageMediaChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => mobileMessageMediaInputRef.current?.click()}
                    className="w-9 h-9 shrink-0 rounded-full text-[#aebac1] flex items-center justify-center active:bg-white/10"
                    aria-label="Send photo or video"
                  >
                    <FiImage />
                  </button>
                  <button
                    type="button"
                    onClick={() => mobileMessageMediaInputRef.current?.click()}
                    className="w-9 h-9 shrink-0 rounded-full text-[#aebac1] flex items-center justify-center active:bg-white/10"
                    aria-label="Open camera media"
                  >
                    <FiCamera />
                  </button>
                  <input
                    ref={mobileMessageInputRef}
                    value={mobileMessageText}
                    onChange={handleMobileMessageTextChange}
                    onFocus={() => {
                      setMobileKeyboardOpen(true);
                      window.setTimeout(() => {
                        const list = mobileMessagesListRef.current;
                        list?.scrollTo({ top: list.scrollHeight });
                      }, 80);
                    }}
                    onBlur={() => {
                      stopMobileOutgoingTyping(selectedMobileChat?._id);
                      window.setTimeout(() => {
                        if (mobileKeepKeyboardAfterSendRef.current) {
                          try {
                            mobileMessageInputRef.current?.focus({ preventScroll: true });
                          } catch {
                            mobileMessageInputRef.current?.focus();
                          }
                          setMobileKeyboardOpen(true);
                          return;
                        }

                        setMobileKeyboardOpen(false);
                      }, 160);
                    }}
                    placeholder="Message..."
                    className="min-w-0 flex-1 h-10 bg-transparent text-[16px] text-[#e9edef] px-1 outline-none placeholder:text-[#8696a0]"
                    maxLength={1000}
                  />
                    </div>
                  <button
                    type="button"
                    onPointerDown={handleMobileSendPointerDown}
                    onClick={handleMobileSendClick}
                    className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-xl shadow-lg shadow-black/20 transition active:scale-95 disabled:opacity-70 ${
                      mobileMessageText.trim() || mobileMessageMedia.length > 0
                        ? "bg-[#00a884] text-[#07100f]"
                        : "bg-[#00a884] text-[#07100f]"
                    }`}
                    disabled={!mobileMessageText.trim() && mobileMessageMedia.length === 0}
                    aria-label="Send message"
                  >
                    <FiSend />
                  </button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold">Messages</p>
                    <p className="text-gray-500 text-sm">Chat with people you follow.</p>
                  </div>
                  <FiMessageCircle className="text-gray-500 text-xl" />
                </div>

                <div className="relative">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={mobileChatSearch}
                    onChange={(event) => setMobileChatSearch(event.target.value)}
                    placeholder="Search chats"
                    className="w-full h-11 rounded-lg bg-[#101010] border border-gray-900 pl-10 pr-3 text-sm text-white outline-none placeholder:text-gray-600"
                  />
                </div>

                {visibleMobileChatUsers.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {visibleMobileChatUsers.map((chatUser) => {
                      const followsMe = mobileFollowerIds.has(chatUser._id);
                      const isFollowing = mobileFollowingIds.has(chatUser._id);
                      const showFollowBack = followsMe && !isFollowing;
                      const unreadCount = chatUser.unreadCount || 0;

                      return (
                        <div
                          key={chatUser._id}
                          onPointerDown={(event) => startMobileChatListHold(event, chatUser)}
                          onPointerMove={moveMobileChatListHold}
                          onPointerUp={clearMobileChatListHold}
                          onPointerLeave={clearMobileChatListHold}
                          onPointerCancel={clearMobileChatListHold}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            openMobileChatListActions(chatUser);
                          }}
                          className={`min-h-16 select-none rounded-lg border px-3 py-2 flex items-center gap-3 transition ${
                            mobileChatListMenuUserId === chatUser._id
                              ? "border-white/20 bg-[#111]"
                              : "border-gray-900 bg-[#080808]"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (shouldSkipMobileChatListClick()) return;
                              openProfile(chatUser);
                            }}
                            className="relative shrink-0"
                            aria-label={`Open ${chatUser.userName} profile`}
                          >
                            <img
                              src={mediaUrl(chatUser.profileImage) || dp}
                              alt={chatUser.userName}
                              className="w-11 h-11 rounded-full object-cover"
                              onError={(event) => {
                                event.currentTarget.src = dp;
                              }}
                            />
                            {isUserOnline(chatUser) ? (
                              <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (shouldSkipMobileChatListClick()) return;
                              openMobileChat(chatUser);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="min-w-0">
                              <p className="flex min-w-0 items-center gap-1.5 text-white font-semibold">
                                <span className="truncate">{chatUser.userName}</span>
                                {chatUser.isVerified ? <VerifiedBadge /> : null}
                              </p>
                              <p className="text-gray-500 text-sm truncate">
                                {getChatPreviewText(
                                  chatUser,
                                  chatUser.pendingConnection
                                    ? "Pending connection"
                                    : isUserOnline(chatUser)
                                      ? "Online"
                                      : showFollowBack
                                        ? "Follows you"
                                        : "Open chat"
                                )}
                              </p>
                            </div>
                          </button>

                          {unreadCount > 0 ? (
                            <span className="min-w-6 h-6 px-1 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center">
                              {formatUnreadCount(unreadCount)}
                            </span>
                          ) : null}

                          {showFollowBack ? (
                            <button
                              type="button"
                              data-mobile-chat-direct-action
                              onClick={() => handleMobileFollow(chatUser)}
                              disabled={mobileBusyUserId === chatUser._id}
                              className="h-9 px-3 rounded-md bg-white text-black text-sm font-semibold disabled:opacity-60"
                            >
                              {mobileBusyUserId === chatUser._id ? "..." : "Follow Back"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-gray-900 rounded-lg bg-[#050505] p-8 text-center">
                    <p className="text-white font-semibold">
                      {mobileChatSearchLoading
                        ? "Searching connected users..."
                        : normalizedMobileChatSearch
                          ? "No connected users found"
                          : "No chats yet"}
                    </p>
                    <p className="text-gray-500 text-sm mt-2">
                      {normalizedMobileChatSearch
                        ? "Only mutual connected users can start a chat."
                        : "Open a profile and send a message to start a chat."}
                    </p>
                  </div>
                )}
              </>
            )}
            {mobileChatStatus && !isInternalAiSetupStatus(mobileChatStatus) ? (
              <p className={`text-sm ${shouldAutoDismissStatus(mobileChatStatus) ? "text-green-400" : "text-red-400"}`}>
                {mobileChatStatus}
              </p>
            ) : null}
          </div>
        ) : activeMobileTab === "search" && !normalizedFeedSearch ? (
          <section className="rounded-lg border border-gray-900 bg-[#050505] px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#101010] text-2xl text-white">
              <FiSearch />
            </div>
            <p className="text-white text-lg font-semibold">Search VYBE</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-gray-500">
              Find people by username, or search posts and reels by captions, comments, and profile names.
            </p>
          </section>
        ) : loadingFeed ? (
          <div className="text-gray-500 text-center py-12">Loading feed...</div>
        ) : visibleFeed.length > 0 ? (
          visibleFeed.map((item) => {
            const contentKey = getContentKey(item);
            const itemLiked = item.likes?.some((id) => id.toString() === userData?._id);
            const likePending = pendingLikeIds.has(contentKey);
            const deletePending = pendingContentDeleteIds.has(contentKey);
            const authorId = item.author?._id?.toString();
            const isOwnAuthor = Boolean(authorId && authorId === userData?._id?.toString());
            const authorFollowsMe = authorId ? mobileFollowerIds.has(authorId) : false;
            const authorIsFollowing = authorId ? mobileFollowingIds.has(authorId) : false;
            const showAuthorFollow = Boolean(authorId && !isOwnAuthor && !authorIsFollowing);
            const renderAsTextPost = isTextPost(item) || brokenMediaKeys.has(contentKey);

            return (
            <article
              key={`${item.type}-${item._id}`}
              className={
                isMobileReelFeed
                  ? "min-h-[calc(100vh-9rem)] snap-start border-b border-gray-900 bg-black overflow-hidden flex flex-col"
                  : "border border-gray-900 rounded-lg overflow-hidden bg-black"
              }
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openProfile(item.author)}
                    className="shrink-0"
                    aria-label={`Open ${item.author?.userName || "user"} profile`}
                  >
                    <img
                      src={mediaUrl(item.author?.profileImage) || dp}
                      alt="profile"
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = dp;
                      }}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openProfile(item.author)}
                        className="flex min-w-0 items-center gap-1.5 text-left font-semibold text-white hover:text-gray-300"
                      >
                        <span className="truncate">{item.author?.userName || "vybe_user"}</span>
                        {item.author?.isVerified ? <VerifiedBadge /> : null}
                      </button>
                      {showAuthorFollow ? (
                        <button
                          type="button"
                          onClick={() => handleFeedUserFollow(item.author)}
                          disabled={feedUserBusyId === authorId}
                          className="shrink-0 text-sm font-semibold text-blue-500 transition hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {feedUserBusyId === authorId
                            ? "..."
                            : authorFollowsMe
                              ? "Follow back+"
                              : "Follow+"}
                        </button>
                      ) : null}
                    </div>
                    <p className="text-gray-500 text-xs truncate">
                      {item.type === "reel" ? "Reel" : "Post"} · {formatContentTime(item.createdAt, storyClock)}
                    </p>
                  </div>
                </div>
                {isOwnAuthor ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteContent(item)}
                    disabled={deletePending}
                    className="w-9 h-9 rounded-full hover:bg-[#111] text-gray-400 hover:text-red-400 flex items-center justify-center disabled:opacity-40"
                    aria-label="Delete post"
                  >
                    <FiTrash2 />
                  </button>
                ) : null}
              </div>

              <div
                className={
                  isMobileReelFeed
                    ? "min-h-0 flex-1 bg-black flex items-center justify-center"
                    : "bg-[#101010]"
                }
              >
                {renderAsTextPost ? (
                  <div className="min-h-[220px] w-full bg-[#080808] px-6 py-10 flex items-center justify-center">
                    <p className="max-w-2xl whitespace-pre-wrap break-words text-center text-2xl font-semibold leading-snug text-white">
                      {item.caption}
                    </p>
                  </div>
                ) : item.mediaType === "video" ? (
                  <video
                    src={mediaUrl(item.media)}
                    controls
                    muted={feedVideosMuted}
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                    data-feed-video
                    onError={() => markBrokenMedia(item)}
                    onVolumeChange={(event) => {
                      const nextMuted = event.currentTarget.muted;
                      if (nextMuted !== feedVideosMutedRef.current) {
                        setFeedVideosMuted(nextMuted);
                      }
                    }}
                    onPlay={(event) => {
                      const videos = feedRootRef.current?.querySelectorAll("video[data-feed-video]") || [];
                      videos.forEach((video) => {
                        if (video !== event.currentTarget) {
                          video.pause();
                        }
                      });
                    }}
                    className={
                      isMobileReelFeed
                        ? "w-full h-full max-h-none bg-black object-contain"
                        : "w-full max-h-[640px] bg-black object-contain"
                    }
                  />
                ) : (
                  <img
                    src={mediaUrl(item.media)}
                    alt={item.caption || "Post media"}
                    onError={() => markBrokenMedia(item)}
                    className={
                      isMobileReelFeed
                        ? "w-full h-full object-contain bg-black"
                        : "w-full max-h-[640px] object-contain bg-black"
                    }
                  />
                )}
              </div>

              <div className="px-4 py-4">
                <div className="flex items-center justify-between text-white text-2xl">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => handleLike(item)}
                      disabled={likePending}
                      className={`${itemLiked ? "text-red-500" : "text-white"} disabled:opacity-60`}
                      aria-label="Like"
                    >
                      {itemLiked ? <FaHeart /> : <FaRegHeart />}
                    </button>
                    <button type="button" onClick={() => setSelectedProfileItem(item)} aria-label="View comments">
                      <FaRegComment />
                    </button>
                    <button type="button" onClick={() => openShareSheet(item)} aria-label={`Share ${getContentTypeLabel(item)}`}>
                      <FiSend />
                    </button>
                  </div>
                  <FaRegBookmark />
                </div>
                <p className="text-white text-sm font-semibold mt-4">{item.likes?.length || 0} likes</p>
                {item.caption && !renderAsTextPost ? (
                  <p className="text-sm mt-1">
                    <span className="mr-2 inline-flex max-w-full items-center gap-1 align-bottom text-white font-semibold">
                      <span className="truncate">{item.author?.userName || "vybe_user"}</span>
                      {item.author?.isVerified ? <VerifiedBadge /> : null}
                    </span>
                    <span className="text-gray-300">{item.caption}</span>
                  </p>
                ) : null}

                {item.comments?.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedProfileItem(item)}
                    className="mt-2 text-sm text-gray-500 hover:text-white"
                  >
                    View all {item.comments.length} {item.comments.length === 1 ? "comment" : "comments"}
                  </button>
                ) : null}

                {item.comments?.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {item.comments.length > 3 ? (
                      <p className="text-xs text-gray-600">
                        Showing latest 3 of {item.comments.length} comments
                      </p>
                    ) : null}
                    {item.comments.slice(-3).map((comment) => renderCommentThread(item, comment))}
                  </div>
                ) : null}

                {renderCommentComposer(item)}
              </div>
            </article>
            );
          })
        ) : (
          <article className="border border-gray-900 rounded-lg overflow-hidden bg-black">
            <div className="aspect-square bg-[#101010] flex items-center justify-center px-6 text-center">
              <div>
                <p className="text-white text-lg font-semibold">
                  {normalizedFeedSearch && feedUserResults.length > 0
                    ? "No matching posts yet"
                    : normalizedFeedSearch
                      ? "No results found"
                      : `Welcome back, ${displayName}`}
                </p>
                <p className="text-gray-500 text-sm mt-2">
                  {normalizedFeedSearch && feedUserResults.length > 0
                    ? "User results are shown above the stories."
                    : normalizedFeedSearch
                    ? "Try another caption, username, or user id."
                    : activeMobileTab === "reels"
                      ? "No reels yet. Tap + and choose Reel."
                      : "Upload the first post or reel to start your live feed."}
                </p>
              </div>
            </div>
          </article>
        )}
      </div>

      {createOpen ? (
        <div className="vybe-create-overlay fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <form
            onSubmit={handleUpload}
            className="vybe-create-sheet w-full sm:max-w-[520px] max-h-[92svh] overflow-y-auto rounded-t-2xl sm:rounded-lg border-t sm:border border-gray-800 bg-[#050505] text-white"
          >
            <div className="h-14 px-4 flex items-center justify-between border-b border-gray-900">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={mediaUrl(userData?.profileImage) || dp}
                  alt="profile"
                  className="w-9 h-9 rounded-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = dp;
                  }}
                />
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                    <span className="truncate">{userData?.userName || "vybe_user"}</span>
                    {userData?.isVerified ? <VerifiedBadge /> : null}
                  </p>
                  <p className="text-xs text-gray-500">Create {mode === "reel" ? "reel" : "post"}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={uploading || !canShareCreate}
                  className="h-9 px-4 rounded-md bg-white text-black font-semibold disabled:opacity-60"
                >
                  {uploading ? `${uploadProgress}%` : "Share"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCaptionEmojiOpen(false);
                    setCreateOpen(false);
                  }}
                  disabled={uploading}
                  className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center disabled:opacity-50"
                  aria-label="Close creator"
                >
                  <FiX />
                </button>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div className="flex bg-[#111] border border-gray-800 rounded-md overflow-hidden self-start">
                <button
                  type="button"
                  onClick={() => handleModeChange("post")}
                  disabled={uploading}
                  className={`h-9 px-3 flex items-center gap-2 text-sm disabled:opacity-60 ${mode === "post" ? "bg-white text-black" : "text-gray-300"}`}
                >
                  <FiImage /> Post
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange("reel")}
                  disabled={uploading}
                  className={`h-9 px-3 flex items-center gap-2 text-sm disabled:opacity-60 ${mode === "reel" ? "bg-white text-black" : "text-gray-300"}`}
                >
                  <FiVideo /> Reel
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-900 bg-[#080808] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">AI caption helper</p>
                  <p className="truncate text-xs text-gray-500">
                    Generate caption ideas for this {mode}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generateAiCaptions}
                  disabled={aiCaptionLoading || uploading}
                  className="h-9 shrink-0 rounded-md bg-white px-3 text-sm font-semibold text-black disabled:opacity-60"
                >
                  {aiCaptionLoading ? "Thinking..." : "Generate"}
                </button>
              </div>

              <div className="relative flex items-start gap-2">
                {captionEmojiOpen ? (
                  <div className="absolute bottom-[6.5rem] left-0 z-10 grid grid-cols-6 gap-1 rounded-lg border border-gray-800 bg-[#080808] p-2 shadow-2xl">
                    {EMOJI_OPTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => addEmojiToCaption(emoji)}
                        className="w-8 h-8 rounded-md text-lg hover:bg-[#151515]"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setCaptionEmojiOpen((open) => !open)}
                  disabled={uploading}
                  className="w-11 h-11 shrink-0 rounded-md bg-[#111] border border-gray-800 text-gray-400 hover:text-white flex items-center justify-center disabled:opacity-60"
                  aria-label="Add emoji to caption"
                >
                  <FiSmile />
                </button>
                <textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder={mode === "post" ? "Write something or add a caption..." : "Caption for your reel..."}
                  disabled={uploading}
                  className="min-w-0 flex-1 h-24 resize-none rounded-md bg-[#111] border border-gray-800 px-3 py-3 text-white placeholder:text-gray-600 outline-none disabled:opacity-60"
                  maxLength={CAPTION_LIMIT}
                />
              </div>

              {aiCaptionSuggestions.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-gray-900 bg-[#080808] p-2">
                  <p className="px-1 text-xs font-semibold text-gray-400">Tap to use</p>
                  {aiCaptionSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setCaption(suggestion.slice(0, CAPTION_LIMIT));
                        setAiCaptionSuggestions([]);
                        setMessage("AI caption added.");
                      }}
                      disabled={uploading}
                      className="rounded-md bg-[#111] px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#171717] disabled:opacity-60"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}

              {preview ? (
                <div className="relative rounded-lg overflow-hidden border border-gray-800 bg-[#101010]">
                  <button
                    type="button"
                    onClick={clearSelectedFile}
                    disabled={uploading}
                    className="absolute right-3 top-3 z-10 w-9 h-9 rounded-full bg-black/80 text-white flex items-center justify-center disabled:opacity-50"
                    aria-label="Remove selected media"
                  >
                    <FiX />
                  </button>
                  {selectedMediaType === "video" ? (
                    <video src={preview} controls className="w-full max-h-[420px] bg-black object-contain" />
                  ) : (
                    <img src={preview} alt="Upload preview" className="w-full max-h-[420px] object-contain bg-black" />
                  )}
                </div>
              ) : (
                <label className={`h-28 border border-dashed border-gray-700 rounded-lg flex items-center justify-center gap-3 text-gray-400 cursor-pointer hover:border-gray-500 hover:text-white transition-colors ${
                  uploading ? "pointer-events-none opacity-60" : ""
                }`}>
                  <span className="w-10 h-10 rounded-full bg-[#151515] flex items-center justify-center text-xl">
                    {mode === "reel" ? <FiVideo /> : <FiPlus />}
                  </span>
                  <span className="text-sm">{mode === "reel" ? "Choose a video reel" : "Add photo/video or share text only"}</span>
                  <input
                    type="file"
                    accept={mode === "reel" ? "video/*" : "image/*,video/*"}
                    onChange={handleFileChange}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              )}

              {uploading || uploadProgress > 0 ? (
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-gray-300">Uploading {mode}</span>
                    <span className="text-gray-500">{uploadProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#171717]">
                    <div
                      className="h-full rounded-full bg-white transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <p className={`text-sm ${shouldAutoDismissStatus(message) ? "text-green-400" : "text-gray-500"}`}>
                {message || `${CAPTION_LIMIT - caption.length} characters left`}
              </p>
            </div>
          </form>
        </div>
      ) : null}

      {shareItem ? (
        <div className="vybe-create-overlay fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="w-full sm:max-w-[420px] max-h-[82vh] overflow-hidden rounded-t-2xl sm:rounded-lg border-t sm:border border-gray-800 bg-[#050505] text-white">
            <div className="h-14 px-4 flex items-center justify-between border-b border-gray-900">
              <div className="min-w-0">
                <p className="font-semibold">Share {getContentTypeLabel(shareItem)}</p>
                <p className="text-xs text-gray-500 truncate">
                  @{shareItem.author?.userName || "vybe_user"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShareItem(null);
                  setShareUsers([]);
                }}
                className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center"
                aria-label="Close share"
              >
                <FiX />
              </button>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={shareSearch}
                  onChange={(event) => setShareSearch(event.target.value)}
                  placeholder="Search users"
                  className="w-full h-11 rounded-lg bg-[#101010] border border-gray-900 pl-10 pr-3 text-sm text-white outline-none placeholder:text-gray-600"
                />
              </div>

              <div className="max-h-[48vh] overflow-y-auto flex flex-col gap-2 pr-1">
                {shareSearchLoading ? (
                  <p className="py-8 text-center text-sm text-gray-500">Loading users...</p>
                ) : visibleShareUsers.length > 0 ? (
                  visibleShareUsers.map((shareUser) => (
                    <div
                      key={shareUser._id}
                      className="min-h-14 rounded-lg border border-gray-900 bg-[#080808] px-3 py-2 flex items-center gap-3"
                    >
                      <img
                        src={mediaUrl(shareUser.profileImage) || dp}
                        alt={shareUser.userName}
                        className="w-10 h-10 rounded-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = dp;
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{shareUser.userName}</span>
                          {shareUser.isVerified ? <VerifiedBadge /> : null}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{shareUser.name || "Vybe user"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => shareContentToUser(shareUser)}
                        disabled={Boolean(sharingUserId)}
                        className="h-9 px-3 rounded-md bg-white text-black text-sm font-semibold disabled:opacity-50"
                      >
                        {sharingUserId === shareUser._id ? "Sending" : "Send"}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-gray-500">
                    No connected users found.
                  </p>
                )}
              </div>

              {shareStatus ? (
                <p className={`mt-3 text-sm ${shareStatus.includes("Shared") ? "text-green-400" : "text-red-400"}`}>
                  {shareStatus}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {selectedProfileItem ? (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center px-0 sm:px-4 text-white"
          onClick={() => {
            setSelectedProfileItem(null);
            setFocusedNotificationTarget(null);
          }}
        >
          <div
            ref={selectedProfileItemModalRef}
            className="relative w-full max-w-[620px] max-h-[94vh] overflow-y-auto bg-[#050505] sm:border border-gray-800 sm:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 h-14 px-4 flex items-center justify-between border-b border-gray-900 bg-[#050505]/95">
              <button
                type="button"
                onClick={() => openProfile(selectedProfileItem.author)}
                className="min-w-0 flex items-center gap-3 text-left"
              >
                <img
                  src={mediaUrl(selectedProfileItem.author?.profileImage) || dp}
                  alt={selectedProfileItem.author?.userName || "profile"}
                  className="w-9 h-9 rounded-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = dp;
                  }}
                />
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">{selectedProfileItem.author?.userName || "vybe_user"}</span>
                    {selectedProfileItem.author?.isVerified ? <VerifiedBadge /> : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedProfileItem.type === "reel" ? "Reel" : "Post"}
                  </p>
                </div>
              </button>

              <div className="relative flex items-center gap-2">
                {selectedProfileItemIsOwn ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setProfileItemMenuOpen((open) => !open)}
                      className="w-9 h-9 rounded-full bg-[#111] text-gray-300 hover:text-white flex items-center justify-center"
                      aria-label="Profile media options"
                      aria-expanded={profileItemMenuOpen}
                    >
                      <FiMoreVertical />
                    </button>
                    {profileItemMenuOpen ? (
                      <div className="absolute right-11 top-10 z-20 w-48 overflow-hidden rounded-lg border border-gray-800 bg-[#080808] shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setProfileItemMenuOpen(false);
                            handleDeleteContent(selectedProfileItem);
                          }}
                          disabled={selectedProfileItemDeletePending}
                          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-red-400 hover:bg-[#141414] disabled:opacity-50"
                        >
                          <FiTrash2 />
                          {selectedProfileItemDeletePending ? "Deleting..." : `Delete ${selectedProfileItem.type === "reel" ? "reel" : "post"}`}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfileItem(null);
                    setFocusedNotificationTarget(null);
                  }}
                  className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center"
                  aria-label="Close profile media"
                >
                  <FiX />
                </button>
              </div>
            </div>

            <div className="bg-black flex items-center justify-center">
              {selectedProfileItemIsTextPost ? (
                <div className="flex min-h-[320px] w-full items-center justify-center bg-[#080808] px-8 py-12">
                  <p className="max-w-2xl whitespace-pre-wrap break-words text-center text-3xl font-semibold leading-snug text-white">
                    {selectedProfileItem.caption}
                  </p>
                </div>
              ) : selectedProfileItem.mediaType === "video" ? (
                <video
                  src={mediaUrl(selectedProfileItem.media)}
                  controls
                  autoPlay
                  playsInline
                  onError={() => markBrokenMedia(selectedProfileItem)}
                  className="w-full max-h-[72vh] bg-black object-contain"
                />
              ) : (
                <img
                  src={mediaUrl(selectedProfileItem.media)}
                  alt={selectedProfileItem.caption || "Profile media"}
                  onError={() => markBrokenMedia(selectedProfileItem)}
                  className="w-full max-h-[72vh] object-contain bg-black"
                />
              )}
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>{selectedProfileItem.likes?.length || 0} likes</span>
                <div className="flex items-center gap-3">
                  <span>{selectedProfileItem.comments?.length || 0} comments</span>
                  <button
                    type="button"
                    onClick={() => openShareSheet(selectedProfileItem)}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                  >
                    <FiSend /> Share
                  </button>
                </div>
              </div>

              {selectedProfileItem.caption && !selectedProfileItemIsTextPost ? (
                <p className="mt-3 text-sm">
                  <span className="mr-2 inline-flex max-w-full items-center gap-1 align-bottom font-semibold text-white">
                    <span className="truncate">{selectedProfileItem.author?.userName || "vybe_user"}</span>
                    {selectedProfileItem.author?.isVerified ? <VerifiedBadge /> : null}
                  </span>
                  <span className="text-gray-300">{selectedProfileItem.caption}</span>
                </p>
              ) : null}

              <div className="mt-4 border-t border-gray-900 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Comments</p>
                  {selectedProfileItem.comments?.length > 0 ? (
                    <p className="text-xs text-gray-600">
                      {selectedProfileItem.comments.length} total
                    </p>
                  ) : null}
                </div>

                {selectedProfileItem.comments?.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto pr-1 flex flex-col gap-3">
                    {selectedProfileItem.comments
                      .map((comment) => renderCommentThread(selectedProfileItem, comment, { replyLimit: 2 }))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No comments yet.</p>
                )}

                {renderCommentComposer(selectedProfileItem)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedStory ? (
        <div
          data-vybe-story-viewer
          className="fixed inset-0 z-50 bg-[#0f1216] flex justify-center text-white"
          onClick={closeStoryViewer}
        >
          <div
            className="relative w-full max-w-[560px] min-h-screen bg-[#111418] flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-3 pt-4">
              <div className="flex gap-1">
                {selectedStoryStack.map((story, index) => {
                  const segmentProgress =
                    index < selectedStoryIndexInStack
                      ? 100
                      : index === selectedStoryIndexInStack
                        ? selectedStoryProgress
                        : 0;

                  return (
                    <div
                      key={story._id}
                      className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden"
                    >
                      <div
                        className="h-full rounded-full bg-white transition-all duration-500"
                        style={{ width: `${segmentProgress}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-16 px-4 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={mediaUrl(selectedStory.author?.profileImage) || dp}
                  alt={selectedStory.author?.userName || "story"}
                  className="w-11 h-11 rounded-full object-cover border border-white/10"
                  onError={(event) => {
                    event.currentTarget.src = dp;
                  }}
                />
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1 text-white text-[15px] font-semibold">
                    <span className="truncate">{selectedStory.author?.userName || "Story"}</span>
                    {selectedStory.author?.isVerified ? <VerifiedBadge /> : null}
                    <span className="ml-2 text-gray-400 font-normal">
                      {getStoryAgeLabel(selectedStory, storyClock)}
                    </span>
                  </p>
                  <p className="text-gray-300 text-xs truncate">
                    Story · {getStoryTimeLeftLabel(selectedStory, storyClock)}
                  </p>
                </div>
              </div>

              <div className="relative flex items-center gap-1">
                <button
                  type="button"
                  className="w-9 h-9 rounded-full text-gray-300 hover:bg-white/10 flex items-center justify-center"
                  aria-label="Story options"
                  aria-expanded={storyMenuOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    setStoryMenuOpen((open) => !open);
                  }}
                >
                  <FiMoreVertical />
                </button>

                {storyMenuOpen ? (
                  <div
                    className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#171717] shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {selectedStory.author?._id === userData?._id ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteStory(selectedStory)}
                        className="w-full h-11 px-3 flex items-center gap-2 text-sm font-semibold text-red-300 hover:bg-white/10"
                      >
                        <FiTrash2 />
                        Delete story
                      </button>
                    ) : null}
                  <button
                    type="button"
                    onClick={closeStoryViewer}
                    className="w-full h-11 px-3 text-left text-sm text-gray-200 hover:bg-white/10"
                  >
                    Close
                  </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className="min-h-0 flex-1 flex items-center justify-center px-0 sm:px-6 py-4"
              onClick={(event) => {
                event.stopPropagation();

                if (event.target === event.currentTarget) {
                  closeStoryViewer();
                  return;
                }

                const storyMedia = event.target.closest("[data-story-media]");
                if (!storyMedia) return;

                const bounds = storyMedia.getBoundingClientRect();
                const clickedRightSide = event.clientX > bounds.left + bounds.width / 2;

                if (clickedRightSide) {
                  openStoryByOffset(1);
                }
              }}
            >
              {storyMediaError || !selectedStory.media ? (
                <div
                  data-story-media
                  className="w-full max-h-[calc(100vh-190px)] min-h-[320px] flex flex-col items-center justify-center gap-3 bg-black/30 text-center px-8"
                >
                  <FiImage className="text-4xl text-gray-500" />
                  <div>
                    <p className="text-sm font-semibold text-white">Story media is not available.</p>
                    <p className="mt-1 text-xs text-gray-400">
                      The upload saved, but the hosted media file could not load.
                    </p>
                  </div>
                </div>
              ) : selectedStory.mediaType === "video" ? (
                <video
                  src={mediaUrl(selectedStory.media)}
                  controls
                  autoPlay
                  playsInline
                  data-story-media
                  onLoadedData={() => setStoryMediaError(false)}
                  onError={() => setStoryMediaError(true)}
                  className="w-full max-h-[calc(100vh-190px)] bg-black object-contain"
                />
              ) : (
                <img
                  src={mediaUrl(selectedStory.media)}
                  alt="Story"
                  data-story-media
                  onLoad={() => setStoryMediaError(false)}
                  onError={() => setStoryMediaError(true)}
                  className="w-full max-h-[calc(100vh-190px)] object-contain"
                />
              )}
            </div>

            <div className="px-4 pb-6 pt-2">
              {storyReplyStatus ? (
                <p className="mb-2 px-1 text-xs text-gray-400">{storyReplyStatus}</p>
              ) : null}

              <div className="flex items-center gap-3">
                <form onSubmit={handleStoryReplySubmit} className="min-w-0 flex-1">
                  <input
                    value={storyReplyText}
                    onChange={(event) => setStoryReplyText(event.target.value)}
                    placeholder={
                      selectedStory.author?._id === userData?._id
                        ? `${selectedStory.viewers?.length || 0} views`
                        : "Send message"
                    }
                    disabled={selectedStory.author?._id === userData?._id || storyReplySending}
                    className="w-full h-12 rounded-full bg-transparent border border-white/40 px-5 text-white outline-none placeholder:text-white disabled:text-gray-500 disabled:placeholder:text-gray-500"
                    maxLength={500}
                  />
                </form>
                <button
                  type="button"
                  onClick={toggleStoryLike}
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-3xl ${
                    selectedStoryLiked ? "text-red-500" : "text-white"
                  }`}
                  aria-label="Like story"
                >
                  {selectedStoryLiked ? <FaHeart /> : <FaRegHeart />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (storyReplyText.trim()) {
                      handleStoryReplySubmit({ preventDefault: () => {} });
                    }
                  }}
                  className="w-11 h-11 rounded-full flex items-center justify-center text-3xl text-white"
                  aria-label="Send story reply"
                >
                  {storyReplyText.trim() ? <FiSend /> : <FiMessageCircle />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {connectionsPanel.open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
          onClick={closeConnectionsPanel}
        >
          <div
            className="w-full max-h-[82vh] overflow-hidden rounded-t-2xl border-t border-gray-800 bg-black text-white shadow-2xl sm:max-w-[420px] sm:rounded-lg sm:border"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b border-gray-900 px-4">
              <div className="min-w-0">
                <h2 className="font-semibold">
                  {connectionsPanel.type === "following" ? "Following" : "Followers"}
                </h2>
                <p className="truncate text-xs text-gray-500">
                  {connectionsPanel.owner?.userName || connectionsPanel.owner?.name || "Profile"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConnectionsPanel}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-[#111] hover:text-white"
                aria-label="Close connections"
              >
                <FiX />
              </button>
            </div>

            <div className="max-h-[calc(82vh-56px)] overflow-y-auto p-2">
              {connectionsPanel.loading ? (
                <div className="py-12 text-center text-sm text-gray-500">Loading...</div>
              ) : connectionsPanel.error ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  {connectionsPanel.error}
                </div>
              ) : connectionsPanel.users.length > 0 ? (
                connectionsPanel.users.map((connectionUser) => {
                  const connectionIsSelf = isSameId(connectionUser._id, userData?._id);
                  const connectionIsFollowing = mobileFollowingIds.has(connectionUser._id);
                  const canRemoveFollower =
                    connectionsOwnerIsCurrentUser &&
                    connectionsPanel.type === "followers" &&
                    !connectionIsSelf;
                  const canToggleConnectionFollow =
                    !connectionIsSelf &&
                    !(connectionsOwnerIsCurrentUser && connectionsPanel.type === "followers");
                  const connectionFollowsMe = mobileFollowerIds.has(connectionUser._id);
                  const actionLabel = canRemoveFollower
                    ? "Remove"
                    : connectionIsFollowing
                      ? "Following"
                      : connectionFollowsMe
                        ? "Follow Back"
                        : "Follow";

                  return (
                    <div
                      key={connectionUser._id}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-3 hover:bg-[#101010]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          closeConnectionsPanel();
                          openProfile(connectionUser);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <img
                          src={mediaUrl(connectionUser.profileImage) || dp}
                          alt={connectionUser.userName || "Profile"}
                          className="h-11 w-11 shrink-0 rounded-full object-cover"
                          onError={(event) => {
                            event.currentTarget.src = dp;
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
                            <span className="truncate">{connectionUser.userName}</span>
                            {connectionUser.isVerified ? <VerifiedBadge /> : null}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {connectionUser.name || "Open profile"}
                          </p>
                        </div>
                      </button>

                      {canRemoveFollower || canToggleConnectionFollow ? (
                        <button
                          type="button"
                          onClick={() =>
                            canRemoveFollower
                              ? handleRemoveFollower(connectionUser)
                              : handleConnectionFollow(connectionUser)
                          }
                          disabled={connectionsBusyUserId === connectionUser._id}
                          className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold disabled:opacity-60 ${
                            canRemoveFollower
                              ? "bg-[#171717] text-red-300"
                              : connectionIsFollowing
                                ? "bg-[#171717] text-gray-300"
                                : "bg-white text-black"
                          }`}
                        >
                          {connectionsBusyUserId === connectionUser._id ? "..." : actionLabel}
                        </button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-sm text-gray-500">
                  No {connectionsPanel.type} yet.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {mobileSettingsOpen ? (
        <div className="vybe-settings-overlay fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="vybe-settings-sheet w-full sm:max-w-[420px] max-h-[92svh] overflow-y-auto bg-[#050505] border-t sm:border border-gray-800 rounded-t-2xl sm:rounded-lg text-white">
            <div className="h-14 px-4 flex items-center justify-between border-b border-gray-900">
              <h2 className="font-semibold">Settings</h2>
              <button
                type="button"
                onClick={() => setMobileSettingsOpen(false)}
                className="w-9 h-9 flex items-center justify-center text-gray-400"
                aria-label="Close mobile settings"
              >
                <FiX />
              </button>
            </div>

            <form onSubmit={handleMobileSaveProfile} className="p-4 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-[#171717]">
                  <img
                    src={mediaUrl(mobileProfileImage) || dp}
                    alt="Profile preview"
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = dp;
                    }}
                  />
                  <label className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <FiCamera />
                    <input type="file" accept="image/*" onChange={handleMobileAvatarChange} className="hidden" />
                  </label>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{userData?.userName}</p>
                  <p className="text-sm text-gray-500 truncate">Edit your mobile profile settings.</p>
                </div>
              </div>

              <input
                value={mobileName}
                onChange={(event) => setMobileName(event.target.value)}
                placeholder="Name"
                className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none"
                required
              />
              <input
                value={mobileUserName}
                onChange={(event) => setMobileUserName(event.target.value)}
                placeholder="Username"
                className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none"
                required
              />

              <div className="border-t border-gray-900 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center text-lg shrink-0">
                      {theme === "light" ? <FiSun /> : <FiMoon />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">Bright mode</p>
                      <p className="text-xs text-gray-500 truncate">Switch Vybe between dark and bright.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                    className={`w-12 h-7 rounded-full p-1 transition-colors ${
                      theme === "light" ? "bg-blue-600" : "bg-gray-700"
                    }`}
                    aria-pressed={theme === "light"}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                        theme === "light" ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <AdminVerificationPanel userData={userData} />

              <div className="border-t border-gray-900 pt-4 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (mobilePasswordPanelOpen) return;
                    setMobilePasswordPanelOpen(true);
                    setMobilePasswordStatus("");
                  }}
                  className="flex items-center gap-3 rounded-md text-left hover:bg-[#111]"
                  aria-expanded={mobilePasswordPanelOpen}
                >
                  <span className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center text-lg shrink-0">
                    <FiLock />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">Change password</p>
                    <p className="text-xs text-gray-500 truncate">Use current password before changing.</p>
                  </div>
                </button>

                {!mobilePasswordPanelOpen && mobilePasswordStatus ? (
                  <p className={`text-sm ${mobilePasswordStatus === "Password changed successfully." ? "text-green-400" : "text-gray-500"}`}>
                    {mobilePasswordStatus}
                  </p>
                ) : null}

                {!mobilePasswordPanelOpen ? (
                  <button
                    type="button"
                    onClick={handleMobileForgotPassword}
                    className="h-11 rounded-md bg-[#111] text-blue-400 font-semibold"
                  >
                    Forgot password
                  </button>
                ) : (
                  <>
                    <input
                      type="password"
                      value={mobileCurrentPassword}
                      onChange={(event) => setMobileCurrentPassword(event.target.value)}
                      placeholder="Current password"
                      className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none placeholder:text-gray-600"
                    />
                    <input
                      type="password"
                      value={mobileNewPassword}
                      onChange={(event) => setMobileNewPassword(event.target.value)}
                      placeholder="New password"
                      className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none placeholder:text-gray-600"
                    />
                    <input
                      type="password"
                      value={mobileConfirmPassword}
                      onChange={(event) => setMobileConfirmPassword(event.target.value)}
                      placeholder="Confirm password"
                      className="h-11 rounded-md bg-[#111] border border-gray-800 px-3 text-white outline-none placeholder:text-gray-600"
                    />

                    <p className={`text-sm ${mobilePasswordStatus === "Password changed successfully." ? "text-green-400" : "text-gray-500"}`}>
                      {mobilePasswordStatus || "Forgot password is available on the sign-in screen."}
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setMobilePasswordPanelOpen(false);
                          setMobileCurrentPassword("");
                          setMobileNewPassword("");
                          setMobileConfirmPassword("");
                          setMobilePasswordStatus("");
                        }}
                        className="h-11 rounded-md bg-[#111] text-gray-300 font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleMobileChangePassword}
                        disabled={mobilePasswordSaving}
                        className="h-11 rounded-md bg-[#171717] text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <FiLock /> {mobilePasswordSaving ? "Changing" : "Save"}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <p className={`text-sm ${mobileSettingsStatus === "Profile updated." ? "text-green-400" : "text-gray-500"}`}>
                {mobileSettingsStatus || "Profile settings are available on mobile now."}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="submit"
                  disabled={mobileSaving}
                  className="h-11 rounded-md bg-white text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <FiSave /> {mobileSaving ? "Saving" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleMobileLogout}
                  className="h-11 rounded-md bg-[#171717] text-red-400 font-semibold flex items-center justify-center gap-2"
                >
                  <FiLogOut /> Logout
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {activeMobileChatListUser ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/45 lg:hidden"
          onClick={() => setMobileChatListMenuUserId("")}
        >
          <div
            className="w-full rounded-t-[28px] border-t border-gray-800 bg-[#070707] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-700" />

            <div className="mb-3 flex items-center gap-3 rounded-3xl border border-gray-900 bg-[#101010] p-3">
              <img
                src={mediaUrl(activeMobileChatListUser.profileImage) || dp}
                alt={activeMobileChatListUser.userName}
                className="h-12 w-12 rounded-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = dp;
                }}
              />
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white">
                  <span className="truncate">{activeMobileChatListUser.userName}</span>
                  {activeMobileChatListUser.isVerified ? <VerifiedBadge /> : null}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {getChatPreviewText(
                    activeMobileChatListUser,
                    activeMobileChatListUser.pendingConnection
                      ? "Pending connection"
                      : "Conversation options"
                  )}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-gray-900 bg-[#101010]">
              <button
                type="button"
                onClick={() => {
                  setMobileChatListMenuUserId("");
                  openMobileChat(activeMobileChatListUser);
                }}
                className="flex h-12 w-full items-center justify-between px-4 text-left text-sm font-semibold text-white active:bg-white/5"
              >
                <span>Open chat</span>
                <FiMessageCircle className="text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileChatListMenuUserId("");
                  openProfile(activeMobileChatListUser);
                }}
                className="flex h-12 w-full items-center justify-between border-t border-gray-900 px-4 text-left text-sm font-semibold text-white active:bg-white/5"
              >
                <span>View profile</span>
                <FiUser className="text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => deleteMobileConversation(activeMobileChatListUser._id)}
                className="flex h-12 w-full items-center justify-between border-t border-gray-900 px-4 text-left text-sm font-semibold text-red-300 active:bg-red-500/10"
              >
                <span>Delete conversation</span>
                <FiTrash2 className="text-red-300" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setMobileChatListMenuUserId("")}
              className="mt-3 h-11 w-full rounded-2xl bg-[#151515] text-sm font-semibold text-gray-200 active:bg-[#202020]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {activeMobileActionMessage ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/45 lg:hidden"
          onClick={() => setMobileMessageMenuId("")}
        >
          <div
            className="w-full rounded-t-[28px] border-t border-gray-800 bg-[#070707] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-700" />

            <div className="mb-3 rounded-3xl border border-gray-900 bg-[#101010] p-2">
              <div className="flex items-center justify-center gap-1.5">
                {REACTION_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => reactToMobileMessage(activeMobileActionMessage._id, emoji)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-xl active:bg-white/10"
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-gray-900 bg-[#101010]">
              <button
                type="button"
                onClick={() => {
                  setMobileReplyToMessage(activeMobileActionMessage);
                  setMobileMessageMenuId("");
                }}
                className="flex h-12 w-full items-center justify-between px-4 text-left text-sm font-semibold text-white active:bg-white/5"
              >
                <span>Reply</span>
                <FiMessageCircle className="text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => deleteMobileMessage(activeMobileActionMessage._id, "me")}
                className="flex h-12 w-full items-center justify-between border-t border-gray-900 px-4 text-left text-sm font-semibold text-white active:bg-white/5"
              >
                <span>Delete for me</span>
                <FiTrash2 className="text-gray-400" />
              </button>

              {activeMobileActionMine ? (
                <button
                  type="button"
                  onClick={() => deleteMobileMessage(activeMobileActionMessage._id, "everyone")}
                  className="flex h-12 w-full items-center justify-between border-t border-gray-900 px-4 text-left text-sm font-semibold text-red-300 active:bg-red-500/10"
                >
                  <span>Delete for everyone</span>
                  <FiTrash2 className="text-red-300" />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setMobileMessageMenuId("")}
              className="mt-3 h-11 w-full rounded-2xl bg-[#151515] text-sm font-semibold text-gray-200 active:bg-[#202020]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {chatMediaViewer && activeChatMedia ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-3"
          onClick={() => setChatMediaViewer(null)}
        >
          <div
            className="relative flex h-full w-full max-w-5xl flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 items-center justify-between text-white">
              <p className="text-sm font-semibold text-gray-300">
                {chatMediaViewer.index + 1} / {chatMediaTotal}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadMediaFile(
                      activeChatMedia.media,
                      activeChatMedia.mediaType,
                      `vybe-chat-${activeChatMedia.mediaType}-${chatMediaViewer.index + 1}`
                    ).catch(() => setMobileChatStatus("Download failed."))
                  }
                  className="flex h-10 items-center gap-2 rounded-full bg-white px-3 text-sm font-semibold text-black"
                  aria-label="Download media"
                >
                  <FiDownload /> Download
                </button>
                <button
                  type="button"
                  onClick={() => setChatMediaViewer(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                  aria-label="Close media"
                >
                  <FiX />
                </button>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <div className="flex h-full items-center justify-center">
                {activeChatMedia.mediaType === "video" ? (
                  <video
                    src={mediaUrl(activeChatMedia.media)}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-full max-w-full rounded-md bg-black object-contain"
                  />
                ) : (
                  <img
                    src={mediaUrl(activeChatMedia.media)}
                    alt="Opened chat media"
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                )}
              </div>

              {chatMediaTotal > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => showChatMediaStep(-1)}
                    className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
                    aria-label="Previous media"
                  >
                    <FiChevronLeft className="text-2xl" />
                  </button>
                  <button
                    type="button"
                    onClick={() => showChatMediaStep(1)}
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
                    aria-label="Next media"
                  >
                    <FiChevronRight className="text-2xl" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!hideMobileChatNav ? <div className="vybe-mobile-bottom-fill lg:hidden" /> : null}

      <div
        className={`vybe-mobile-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-900 ${
          hideMobileChatNav ? "hidden" : "grid grid-cols-5"
        }`}
      >
        <button
          type="button"
          onClick={refreshHomeFeed}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "home" ? "text-white" : "text-gray-500"
          }`}
        >
          <FiHome className="text-xl" />
          <span className="text-xs font-semibold">Home</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveMobileTab("search");
            setCreateOpen(false);
            setSelectedStory(null);
            setSelectedProfileItem(null);
            setMessage("");
            requestAnimationFrame(() => feedSearchInputRef.current?.focus());
          }}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "search" ? "text-white" : "text-gray-500"
          }`}
        >
          <FiSearch className="text-xl" />
          <span className="text-xs font-semibold">Search</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileTab("reels")}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "reels" ? "text-white" : "text-gray-500"
          }`}
        >
          <FiVideo className="text-xl" />
          <span className="text-xs font-semibold">Reels</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileTab("chat")}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "chat" ? "text-white" : "text-gray-500"
          }`}
        >
          <span className="relative">
            <FiMessageCircle className="text-xl" />
            {totalMobileUnreadCount > 0 ? (
              <span className="absolute -top-2 -right-3 min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center">
                {formatUnreadCount(totalMobileUnreadCount)}
              </span>
            ) : null}
          </span>
          <span className="text-xs font-semibold">Chat</span>
        </button>
        <button
          type="button"
          onClick={() => openProfile(userData)}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "profile" ? "text-white" : "text-gray-500"
          }`}
        >
          <span
            className={`w-6 h-6 rounded-full overflow-hidden border ${
              activeMobileTab === "profile" ? "border-white" : "border-gray-700"
            }`}
          >
            <img
              src={mediaUrl(userData?.profileImage) || dp}
              alt="Profile"
              className="w-full h-full object-cover"
              onError={(event) => {
                event.currentTarget.src = dp;
              }}
            />
          </span>
          <span className="text-xs font-semibold">Profile</span>
        </button>
      </div>
    </div>
  );
}

export default Feed;
