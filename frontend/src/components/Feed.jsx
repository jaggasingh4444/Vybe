import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import dp from "../assets/dp.png";
import { FaHeart, FaRegBookmark, FaRegComment, FaRegHeart } from "react-icons/fa6";
import { FiArrowLeft, FiBell, FiCamera, FiChevronLeft, FiChevronRight, FiDownload, FiHome, FiImage, FiLock, FiLogOut, FiMessageCircle, FiMoreVertical, FiPlus, FiSave, FiSearch, FiSend, FiSettings, FiSmile, FiTrash2, FiUser, FiVideo, FiX } from "react-icons/fi";
import { apiUrl, mediaUrl } from "../config/api";
import { logout, setUserData } from "../redux/userSlice";
import { getTabAuthHeaders, markTabLoggedOut, withTabAuth } from "../utils/tabAuth";
import { downloadMediaFile } from "../utils/mediaDownload";

const MAX_MEDIA_SIZE = 10 * 1024 * 1024;
const MESSAGE_TIMEOUT_MS = 12000;
const EMOJI_OPTIONS = ["😀", "😂", "😍", "🔥", "❤️", "🙌", "👏", "😎", "🥹", "👍", "✨", "💯"];
const REACTION_OPTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "👍"];
const STORY_EXPIRY_MS = 24 * 60 * 60 * 1000;
const STORY_VIEW_DURATION_MS = 7000;
const STATUS_AUTO_DISMISS_MS = 1800;
const CAPTION_LIMIT = 500;
const TYPING_IDLE_MS = 1400;
const TYPING_REFRESH_MS = 2000;
const TYPING_VISIBLE_MS = 3000;
const formatUnreadCount = (count) => (count > 10 ? "10+" : count);
const shouldAutoDismissStatus = (status) => /\b(uploaded|deleted)\b/i.test(status || "");
const getContentKey = (item) => (item?._id && item?.type ? `${item.type}-${item._id}` : "");
const getReplyKey = (item, commentId) => `${getContentKey(item)}-${commentId}-reply`;
const isTextPost = (item) => item?.type === "post" && item?.mediaType === "text";
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

