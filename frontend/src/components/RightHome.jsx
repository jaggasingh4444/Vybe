import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import dp from "../assets/dp.png";
import { apiUrl, mediaUrl } from "../config/api";
import { setSuggestedUsers, setUserData } from "../redux/userSlice";
import { FiChevronLeft, FiChevronRight, FiDownload, FiImage, FiMessageCircle, FiMoreVertical, FiSearch, FiSend, FiSmile, FiVideo, FiX } from "react-icons/fi";
import { getTabAuthHeaders, withTabAuth } from "../utils/tabAuth";
import { downloadMediaFile } from "../utils/mediaDownload";

const MESSAGE_TIMEOUT_MS = 12000;
const MAX_CHAT_MEDIA_SIZE = 10 * 1024 * 1024;
const SUGGESTED_PREVIEW_LIMIT = 3;
const EMOJI_OPTIONS = ["😀", "😂", "😍", "🔥", "❤️", "🙌", "👏", "😎", "🥹", "👍", "✨", "💯"];
const REACTION_OPTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢", "👍"];
const STATUS_AUTO_DISMISS_MS = 1800;
const TYPING_IDLE_MS = 1400;
const TYPING_REFRESH_MS = 2000;
const TYPING_VISIBLE_MS = 3000;
const formatUnreadCount = (count) => (count > 10 ? "10+" : count);
const shouldAutoDismissStatus = (status) => /\b(uploaded|deleted)\b/i.test(status || "");
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