function Feed() {
  const { suggestedUsers, userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();
  const displayName = userData?.name || userData?.userName || "Friend";

  const [mode, setMode] = useState("post");
  const [caption, setCaption] = useState("");
  const [captionEmojiOpen, setCaptionEmojiOpen] = useState(false);
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
  const [stories, setStories] = useState([]);
  const [selectedStory, setSelectedStory] = useState(null);
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
  const [mobileReactionMenuMessageId, setMobileReactionMenuMessageId] = useState("");
  const [mobileMessageMenuId, setMobileMessageMenuId] = useState("");
  const [chatMediaViewer, setChatMediaViewer] = useState(null);
  const [mobileTypingUserIds, setMobileTypingUserIds] = useState(() => new Set());
  const [mobileBusyUserId, setMobileBusyUserId] = useState("");
  const [mobileConversationMenuOpen, setMobileConversationMenuOpen] = useState(false);
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
  const [shareStatus, setShareStatus] = useState("");
  const [sharingUserId, setSharingUserId] = useState("");
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [feedVideosMuted, setFeedVideosMuted] = useState(true);
  const feedRootRef = useRef(null);
  const feedVideosMutedRef = useRef(true);
  const pendingLikeIdsRef = useRef(new Set());
  const pendingCommentIdsRef = useRef(new Set());
  const pendingReplyIdsRef = useRef(new Set());
  const pendingContentDeleteIdsRef = useRef(new Set());
  const pendingCommentDeleteIdsRef = useRef(new Set());
  const mobileMessagesListRef = useRef(null);
  const mobileMessageMediaInputRef = useRef(null);
  const mobileOutgoingTypingRef = useRef({ receiverId: "", active: false, lastSentAt: 0 });
  const mobileStopTypingTimeoutRef = useRef(null);
  const mobileIncomingTypingTimeoutsRef = useRef(new Map());
  const notificationMenuRef = useRef(null);
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

    if (files.some((file) => file.size > MAX_MEDIA_SIZE)) {
      setMobileChatStatus("Each chat media must be under 10 MB.");
      return;
    }

    if (mobileMessageMedia.length + files.length > 6) {
      setMobileChatStatus("You can send up to 6 photos or videos at once.");
      return;
    }

    try {
      const mediaItems = await Promise.all(
        files.map(async (file) => ({
          media: await readFileAsDataUrl(file),
          mediaType: file.type.startsWith("video/") ? "video" : "image",
          name: file.name,
        }))
      );
      setMobileChatEmojiOpen(false);
      setMobileMessageMedia((current) => [...current, ...mediaItems]);
    } catch {
      setMobileChatStatus("Unable to read media.");
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

  const fetchStories = async () => {
    try {
      const res = await fetch(apiUrl("/api/content/stories"), {
        credentials: "include",
      });

      if (!res.ok) return;

      const data = await res.json();
      setStories(data.filter((story) => isStoryActive(story)));
    } catch {
      setStories([]);
    }
  };

  const fetchMobileChatUsers = async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/users"), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) return;

      const data = await res.json();
      setMobileChatUsers(data);
    } catch {
      setMobileChatStatus("Unable to load chats.");
    }
  };

  const fetchMobileMessages = async (userId) => {
    try {
      const res = await fetch(apiUrl(`/api/chat/${userId}/messages`), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) throw new Error("Failed to load messages");

      const data = await res.json();
      setMobileMessages(data);
    } catch {
      setMobileChatStatus("Unable to load messages.");
    }
  };

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
    const query = feedSearch.trim();

    if (!query || activeMobileTab === "chat" || activeMobileTab === "profile") {
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

        if (data.type === "messages:seen") {
          markMobileMessagesSeen(data.messageIds, data.readAt);
          fetchMobileChatUsers();
          return;
        }

        if (data.type === "conversation:delete") {
          const selectedId = selectedMobileChat?._id;
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

        const selectedId = selectedMobileChat?._id;
        const currentUserId = userData?._id;
        const belongsToOpenChat =
          selectedId &&
          currentUserId &&
          [incoming.sender?._id, incoming.receiver?._id].includes(selectedId) &&
          [incoming.sender?._id, incoming.receiver?._id].includes(currentUserId);

        if (belongsToOpenChat) {
          if (incoming.receiver?._id === currentUserId) {
            fetchMobileMessages(selectedId);
          } else {
            setMobileMessages((current) => {
              if (current.some((item) => item._id === incoming._id)) return current;
              return [...current, incoming];
            });
          }
        }

        fetchMobileChatUsers();
      } catch {
        fetchMobileChatUsers();
      }
    };

    events.onerror = () => {
      events.close();
    };

    return () => events.close();
  }, [isMobile, selectedMobileChat?._id, setMobileTypingIndicator, userData?._id]);

  useEffect(() => {
    const handleSidebarAction = (event) => {
      const action = event.detail?.action;

      if (action === "home") {
        setActiveMobileTab("home");
        setCreateOpen(false);
        setSelectedStory(null);
        setMessage("");
        requestAnimationFrame(() => {
          document.querySelector("[data-vybe-feed-root]")?.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        });
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
      behavior: "smooth",
    });
  }, [mobileMessages, selectedMobileChat?._id, selectedMobileChatTyping]);

  useEffect(() => {
    stopMobileOutgoingTyping();
    setMobileTypingUserIds(new Set());
    setMobileReactionMenuMessageId("");
    setMobileMessageMenuId("");
    setMobileReplyToMessage(null);
  }, [selectedMobileChat?._id, stopMobileOutgoingTyping]);

  useEffect(() => () => {
    stopMobileOutgoingTyping();
    mobileIncomingTypingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    mobileIncomingTypingTimeoutsRef.current.clear();
  }, [stopMobileOutgoingTyping]);

  useEffect(() => {
    setMobileConversationMenuOpen(false);
  }, [selectedMobileChat?._id]);

  const clearSelectedFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setSelectedFile(null);
    setPreview("");
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    clearSelectedFile();
    setCaptionEmojiOpen(false);
    setMessage("");
  };

  const addEmojiToCaption = (emoji) => {
    setCaption((currentCaption) => {
      if (currentCaption.length + emoji.length > 220) return currentCaption;
      return `${currentCaption}${emoji}`;
    });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMessage("");

    if (!file) return;

    if (file.size > MAX_MEDIA_SIZE) {
      setMessage("Please choose a file under 10 MB.");
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

    if (file.size > MAX_MEDIA_SIZE) {
      setMessage("Please choose a story under 10 MB.");
      return;
    }

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setMessage("Stories must be an image or video.");
      return;
    }

    setStoryUploading(true);
    setStoryUploadProgress(4);

    try {
      const media = await readFileAsDataUrl(file);
      const mediaType = file.type.startsWith("video/") ? "video" : "image";
      setStoryUploadProgress(8);

      const data = await uploadJsonWithProgress({
        url: apiUrl("/api/content/stories"),
        payload: { media, mediaType },
        onProgress: (progress) => setStoryUploadProgress(Math.max(8, progress)),
        errorMessage: "Story upload failed",
      });

      setStories((currentStories) => [
        data,
        ...currentStories.filter(
          (story) =>
            story._id !== data._id &&
            isStoryActive(story)
        ),
      ]);
      await fetchStories();
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
    setStoryMenuOpen(false);
    setStoryViewStartedAt(Date.now());
    setStoryViewerClock(Date.now());
    setStoryReplyText("");
    setStoryReplyStatus("");

    try {
      const res = await fetch(apiUrl(`/api/content/stories/${story._id}/view`), {
        method: "POST",
        credentials: "include",
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
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Story delete failed");

      setStories((currentStories) => currentStories.filter((item) => item._id !== storyId));
      setSelectedStory(null);
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
      const media = selectedFile ? await readFileAsDataUrl(selectedFile) : "";
      const uploadMode = selectedFile && selectedMediaType === "video" ? "reel" : "post";
      const endpoint = uploadMode === "reel" ? "/api/content/reels" : "/api/content/posts";
      const payload =
        uploadMode === "reel"
          ? { caption: trimmedCaption, media }
          : selectedFile
            ? { caption: trimmedCaption, media, mediaType: selectedMediaType }
            : { caption: trimmedCaption };
      setUploadProgress(8);

      const data = await uploadJsonWithProgress({
        url: apiUrl(endpoint),
        payload,
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

      if (withoutTemp.some((item) => item._id === message._id)) return withoutTemp;
      return [...withoutTemp, message];
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

      dispatch(setUserData(data.currentUser));
      setMobileChatUsers((currentUsers) =>
        currentUsers.map((user) =>
          user._id === data.targetUser._id ? data.targetUser : user
        )
      );
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

      dispatch(setUserData(data.currentUser));
      setFeedUserResults((currentUsers) =>
        currentUsers.map((user) =>
          user._id === data.targetUser._id ? data.targetUser : user
        )
      );
      setMobileChatUsers((currentUsers) =>
        currentUsers.map((user) =>
          user._id === data.targetUser._id ? data.targetUser : user
        )
      );
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
    setProfileStatus("");
    setProfileContentType("all");
  }, [openProfile, profileHistory, profileReturnTab]);

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

      dispatch(setUserData(data.currentUser));
      setProfileData((currentProfile) =>
        currentProfile?.user?._id === data.targetUser._id
          ? { ...currentProfile, user: data.targetUser }
          : currentProfile
      );
      setFeedUserResults((currentUsers) =>
        currentUsers.map((user) =>
          user._id === data.targetUser._id ? data.targetUser : user
        )
      );
      setMobileChatUsers((currentUsers) =>
        currentUsers.map((user) =>
          user._id === data.targetUser._id ? data.targetUser : user
        )
      );
    } catch (error) {
      setProfileStatus(error.message || "Follow failed.");
    } finally {
      setProfileBusy(false);
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
    const handleOpenSharedContent = (event) => {
      const sharedItem = event.detail?.item || sharedContentToFeedItem(event.detail?.sharedContent);
      if (sharedItem) {
        setSelectedProfileItem(sharedItem);
      }
    };

    const handleShareContent = (event) => {
      const sharedItem = event.detail?.item || sharedContentToFeedItem(event.detail?.sharedContent);
      if (sharedItem?.type === "reel") {
        setShareItem(sharedItem);
        setShareSearch("");
        setShareStatus("");
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
    setSelectedMobileChat(user);
    setMobileMessages([]);
    setMobileChatStatus("");
    setMobileConversationMenuOpen(false);
    setMobileChatEmojiOpen(false);
    setMobileMessageMedia([]);
    setMobileReactionMenuMessageId("");
    await fetchMobileMessages(user._id);
    await fetchMobileChatUsers();
  };

  const openShareSheet = (item) => {
    if (!item || item.type !== "reel") {
      setMessage("Only reels can be shared from here.");
      return;
    }

    setShareItem(item);
    setShareSearch("");
    setShareStatus("");
    fetchMobileChatUsers();
  };

  const shareReelToUser = async (targetUser) => {
    if (!shareItem?._id || !targetUser?._id || sharingUserId) return;

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
            text: `Shared a reel`,
            sharedContent: {
              type: "reel",
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

  const sendMobileMessage = async (event) => {
    event.preventDefault();
    const text = mobileMessageText.trim();
    const mediaPayload = mobileMessageMedia;
    const replyTarget = mobileReplyToMessage;
    if ((!text && mediaPayload.length === 0) || !selectedMobileChat) return;

    const receiver = selectedMobileChat;
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      _id: tempId,
      sender: userData,
      receiver,
      text,
      media: mediaPayload[0]?.media,
      mediaType: mediaPayload[0]?.mediaType,
      attachments: mediaPayload.map(({ media, mediaType }) => ({ media, mediaType })),
      replyTo: replyTarget ? createMessageReplySnapshot(replyTarget) : undefined,
      pending: true,
      createdAt: new Date().toISOString(),
    };

    setMobileMessages((current) => [...current, optimisticMessage]);
    setMobileMessageText("");
    setMobileMessageMedia([]);
    setMobileReplyToMessage(null);
    setMobileMessageMenuId("");
    setMobileChatStatus("");
    stopMobileOutgoingTyping(receiver._id);

    try {
      const { res, data } = await fetchJsonWithTimeout(
        apiUrl(`/api/chat/${receiver._id}/messages`),
        {
          method: "POST",
          credentials: "include",
          headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            text,
            attachments: mediaPayload.map(({ media, mediaType }) => ({ media, mediaType })),
            replyToMessageId: replyTarget?._id,
          }),
        },
        "Message is taking too long. Please try again."
      );

      if (!res.ok) throw new Error(data.message || "Message failed");

      saveConfirmedMobileMessage(data, tempId);
      setMobileChatEmojiOpen(false);
      await fetchMobileChatUsers();
    } catch (error) {
      markMobileMessageFailed(tempId);
      setMobileChatStatus(error.message || "Message failed.");
      setMobileMessageText(text);
      setMobileMessageMedia(mediaPayload);
      setMobileReplyToMessage(replyTarget);
    }
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

    setMobileReactionMenuMessageId("");

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

      setMobileMessages([]);
      setSelectedMobileChat(null);
      setMobileConversationMenuOpen(false);
      setMobileChatStatus("Conversation deleted.");
      await fetchMobileChatUsers();
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

  const unreadCount = notifications.filter((item) => !item.read).length;
  const baseVisibleFeed = activeMobileTab === "reels"
    ? feed.filter((item) => item.type === "reel")
    : feed;
  const normalizedFeedSearch = feedSearch.trim().toLowerCase();
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
  [...mobileChatUsers, ...suggestedUsers].forEach((candidate) => {
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
  const lastOwnSeenMobileMessageId = [...mobileMessages]
    .reverse()
    .find(
      (chatMessage) =>
        chatMessage.sender?._id === userData?._id &&
        chatMessage.read &&
        !chatMessage.pending &&
        !chatMessage.failed
    )?._id;
  const totalMobileUnreadCount = mobileChatUsers.reduce(
    (total, chatUser) =>
      total + (selectedMobileChat?._id === chatUser._id ? 0 : chatUser.unreadCount || 0),
    0
  );
  const activeProfileUser = profileData?.user;
  const activeProfileContent = profileData?.content || [];
  const visibleProfileContent = profileContentType === "all"
    ? activeProfileContent
    : activeProfileContent.filter((item) => item.type === profileContentType);
  const profilePostCount = activeProfileContent.filter((item) => item.type === "post").length;
  const profileReelCount = activeProfileContent.filter((item) => item.type === "reel").length;
  const viewingOwnProfile = activeProfileUser?._id === userData?._id;
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
  const canShareCreate =
    mode === "reel" ? Boolean(selectedFile && selectedMediaType === "video") : Boolean(selectedFile || caption.trim());

  const renderCommentThread = (item, comment, options = {}) => {
    const contentKey = getContentKey(item);
    const replyKey = getReplyKey(item, comment._id);
    const replyPending = pendingReplyIds.has(replyKey);
    const commentDeleteKey = `${contentKey}-${comment._id}`;
    const commentDeleting = pendingCommentDeleteIds.has(commentDeleteKey);
    const replies = comment.replies || [];
    const replyLimit = options.replyLimit || 1;
    const visibleReplies = replies.slice(-replyLimit);
    const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);
    const canDeleteComment =
      comment.author?._id === userData?._id || item.author?._id === userData?._id;

    return (
      <div
        key={comment._id || `${comment.author?._id}-${comment.createdAt}`}
        className={`group text-sm ${comment.pending || commentDeleting ? "opacity-70" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p>
              <span className="text-white font-semibold mr-2">{comment.author?.userName || "user"}</span>
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
            {visibleReplies.map((reply) => (
              <p
                key={reply._id || `${reply.author?._id}-${reply.createdAt}`}
                className={`text-xs ${reply.pending ? "opacity-70" : ""}`}
              >
                <span className="font-semibold text-gray-200 mr-2">{reply.author?.userName || "user"}</span>
                <span className="text-gray-400 break-words">{reply.text}</span>
                {reply.pending ? <span className="ml-2 text-gray-600">Sending...</span> : null}
              </p>
            ))}
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

    return (
      <div className="mt-2 w-64 max-w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 text-left">
        <button
          type="button"
          onClick={() => setSelectedProfileItem(sharedItem)}
          className="block w-full text-left"
        >
          <div className="flex gap-3 p-2">
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-black">
              {sharedItem.mediaType === "video" ? (
                <video src={mediaUrl(sharedItem.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                <img src={mediaUrl(sharedItem.media)} alt="Shared media" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <p className="text-xs font-semibold text-white">Shared reel</p>
              <p className="mt-1 truncate text-xs text-white/70">
                @{sharedItem.author?.userName || "vybe_user"}
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
      className={`w-full lg:flex-1 lg:max-w-[760px] bg-black relative border-x border-gray-900 ${
        isMobileChatTab ? "pb-0" : "pb-20"
      } lg:pb-0 ${
        isMobileChatTab
          ? "h-[100dvh] overflow-hidden"
          : isMobileReelFeed
          ? "h-[100vh] overflow-y-auto snap-y snap-mandatory"
          : "min-h-[100vh] lg:h-[100vh] lg:overflow-y-auto"
      }`}
    >
      <div className="sticky top-0 z-20 bg-black/95 border-b border-gray-900 px-5 py-4 flex items-center justify-between">
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
              <div className="absolute right-0 mt-3 w-[320px] max-h-[420px] overflow-y-auto rounded-lg border border-gray-800 bg-[#050505] shadow-2xl">
                <div className="px-4 py-3 border-b border-gray-900">
                  <p className="text-white font-semibold">Notifications</p>
                </div>
                {notifications.length > 0 ? (
                  notifications.map((notification) => {
                    const actorId = notification.actor?._id;
                    const isFollowNotification = notification.type === "follow";
                    const alreadyFollowingActor = actorId ? mobileFollowingIds.has(actorId) : false;

                    return (
                      <div key={notification._id} className="px-4 py-3 border-b border-gray-900 last:border-b-0">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => notification.actor && openProfile(notification.actor)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-sm text-gray-200">
                              <span className="font-semibold text-white">{notification.actor?.userName || "Someone"}</span>{" "}
                              {isFollowNotification
                                ? "followed you"
                                : `${notification.type === "like" ? "liked your" : "commented on your"} ${notification.contentType}.`}
                            </p>
                            {notification.text && !isFollowNotification ? (
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

      {activeMobileTab === "home" || activeMobileTab === "reels" ? (
        <div className="border-b border-gray-900 px-5 py-3">
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder={activeMobileTab === "reels" ? "Search reels or username" : "Search feed or username"}
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
                          <span className="block text-white text-sm font-semibold truncate">@{feedUser.userName}</span>
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
        activeMobileTab === "profile" ? "hidden" : activeMobileTab !== "home" ? "hidden lg:block" : ""
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
                    <span className="mt-2 w-full text-white text-sm font-semibold truncate">
                      {suggestedUser.userName}
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
        className={`max-w-[560px] mx-auto flex flex-col ${
          isMobileReelFeed
            ? "px-0 py-0 gap-0"
            : isMobileChatTab
              ? "h-[calc(100dvh-8.5rem)] px-3 py-3 gap-0 overflow-hidden"
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
                <div className="flex items-center gap-5">
                  <span className="relative shrink-0">
                    <img
                      src={mediaUrl(activeProfileUser.profileImage) || dp}
                      alt={activeProfileUser.userName || "Profile"}
                      className="w-24 h-24 rounded-full object-cover border border-gray-800"
                      onError={(event) => {
                        event.currentTarget.src = dp;
                      }}
                    />
                    {isUserOnline(activeProfileUser) ? (
                      <span className="absolute bottom-2 right-1 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-black" />
                    ) : null}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-white text-2xl font-bold truncate">
                      {activeProfileUser.userName}
                    </p>
                    <p className="text-gray-500 text-sm truncate">
                      {[activeProfileUser.name, isUserOnline(activeProfileUser) ? "Online" : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>

                    <div className="grid grid-cols-3 gap-2 mt-4">
                      <div>
                        <p className="text-white font-bold">{activeProfileContent.length}</p>
                        <p className="text-gray-500 text-xs">Posts</p>
                      </div>
                      <div>
                        <p className="text-white font-bold">{activeProfileUser.followers?.length || 0}</p>
                        <p className="text-gray-500 text-xs">Followers</p>
                      </div>
                      <div>
                        <p className="text-white font-bold">{activeProfileUser.following?.length || 0}</p>
                        <p className="text-gray-500 text-xs">Following</p>
                      </div>
                    </div>
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
                          if (isMobile) {
                            setActiveMobileTab("chat");
                            openMobileChat(activeProfileUser);
                            return;
                          }

                          window.dispatchEvent(
                            new CustomEvent("vybe:open-chat", {
                              detail: { user: activeProfileUser },
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
                    {visibleProfileContent.map((item) => (
                      <button
                        type="button"
                        key={`${item.type}-${item._id}`}
                        className="relative aspect-square bg-[#101010] overflow-hidden"
                        onClick={() => setSelectedProfileItem(item)}
                        title={item.caption || item.type}
                      >
                        {isTextPost(item) ? (
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
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={mediaUrl(item.media)}
                            alt={item.caption || "Profile post"}
                            className="w-full h-full object-cover"
                          />
                        )}
                        <div className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                          {item.type === "reel" ? "Reel" : "Post"}
                        </div>
                      </button>
                    ))}
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
              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-900 bg-[#050505]">
                <div className="relative h-14 shrink-0 px-3 flex items-center justify-between border-b border-gray-900">
                  <button
                    type="button"
                    onClick={() => openProfile(selectedMobileChat)}
                    className="flex items-center gap-3 min-w-0 text-left"
                  >
                    <span className="relative shrink-0">
                      <img
                        src={mediaUrl(selectedMobileChat.profileImage) || dp}
                        alt={selectedMobileChat.userName}
                        className="w-9 h-9 rounded-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = dp;
                        }}
                      />
                      {isUserOnline(selectedMobileChat) ? (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-black" />
                      ) : null}
                    </span>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{selectedMobileChat.userName}</p>
                      <p className="text-gray-500 text-xs truncate">
                        {isUserOnline(selectedMobileChat) ? "Online" : "Offline"}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileConversationMenuOpen((open) => !open)}
                      className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center"
                      aria-label="Conversation options"
                    >
                      <FiMoreVertical />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedMobileChat(null)}
                      className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center"
                      aria-label="Close chat"
                    >
                      <FiX />
                    </button>
                  </div>

                  {mobileConversationMenuOpen ? (
                    <div className="absolute right-3 top-12 z-10 w-52 rounded-lg border border-gray-800 bg-[#080808] p-1 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => deleteMobileConversation(selectedMobileChat._id)}
                        className="w-full h-10 rounded-md px-3 text-left text-sm text-red-400 hover:bg-[#151515]"
                      >
                        Delete conversation
                      </button>
                    </div>
                  ) : null}
                </div>

                <div
                  ref={mobileMessagesListRef}
                  className="min-h-0 flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-2 overscroll-contain"
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
                          className={`relative max-w-[82%] rounded-2xl text-sm ${
                            mediaOnly ? "p-0" : "px-3 py-2"
                          } ${
                            mediaOnly
                              ? `bg-transparent text-white ${mine ? "self-end" : "self-start"} ${
                                  chatMessage.pending ? "opacity-70" : ""
                                }`
                              : mine
                                ? `self-end bg-blue-600 text-white rounded-br-sm ${
                                    chatMessage.failed ? "bg-red-600" : chatMessage.pending ? "opacity-70" : ""
                                  }`
                                : "self-start bg-[#171717] text-gray-100 rounded-bl-sm"
                          }`}
                        >
                          {renderChatReplyPreview(chatMessage)}
                          {chatMessage.text ? (
                            <p className="whitespace-pre-wrap break-words">{chatMessage.text}</p>
                          ) : null}
                          {renderChatMessageMedia(chatMessage)}
                          {renderSharedContentCard(chatMessage)}
                          {renderChatMessageReactions(chatMessage)}
                          {chatMessage.pending ? (
                            <p className="mt-1 text-[10px] text-white/70">Sending...</p>
                          ) : null}
                          {chatMessage.failed ? (
                            <p className="mt-1 text-[10px] text-white/80">Not sent</p>
                          ) : null}
                          {chatMessage._id === lastOwnSeenMobileMessageId ? (
                            <p className="mt-1 text-[10px] text-white/80">Seen</p>
                          ) : null}
                          {!chatMessage.pending && !chatMessage.failed ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setMobileMessageMenuId((current) =>
                                    current === chatMessage._id ? "" : chatMessage._id
                                  )
                                }
                                className={`absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#111] text-gray-400 flex items-center justify-center ${
                                  mine ? "-left-8" : "-right-8"
                                }`}
                                aria-label="Message options"
                              >
                                <FiMoreVertical />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setMobileReactionMenuMessageId((current) =>
                                    current === chatMessage._id ? "" : chatMessage._id
                                  )
                                }
                                className={`absolute top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[#111] text-gray-400 flex items-center justify-center ${
                                  mine ? "-left-16" : "-right-16"
                                }`}
                                aria-label="React to message"
                              >
                                <FiSmile />
                              </button>
                              {mobileMessageMenuId === chatMessage._id ? (
                                <div
                                  className={`absolute top-full z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-gray-800 bg-[#080808] py-1 text-left shadow-2xl ${
                                    mine ? "right-0" : "left-0"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMobileReplyToMessage(chatMessage);
                                      setMobileMessageMenuId("");
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-[#151515]"
                                  >
                                    Reply
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteMobileMessage(chatMessage._id, "me")}
                                    className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-[#151515]"
                                  >
                                    Delete for me
                                  </button>
                                  {mine ? (
                                    <button
                                      type="button"
                                      onClick={() => deleteMobileMessage(chatMessage._id, "everyone")}
                                      className="w-full px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-[#151515]"
                                    >
                                      Delete for everyone
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {mobileReactionMenuMessageId === chatMessage._id ? (
                                <div
                                  className={`absolute top-full z-10 mt-1 flex gap-1 rounded-full border border-gray-800 bg-[#080808] p-1 shadow-2xl ${
                                    mine ? "right-0" : "left-0"
                                  }`}
                                >
                                  {REACTION_OPTIONS.map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => reactToMobileMessage(chatMessage._id, emoji)}
                                      className="h-8 w-8 rounded-full text-base hover:bg-[#181818]"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })
                  ) : !selectedMobileChatTyping ? (
                    <div className="h-full flex items-center justify-center text-gray-500 text-sm text-center">
                      Say hi to start the conversation.
                    </div>
                  ) : null}
                  {selectedMobileChatTyping ? (
                    <div className="self-start rounded-2xl rounded-bl-sm bg-[#171717] px-3 py-2 text-xs font-semibold text-gray-300">
                      Typing...
                    </div>
                  ) : null}
                </div>

                <form onSubmit={sendMobileMessage} className="relative shrink-0 border-t border-gray-900 p-2">
                  {mobileReplyToMessage ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-gray-900 bg-[#080808] px-3 py-2">
                      <div className="min-w-0 border-l-2 border-blue-500 pl-2">
                        <p className="text-xs font-semibold text-white">
                          Replying to {getMessageSenderId(mobileReplyToMessage) === userData?._id ? "your message" : mobileReplyToMessage.sender?.userName || "user"}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {getReplyPreviewText(createMessageReplySnapshot(mobileReplyToMessage))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileReplyToMessage(null)}
                        className="shrink-0 text-gray-500"
                        aria-label="Cancel reply"
                      >
                        <FiX />
                      </button>
                    </div>
                  ) : null}
                  {mobileMessageMedia.length > 0 ? (
                    <div className="mb-2 flex gap-2 overflow-x-auto">
                      {mobileMessageMedia.map((item, index) => (
                        <div key={`${item.name}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[#111]">
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
                  {mobileChatEmojiOpen ? (
                    <div className="absolute bottom-16 left-2 z-10 grid grid-cols-6 gap-1 rounded-lg border border-gray-800 bg-[#080808] p-2 shadow-2xl">
                      {EMOJI_OPTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setMobileMessageText((text) => `${text}${emoji}`)}
                          className="w-8 h-8 rounded-md text-lg hover:bg-[#151515]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMobileChatEmojiOpen((open) => !open)}
                    className="w-11 h-11 rounded-md bg-[#111] text-gray-300 flex items-center justify-center"
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
                    className="w-11 h-11 rounded-md bg-[#111] text-gray-300 flex items-center justify-center"
                    aria-label="Send photo or video"
                  >
                    <FiImage />
                  </button>
                  <input
                    value={mobileMessageText}
                    onChange={handleMobileMessageTextChange}
                    onBlur={() => stopMobileOutgoingTyping(selectedMobileChat?._id)}
                    placeholder="Message..."
                    className="min-w-0 flex-1 h-11 rounded-md bg-[#111] text-white px-3 outline-none placeholder:text-gray-600"
                    maxLength={1000}
                  />
                  <button
                    type="submit"
                    className="w-11 h-11 rounded-md bg-white text-black flex items-center justify-center disabled:opacity-50"
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
                          className="min-h-16 rounded-lg bg-[#080808] border border-gray-900 px-3 py-2 flex items-center gap-3"
                        >
                          <button
                            type="button"
                            onClick={() => openProfile(chatUser)}
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
                            onClick={() => openMobileChat(chatUser)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-white font-semibold truncate">{chatUser.userName}</p>
                              <p className="text-gray-500 text-sm truncate">
                                {isUserOnline(chatUser) ? "Online" : showFollowBack ? "Follows you" : "Open chat"}
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
            {mobileChatStatus ? (
              <p className={`text-sm ${shouldAutoDismissStatus(mobileChatStatus) ? "text-green-400" : "text-red-400"}`}>
                {mobileChatStatus}
              </p>
            ) : null}
          </div>
        ) : loadingFeed ? (
          <div className="text-gray-500 text-center py-12">Loading feed...</div>
        ) : visibleFeed.length > 0 ? (
          visibleFeed.map((item) => {
            const contentKey = getContentKey(item);
            const itemLiked = item.likes?.some((id) => id.toString() === userData?._id);
            const likePending = pendingLikeIds.has(contentKey);
            const deletePending = pendingContentDeleteIds.has(contentKey);

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
                <button
                  type="button"
                  onClick={() => openProfile(item.author)}
                  className="flex items-center gap-3 min-w-0 text-left"
                >
                  <img
                    src={mediaUrl(item.author?.profileImage) || dp}
                    alt="profile"
                    className="w-10 h-10 rounded-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = dp;
                    }}
                  />
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{item.author?.userName || "vybe_user"}</p>
                    <p className="text-gray-500 text-xs truncate">
                      {item.type === "reel" ? "Reel" : "Post"} · {formatContentTime(item.createdAt, storyClock)}
                    </p>
                  </div>
                </button>
                {item.author?._id === userData?._id ? (
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
                {isTextPost(item) ? (
                  <div className="min-h-[220px] w-full bg-[#080808] px-6 py-10 flex items-center justify-center">
                    <p className="max-w-xl whitespace-pre-wrap break-words text-center text-2xl font-semibold leading-snug text-white">
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
                    {item.type === "reel" ? (
                      <button type="button" onClick={() => openShareSheet(item)} aria-label="Share reel">
                        <FiSend />
                      </button>
                    ) : (
                      <FiSend />
                    )}
                  </div>
                  <FaRegBookmark />
                </div>
                <p className="text-white text-sm font-semibold mt-4">{item.likes?.length || 0} likes</p>
                {item.caption && !isTextPost(item) ? (
                  <p className="text-sm mt-1">
                    <span className="text-white font-semibold mr-2">{item.author?.userName || "vybe_user"}</span>
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
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <form
            onSubmit={handleUpload}
            className="w-full sm:max-w-[520px] rounded-t-2xl sm:rounded-lg border-t sm:border border-gray-800 bg-[#050505] overflow-hidden text-white"
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
                  <p className="font-semibold truncate">{userData?.userName || "vybe_user"}</p>
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
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="w-full sm:max-w-[420px] max-h-[82vh] overflow-hidden rounded-t-2xl sm:rounded-lg border-t sm:border border-gray-800 bg-[#050505] text-white">
            <div className="h-14 px-4 flex items-center justify-between border-b border-gray-900">
              <div className="min-w-0">
                <p className="font-semibold">Share reel</p>
                <p className="text-xs text-gray-500 truncate">
                  @{shareItem.author?.userName || "vybe_user"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShareItem(null)}
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
                {visibleShareUsers.length > 0 ? (
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
                        <p className="text-sm font-semibold truncate">{shareUser.userName}</p>
                        <p className="text-xs text-gray-500 truncate">{shareUser.name || "Vybe user"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => shareReelToUser(shareUser)}
                        disabled={Boolean(sharingUserId)}
                        className="h-9 px-3 rounded-md bg-white text-black text-sm font-semibold disabled:opacity-50"
                      >
                        {sharingUserId === shareUser._id ? "Sending" : "Send"}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-gray-500">No users found.</p>
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
          onClick={() => setSelectedProfileItem(null)}
        >
          <div
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
                  <p className="text-sm font-semibold truncate">
                    {selectedProfileItem.author?.userName || "vybe_user"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedProfileItem.type === "reel" ? "Reel" : "Post"}
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedProfileItem(null)}
                className="w-9 h-9 rounded-full bg-[#111] text-gray-300 flex items-center justify-center"
                aria-label="Close profile media"
              >
                <FiX />
              </button>
            </div>

            <div className="bg-black flex items-center justify-center">
              {isTextPost(selectedProfileItem) ? (
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
                  className="w-full max-h-[72vh] bg-black object-contain"
                />
              ) : (
                <img
                  src={mediaUrl(selectedProfileItem.media)}
                  alt={selectedProfileItem.caption || "Profile media"}
                  className="w-full max-h-[72vh] object-contain bg-black"
                />
              )}
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>{selectedProfileItem.likes?.length || 0} likes</span>
                <div className="flex items-center gap-3">
                  <span>{selectedProfileItem.comments?.length || 0} comments</span>
                  {selectedProfileItem.type === "reel" ? (
                    <button
                      type="button"
                      onClick={() => openShareSheet(selectedProfileItem)}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                    >
                      <FiSend /> Share
                    </button>
                  ) : null}
                </div>
              </div>

              {selectedProfileItem.caption && !isTextPost(selectedProfileItem) ? (
                <p className="mt-3 text-sm">
                  <span className="font-semibold text-white mr-2">
                    {selectedProfileItem.author?.userName || "vybe_user"}
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
                  <p className="text-white text-[15px] font-semibold truncate">
                    {selectedStory.author?.userName || "Story"}
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
              {selectedStory.mediaType === "video" ? (
                <video
                  src={mediaUrl(selectedStory.media)}
                  controls
                  autoPlay
                  playsInline
                  data-story-media
                  className="w-full max-h-[calc(100vh-190px)] bg-black object-contain"
                />
              ) : (
                <img
                  src={mediaUrl(selectedStory.media)}
                  alt="Story"
                  data-story-media
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

      {mobileSettingsOpen ? (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center">
          <div className="w-full sm:max-w-[420px] max-h-[92vh] overflow-y-auto bg-[#050505] border-t sm:border border-gray-800 rounded-t-2xl sm:rounded-lg text-white">
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

      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-black/95 border-t border-gray-900 grid grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveMobileTab("home")}
          className={`h-full flex flex-col items-center justify-center gap-1 ${
            activeMobileTab === "home" ? "text-white" : "text-gray-500"
          }`}
        >
          <FiHome className="text-xl" />
          <span className="text-xs font-semibold">Home</span>
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