function RightHome() {
  const { suggestedUsers, userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();

  const [chatUsers, setChatUsers] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [messageMedia, setMessageMedia] = useState([]);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const [status, setStatus] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [chatEmojiOpen, setChatEmojiOpen] = useState(false);
  const [reactionMenuMessageId, setReactionMenuMessageId] = useState("");
  const [messageMenuId, setMessageMenuId] = useState("");
  const [chatMediaViewer, setChatMediaViewer] = useState(null);
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchResults, setChatSearchResults] = useState([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [suggestedExpanded, setSuggestedExpanded] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState(() => new Set());
  const [typingUserIds, setTypingUserIds] = useState(() => new Set());
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches
  );
  const selectedChatRef = useRef(null);
  const openChatRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mediaInputRef = useRef(null);
  const outgoingTypingRef = useRef({ receiverId: "", active: false, lastSentAt: 0 });
  const stopTypingTimeoutRef = useRef(null);
  const incomingTypingTimeoutsRef = useRef(new Map());

  const followingIds = new Set((userData?.following || []).map((id) => id.toString()));
  const followerIds = new Set((userData?.followers || []).map((id) => id.toString()));
  const isUserOnline = (user) => Boolean(user?.isOnline || onlineUserIds.has(user?._id));
  const visibleSuggestedUsers = suggestedExpanded
    ? suggestedUsers
    : suggestedUsers.slice(0, SUGGESTED_PREVIEW_LIMIT);
  const selectedChatTyping = Boolean(selectedChat?._id && typingUserIds.has(selectedChat._id));

  useEffect(() => {
    if (!shouldAutoDismissStatus(status)) return undefined;

    const timeoutId = window.setTimeout(() => setStatus(""), STATUS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

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

  const setTypingIndicator = useCallback((senderId, typing) => {
    if (!senderId) return;

    const existingTimeout = incomingTypingTimeoutsRef.current.get(senderId);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
      incomingTypingTimeoutsRef.current.delete(senderId);
    }

    setTypingUserIds((current) => {
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
        setTypingUserIds((current) => {
          const next = new Set(current);
          next.delete(senderId);
          return next;
        });
        incomingTypingTimeoutsRef.current.delete(senderId);
      }, TYPING_VISIBLE_MS);
      incomingTypingTimeoutsRef.current.set(senderId, timeoutId);
    }
  }, []);

  const sendTypingState = useCallback(async (receiverId, typing) => {
    if (!receiverId || !userData?._id || receiverId === userData._id) return;

    try {
      await fetch(apiUrl(`/api/chat/${receiverId}/typing`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ typing }),
      });
    } catch {
      // Typing indicators are a soft real-time signal, so failed pings stay silent.
    }
  }, [userData?._id]);

  const stopOutgoingTyping = useCallback((receiverId = outgoingTypingRef.current.receiverId) => {
    if (stopTypingTimeoutRef.current) {
      window.clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }

    if (outgoingTypingRef.current.active && receiverId) {
      sendTypingState(receiverId, false);
    }

    outgoingTypingRef.current = { receiverId: "", active: false, lastSentAt: 0 };
  }, [sendTypingState]);

  const handleMessageTextChange = (event) => {
    const value = event.target.value;
    const receiverId = selectedChatRef.current?._id;
    setMessageText(value);

    if (!receiverId) return;

    if (!value.trim()) {
      stopOutgoingTyping(receiverId);
      return;
    }

    const now = Date.now();
    const shouldSendTyping =
      !outgoingTypingRef.current.active ||
      outgoingTypingRef.current.receiverId !== receiverId ||
      now - outgoingTypingRef.current.lastSentAt > TYPING_REFRESH_MS;

    if (shouldSendTyping) {
      sendTypingState(receiverId, true);
      outgoingTypingRef.current = { receiverId, active: true, lastSentAt: now };
    }

    if (stopTypingTimeoutRef.current) {
      window.clearTimeout(stopTypingTimeoutRef.current);
    }

    stopTypingTimeoutRef.current = window.setTimeout(() => {
      stopOutgoingTyping(receiverId);
    }, TYPING_IDLE_MS);
  };

  const handleMessageMediaChange = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setStatus("");

    if (files.length === 0) return;

    if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
      setStatus("Choose an image or video.");
      return;
    }

    if (files.some((file) => file.size > MAX_CHAT_MEDIA_SIZE)) {
      setStatus("Each chat media must be under 10 MB.");
      return;
    }

    if (messageMedia.length + files.length > 6) {
      setStatus("You can send up to 6 photos or videos at once.");
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
      setChatEmojiOpen(false);
      setMessageMedia((current) => [...current, ...mediaItems]);
    } catch {
      setStatus("Unable to read media.");
    }
  };

  const clearMessageMedia = (indexToRemove) => {
    setMessageMedia((current) =>
      typeof indexToRemove === "number"
        ? current.filter((_, index) => index !== indexToRemove)
        : []
    );
  };

  const mergeMessage = (message) => {
    setMessages((current) => {
      if (current.some((item) => item._id === message._id)) return current;
      return [...current, message];
    });
  };

  const updateMessage = (message) => {
    setMessages((current) =>
      current.map((item) => (item._id === message._id ? message : item))
    );
  };

  const saveConfirmedMessage = (message, tempId) => {
    setMessages((current) => {
      const withoutTemp = tempId
        ? current.filter((item) => item._id !== tempId)
        : current;

      if (withoutTemp.some((item) => item._id === message._id)) return withoutTemp;
      return [...withoutTemp, message];
    });
  };

  const markMessageFailed = (tempId) => {
    setMessages((current) =>
      current.map((message) =>
        message._id === tempId
          ? { ...message, pending: false, failed: true }
          : message
      )
    );
  };

  const markMessagesSeen = (messageIds, readAt) => {
    const seenIds = new Set((messageIds || []).map((id) => id.toString()));

    setMessages((current) =>
      current.map((message) =>
        seenIds.has(message._id?.toString())
          ? { ...message, read: true, readAt }
          : message
      )
    );
  };

  const fetchChatUsers = async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/users"), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) return;

      const data = await res.json();
      setChatUsers(data);
    } catch {
      setStatus("Unable to load chats.");
    }
  };

  const fetchMessages = async (userId) => {
    try {
      const res = await fetch(apiUrl(`/api/chat/${userId}/messages`), {
        credentials: "include",
        headers: getTabAuthHeaders(),
      });

      if (!res.ok) throw new Error("Failed to load messages");

      const data = await res.json();
      setMessages(data);
    } catch {
      setStatus("Unable to load messages.");
    }
  };

  useEffect(() => {
    const query = chatSearch.trim();

    if (!query || !userData?._id || !isDesktop) {
      setChatSearchResults([]);
      setChatSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const searchTimer = window.setTimeout(async () => {
      setChatSearchLoading(true);

      try {
        const res = await fetch(apiUrl(`/api/chat/search-users?q=${encodeURIComponent(query)}`), {
          credentials: "include",
          headers: getTabAuthHeaders(),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Chat search failed");

        const data = await res.json();
        setChatSearchResults(data);
      } catch (error) {
        if (error.name !== "AbortError") {
          setChatSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setChatSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [chatSearch, isDesktop, userData?._id]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateScreen = () => setIsDesktop(mediaQuery.matches);

    updateScreen();
    mediaQuery.addEventListener("change", updateScreen);

    return () => mediaQuery.removeEventListener("change", updateScreen);
  }, []);

  useEffect(() => {
    if (!userData?._id || !isDesktop) return;

    fetchChatUsers();

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
            setTypingIndicator(data.senderId, data.typing);
          }
          return;
        }

        if (data.type === "message:delete") {
          setMessages((current) => current.filter((message) => message._id !== data.messageId));
          setReplyToMessage((current) => (current?._id === data.messageId ? null : current));
          fetchChatUsers();
          return;
        }

        if (data.type === "message:reaction") {
          updateMessage(data.message);
          return;
        }

        if (data.type === "messages:seen") {
          markMessagesSeen(data.messageIds, data.readAt);
          fetchChatUsers();
          return;
        }

        if (data.type === "conversation:delete") {
          const selectedId = selectedChatRef.current?._id;
          const currentUserId = userData?._id;
          const deletedUserIds = data.userIds || [];
          const isOpenChatDeleted =
            selectedId &&
            currentUserId &&
            deletedUserIds.includes(selectedId) &&
            deletedUserIds.includes(currentUserId);

          if (isOpenChatDeleted) {
            setMessages([]);
            setSelectedChat(null);
            setConversationMenuOpen(false);
            setStatus("Conversation deleted.");
          }

          fetchChatUsers();
          return;
        }

        if (data.type !== "message:new") return;

        const incoming = data.message;
        setTypingIndicator(incoming.sender?._id, false);

        const selectedId = selectedChatRef.current?._id;
        const currentUserId = userData?._id;
        const isOpenChat =
          selectedId &&
          currentUserId &&
          [incoming.sender?._id, incoming.receiver?._id].includes(selectedId) &&
          [incoming.sender?._id, incoming.receiver?._id].includes(currentUserId);

        if (isOpenChat) {
          if (incoming.receiver?._id === currentUserId) {
            fetchMessages(selectedId);
          } else {
            mergeMessage(incoming);
          }
        }

        fetchChatUsers();
      } catch {
        fetchChatUsers();
      }
    };

    events.onerror = () => {
      events.close();
    };

    return () => events.close();
  }, [isDesktop, setTypingIndicator, userData?._id]);

  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  useEffect(() => {
    stopOutgoingTyping();
    setTypingUserIds(new Set());
    setReactionMenuMessageId("");
    setMessageMenuId("");
    setReplyToMessage(null);
  }, [selectedChat?._id, stopOutgoingTyping]);

  useEffect(() => () => {
    stopOutgoingTyping();
    incomingTypingTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    incomingTypingTimeoutsRef.current.clear();
  }, [stopOutgoingTyping]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, selectedChatTyping]);

  useEffect(() => {
    const handleSidebarAction = (event) => {
      if (event.detail?.action !== "messages") return;

      if (selectedChat) return;

      const nextUser = chatUsers[0];

      if (!nextUser) {
        setStatus("No message conversations yet. Open a profile to start one.");
        return;
      }

      setSelectedChat(nextUser);
      selectedChatRef.current = nextUser;
      setMessages([]);
      setMessageMedia([]);
      setReactionMenuMessageId("");
      setStatus("");
      fetchMessages(nextUser._id).then(fetchChatUsers);
    };

    window.addEventListener("vybe:sidebar-action", handleSidebarAction);
    return () => window.removeEventListener("vybe:sidebar-action", handleSidebarAction);
  }, [chatUsers, selectedChat]);

  const handleFollow = async (targetUser) => {
    setBusyUserId(targetUser._id);
    setStatus("");

    try {
      const res = await fetch(apiUrl(`/api/users/${targetUser._id}/follow`), {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Follow failed");

      dispatch(setUserData(data.currentUser));
      dispatch(
        setSuggestedUsers(
          suggestedUsers.map((user) =>
            user._id === data.targetUser._id ? data.targetUser : user
          )
        )
      );
      await fetchChatUsers();
    } catch (error) {
      setStatus(error.message || "Follow failed.");
    } finally {
      setBusyUserId("");
    }
  };

  const openChat = async (user) => {
    setSelectedChat(user);
    selectedChatRef.current = user;
    setMessages([]);
    setStatus("");
    setConversationMenuOpen(false);
    setChatEmojiOpen(false);
    setMessageMedia([]);
    setReactionMenuMessageId("");
    await fetchMessages(user._id);
    await fetchChatUsers();
  };
  openChatRef.current = openChat;

  useEffect(() => {
    if (!isDesktop) return undefined;

    const handleOpenChat = (event) => {
      const targetUser = event.detail?.user;
      if (!targetUser?._id) return;
      openChatRef.current?.(targetUser);
    };

    window.addEventListener("vybe:open-chat", handleOpenChat);
    return () => window.removeEventListener("vybe:open-chat", handleOpenChat);
  }, [isDesktop]);

  const openProfile = (user) => {
    window.dispatchEvent(
      new CustomEvent("vybe:open-profile", {
        detail: { user },
      })
    );
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const text = messageText.trim();
    const mediaPayload = messageMedia;
    const replyTarget = replyToMessage;
    if ((!text && mediaPayload.length === 0) || !selectedChat) return;

    const receiver = selectedChat;
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

    setMessages((current) => [...current, optimisticMessage]);
    setMessageText("");
    setMessageMedia([]);
    setReplyToMessage(null);
    setMessageMenuId("");
    setStatus("");
    stopOutgoingTyping(receiver._id);

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

      saveConfirmedMessage(data, tempId);
      setChatEmojiOpen(false);
      await fetchChatUsers();
    } catch (error) {
      markMessageFailed(tempId);
      setStatus(error.message || "Message failed.");
      setMessageText(text);
      setMessageMedia(mediaPayload);
      setReplyToMessage(replyTarget);
    }
  };

  const deleteMessage = async (messageId, scope = "me") => {
    try {
      const res = await fetch(apiUrl(`/api/chat/messages/${messageId}?scope=${scope}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Delete failed");

      setMessages((current) => current.filter((message) => message._id !== messageId));
      setReplyToMessage((current) => (current?._id === messageId ? null : current));
      setMessageMenuId("");
      setStatus(scope === "everyone" ? "Message deleted for everyone." : "Message deleted for you.");
      await fetchChatUsers();
    } catch (error) {
      setStatus(error.message || "Delete failed.");
    }
  };

  const reactToMessage = async (messageId, emoji) => {
    if (!messageId || messageId.startsWith("temp-")) return;

    setReactionMenuMessageId("");

    try {
      const res = await fetch(apiUrl(`/api/chat/messages/${messageId}/reactions`), {
        method: "POST",
        credentials: "include",
        headers: getTabAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Reaction failed");

      updateMessage(data);
    } catch (error) {
      setStatus(error.message || "Reaction failed.");
    }
  };

  const deleteConversation = async (userId) => {
    try {
      const res = await fetch(apiUrl(`/api/chat/conversation/${userId}`), {
        method: "DELETE",
        credentials: "include",
        headers: getTabAuthHeaders(),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Delete failed");

      setMessages([]);
      setSelectedChat(null);
      setConversationMenuOpen(false);
      setStatus("Conversation deleted.");
      await fetchChatUsers();
    } catch (error) {
      setStatus(error.message || "Delete failed.");
    }
  };

  const normalizedChatSearch = chatSearch.trim().toLowerCase();
  const localChatMatches = normalizedChatSearch
    ? chatUsers.filter((user) =>
        [user.userName, user.name]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedChatSearch))
      )
    : chatUsers;
  const visibleChatUsers = normalizedChatSearch
    ? [...localChatMatches, ...chatSearchResults].reduce((users, user) => {
        if (!user?._id || users.some((item) => item._id === user._id)) return users;
        users.push(user);
        return users;
      }, [])
    : chatUsers;
  const lastOwnSeenMessageId = [...messages]
    .reverse()
    .find(
      (message) =>
        message.sender?._id === userData?._id &&
        message.read &&
        !message.pending &&
        !message.failed
    )?._id;

  const renderSharedContentCard = (message) => {
    const sharedItem = sharedContentToFeedItem(message.sharedContent);
    if (!sharedItem) return null;

    return (
      <div className="mt-2 w-60 max-w-full overflow-hidden rounded-lg border border-white/10 bg-black/30 text-left">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("vybe:open-shared-content", { detail: { item: sharedItem } })
            )
          }
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
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("vybe:share-content", { detail: { item: sharedItem } })
            )
          }
          className="flex h-9 w-full items-center justify-center gap-2 border-t border-white/10 text-xs font-semibold text-blue-300"
        >
          <FiSend /> Share
        </button>
      </div>
    );
  };

  const renderMessageReplyPreview = (message) => {
    const reply = message.replyTo;
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

  const renderMessageMedia = (message) => {
    const attachments = getMessageAttachments(message);
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

  const renderMessageReactions = (message) => {
    const reactions = message.reactions || [];
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
            onClick={() => reactToMessage(message._id, emoji)}
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
    <aside className="hidden lg:flex lg:w-[300px] xl:w-[360px] shrink-0 h-screen sticky top-0 bg-black flex-col px-5 py-6 border-l border-gray-900 overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-white font-semibold">Suggested</h2>
        <span className="text-gray-500 text-sm">{suggestedUsers.length}</span>
      </div>

      <div className="flex shrink-0 flex-col gap-3">
        {visibleSuggestedUsers.length > 0 ? (
          visibleSuggestedUsers.map((user) => {
            const isFollowing = followingIds.has(user._id);
            const followsMe = followerIds.has(user._id);

            return (
              <div key={user._id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => openProfile(user)}
                    className="relative shrink-0"
                    aria-label={`Open ${user.userName} profile`}
                  >
                    <img
                      src={mediaUrl(user.profileImage) || dp}
                      alt={user.userName}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = dp;
                      }}
                    />
                    {isUserOnline(user) ? (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-black" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => openChat(user)}
                    className="min-w-0 text-left"
                  >
                    <p className="text-white text-sm font-semibold truncate">{user.userName}</p>
                    <p className="text-gray-500 text-xs truncate">
                      {isUserOnline(user) ? "Online" : user.name}
                    </p>
                  </button>
                </div>
                <button
                  onClick={() => handleFollow(user)}
                  disabled={busyUserId === user._id}
                  className={`text-sm font-semibold hover:text-blue-400 disabled:opacity-60 ${
                    isFollowing ? "text-gray-400" : "text-blue-500"
                  }`}
                >
                  {busyUserId === user._id
                    ? "..."
                    : isFollowing
                      ? "Following"
                      : followsMe
                        ? "Follow Back"
                        : "Follow"}
                </button>
              </div>
            );
          })
        ) : (
          <p className="text-gray-500 text-sm">No suggestions yet.</p>
        )}

        {suggestedUsers.length > SUGGESTED_PREVIEW_LIMIT ? (
          <button
            type="button"
            onClick={() => setSuggestedExpanded((expanded) => !expanded)}
            className="self-start text-sm font-semibold text-blue-500 hover:text-blue-400"
          >
            {suggestedExpanded ? "View less" : `Show more (${suggestedUsers.length - SUGGESTED_PREVIEW_LIMIT})`}
          </button>
        ) : null}
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Messages</h2>
          <FiMessageCircle className="text-gray-500" />
        </div>

        <div className="relative mb-3">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            placeholder="Search chats"
            className="w-full h-10 rounded-md bg-[#101010] border border-gray-900 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600"
          />
        </div>

        <div className={`${selectedChat ? "max-h-20" : "flex-1"} overflow-y-auto flex flex-col gap-2 pr-1`}>
          {visibleChatUsers.length > 0 ? (
            visibleChatUsers.map((user) => {
              const isFollowing = followingIds.has(user._id);
              const followsMe = followerIds.has(user._id);
              const showFollowBack = followsMe && !isFollowing;
              const unreadCount = selectedChat?._id === user._id ? 0 : user.unreadCount || 0;

              return (
                <div
                  key={user._id}
                  className={`flex items-center gap-2 rounded-md p-2 ${
                    selectedChat?._id === user._id ? "bg-[#151515]" : "hover:bg-[#101010]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openProfile(user)}
                    className="relative shrink-0"
                    aria-label={`Open ${user.userName} profile`}
                  >
                    <img
                      src={mediaUrl(user.profileImage) || dp}
                      alt={user.userName}
                      className="w-9 h-9 rounded-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = dp;
                      }}
                    />
                    {isUserOnline(user) ? (
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-black" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => openChat(user)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{user.userName}</p>
                      <p className="text-gray-500 text-xs truncate">
                        {isUserOnline(user) ? "Online" : showFollowBack ? "Follows you" : "Open chat"}
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
                      onClick={() => handleFollow(user)}
                      disabled={busyUserId === user._id}
                      className="h-8 px-2 rounded-md bg-white text-black text-xs font-semibold disabled:opacity-60"
                    >
                      {busyUserId === user._id ? "..." : "Follow Back"}
                    </button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-gray-500 text-sm">
              {chatSearchLoading
                ? "Searching connected users..."
                : normalizedChatSearch
                  ? "No connected users found."
                  : "No message conversations yet."}
            </p>
          )}
        </div>
        {selectedChat ? (
        <div className="mt-4 min-h-[560px] flex flex-[3] flex-col border border-gray-900 rounded-lg overflow-hidden bg-[#050505]">
          <div className="relative h-14 px-3 flex items-center justify-between border-b border-gray-900">
            <button
              type="button"
              onClick={() => openProfile(selectedChat)}
              className="flex items-center gap-3 min-w-0 text-left"
            >
              <span className="relative shrink-0">
                <img
                  src={mediaUrl(selectedChat.profileImage) || dp}
                  alt={selectedChat.userName}
                  className="w-9 h-9 rounded-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = dp;
                  }}
                />
                {isUserOnline(selectedChat) ? (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-black" />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate">{selectedChat.userName}</p>
                <p className="text-gray-500 text-xs truncate">
                  {isUserOnline(selectedChat) ? "Online" : "Offline"}
                </p>
              </div>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConversationMenuOpen((open) => !open)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white"
                aria-label="Conversation options"
              >
                <FiMoreVertical />
              </button>
              <button
                type="button"
                onClick={() => setSelectedChat(null)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white"
                aria-label="Close chat"
              >
                <FiX />
              </button>
            </div>

            {conversationMenuOpen ? (
              <div className="absolute right-3 top-12 z-10 w-52 rounded-lg border border-gray-800 bg-[#080808] p-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => deleteConversation(selectedChat._id)}
                  className="w-full h-10 rounded-md px-3 text-left text-sm text-red-400 hover:bg-[#151515]"
                >
                  Delete conversation
                </button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-2 overscroll-contain">
            {messages.length > 0 ? (
              messages.map((message) => {
                const mine = message.sender?._id === userData?._id;
                const messageMenuOpen = messageMenuId === message._id;
                const reactionMenuOpen = reactionMenuMessageId === message._id;
                const messageActionsOpen = messageMenuOpen || reactionMenuOpen;
                const mediaOnly =
                  getMessageAttachments(message).length > 0 &&
                  !message.text &&
                  !message.sharedContent;
                return (
                  <div key={message._id} className={`group flex max-w-[88%] flex-col ${mine ? "self-end items-end" : "self-start items-start"}`}>
                    <div className="flex items-end gap-2">
                      {mine ? (
                        <div
                          className={`flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                            messageActionsOpen ? "opacity-100" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setReactionMenuMessageId((current) =>
                                current === message._id ? "" : message._id
                              )
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111] text-gray-400 hover:text-white"
                            aria-label="React to message"
                          >
                            <FiSmile />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMessageMenuId((current) =>
                                current === message._id ? "" : message._id
                              )
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111] text-gray-400 hover:text-white"
                            aria-label="Message options"
                          >
                            <FiMoreVertical />
                          </button>
                        </div>
                      ) : null}

                      <div
                        className={`relative rounded-2xl text-sm ${
                          mediaOnly ? "p-0" : "px-3 py-2"
                        } ${
                          mediaOnly
                            ? `bg-transparent text-white ${message.pending ? "opacity-70" : ""}`
                            : mine
                              ? `bg-blue-600 text-white rounded-br-sm ${
                                  message.failed ? "bg-red-600" : message.pending ? "opacity-70" : ""
                                }`
                              : "bg-[#171717] text-gray-100 rounded-bl-sm"
                        }`}
                      >
                        {renderMessageReplyPreview(message)}
                        {message.text ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
                        {renderMessageMedia(message)}
                        {renderSharedContentCard(message)}
                        {renderMessageReactions(message)}
                        {message.pending ? (
                          <p className="mt-1 text-[10px] text-white/70">Sending...</p>
                        ) : null}
                        {message.failed ? (
                          <p className="mt-1 text-[10px] text-white/80">Not sent</p>
                        ) : null}
                        {message._id === lastOwnSeenMessageId ? (
                          <p className="mt-1 text-[10px] text-white/80">Seen</p>
                        ) : null}
                      </div>

                      {!mine ? (
                        <div
                          className={`flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${
                            messageActionsOpen ? "opacity-100" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setReactionMenuMessageId((current) =>
                                current === message._id ? "" : message._id
                              )
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111] text-gray-400 hover:text-white"
                            aria-label="React to message"
                          >
                            <FiSmile />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMessageMenuId((current) =>
                                current === message._id ? "" : message._id
                              )
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111] text-gray-400 hover:text-white"
                            aria-label="Message options"
                          >
                            <FiMoreVertical />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {messageMenuOpen ? (
                      <div className="mt-2 w-44 overflow-hidden rounded-lg border border-gray-800 bg-[#080808] py-1 text-left shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyToMessage(message);
                            setMessageMenuId("");
                          }}
                          className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-[#151515]"
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMessage(message._id, "me")}
                          className="w-full px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-[#151515]"
                        >
                          Delete for me
                        </button>
                        {mine ? (
                          <button
                            type="button"
                            onClick={() => deleteMessage(message._id, "everyone")}
                            className="w-full px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-[#151515]"
                          >
                            Delete for everyone
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {reactionMenuOpen ? (
                      <div className="mt-2 flex gap-1 rounded-full border border-gray-800 bg-[#080808] p-1 shadow-2xl">
                        {REACTION_OPTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => reactToMessage(message._id, emoji)}
                            className="h-8 w-8 rounded-full text-base hover:bg-[#181818]"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : !selectedChatTyping ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm text-center">
                Say hi to start the conversation.
              </div>
            ) : null}
            {selectedChatTyping ? (
              <div className="mb-2 flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-[#111] px-3 py-2 text-xs font-semibold text-gray-300">
                  Typing...
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendMessage} className="relative border-t border-gray-900 p-2">
            {replyToMessage ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-gray-900 bg-[#080808] px-3 py-2">
                <div className="min-w-0 border-l-2 border-blue-500 pl-2">
                  <p className="text-xs font-semibold text-white">
                    Replying to {getMessageSenderId(replyToMessage) === userData?._id ? "your message" : replyToMessage.sender?.userName || "user"}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {getReplyPreviewText(createMessageReplySnapshot(replyToMessage))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyToMessage(null)}
                  className="shrink-0 text-gray-500 hover:text-white"
                  aria-label="Cancel reply"
                >
                  <FiX />
                </button>
              </div>
            ) : null}
            {messageMedia.length > 0 ? (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {messageMedia.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[#111]">
                    {item.mediaType === "video" ? (
                      <video src={mediaUrl(item.media)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      <img src={mediaUrl(item.media)} alt="Selected media" className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => clearMessageMedia(index)}
                      className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                      aria-label="Remove media"
                    >
                      <FiX className="text-xs" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {chatEmojiOpen ? (
              <div className="absolute bottom-14 left-2 z-10 grid grid-cols-6 gap-1 rounded-lg border border-gray-800 bg-[#080808] p-2 shadow-2xl">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setMessageText((text) => `${text}${emoji}`)}
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
              onClick={() => setChatEmojiOpen((open) => !open)}
              className="w-10 h-10 rounded-md bg-[#111] text-gray-300 hover:text-white flex items-center justify-center"
              aria-label="Add emoji"
            >
              <FiSmile />
            </button>
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleMessageMediaChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              className="w-10 h-10 rounded-md bg-[#111] text-gray-300 hover:text-white flex items-center justify-center"
              aria-label="Send photo or video"
            >
              <FiImage />
            </button>
            <input
              value={messageText}
              onChange={handleMessageTextChange}
              onBlur={() => stopOutgoingTyping(selectedChat?._id)}
              placeholder="Message..."
              className="min-w-0 flex-1 h-10 rounded-md bg-[#111] text-white px-3 outline-none placeholder:text-gray-600"
              maxLength={1000}
            />
            <button
              type="submit"
              className="w-10 h-10 rounded-md bg-white text-black flex items-center justify-center disabled:opacity-50"
              disabled={!messageText.trim() && messageMedia.length === 0}
              aria-label="Send message"
            >
              <FiSend />
            </button>
            </div>
          </form>
        </div>
        ) : null}
      </div>

      {chatMediaViewer && activeChatMedia ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
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
                    ).catch(() => setStatus("Download failed."))
                  }
                  className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black hover:bg-gray-200"
                  aria-label="Download media"
                >
                  <FiDownload /> Download
                </button>
                <button
                  type="button"
                  onClick={() => setChatMediaViewer(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
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
                    className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                    aria-label="Previous media"
                  >
                    <FiChevronLeft className="text-2xl" />
                  </button>
                  <button
                    type="button"
                    onClick={() => showChatMediaStep(1)}
                    className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
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

      {status ? (
        <p className={`mt-4 text-sm ${shouldAutoDismissStatus(status) ? "text-green-400" : "text-red-400"}`}>
          {status}
        </p>
      ) : null}
    </aside>
  );
}

export default RightHome;
