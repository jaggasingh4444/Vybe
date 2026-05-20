const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";
const DEFAULT_AI_MODEL = "gpt-5-mini";
const DEFAULT_MODERATION_MODEL = "omni-moderation-latest";

const getAiModel = () => process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
const getModerationModel = () => process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODERATION_MODEL;
const hasOpenAiKey = () => Boolean(process.env.OPENAI_API_KEY);

const sanitizeText = (value, maxLength = 1200) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const extractResponseText = (data) => {
  if (typeof data?.output_text === "string") return data.output_text.trim();

  const text = (data?.output || [])
    .flatMap((item) => item?.content || [])
    .map((content) => content?.text || content?.output_text || "")
    .join("")
    .trim();

  return text;
};

const parseJsonArray = (text) => {
  try {
    const trimmed = text.trim();
    const jsonText = trimmed.startsWith("[")
      ? trimmed
      : trimmed.match(/\[[\s\S]*\]/)?.[0] || "[]";
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cleanSuggestions = (items, limit = 5, maxLength = 180) =>
  items
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, limit)
    .map((item) => item.slice(0, maxLength));

const createAiResponse = async ({ system, user, maxOutputTokens = 400 }) => {
  if (!hasOpenAiKey()) {
    const error = new Error("AI is not configured");
    error.status = 503;
    throw error;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getAiModel(),
      input: [
        {
          role: "system",
          content: system,
        },
        {
          role: "user",
          content: user,
        },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || "AI request failed");
    error.status = response.status;
    throw error;
  }

  return extractResponseText(data);
};

const fallbackCaptions = (mode, caption) => {
  const base = caption ? caption.replace(/\s+/g, " ").slice(0, 90) : "New VYBE moment";
  const type = mode === "reel" ? "reel" : "post";

  return [
    `${base} ✨ #vybe #${type}`,
    `Just a little ${type} energy today 🔥 #vybe`,
    `Current mood: ${base} 😎`,
    `Posting this before I overthink it 🙌 #vybe`,
    `Small moment, big feeling 💫 #${type}`,
  ];
};

const fallbackReplies = () => [
  "Haha true 😂",
  "Tell me more",
  "I get you",
  "Wait, really?",
];

export const generateCaptions = async (req, res) => {
  const mode = req.body.mode === "reel" ? "reel" : "post";
  const caption = sanitizeText(req.body.caption, 500);
  const mediaType = sanitizeText(req.body.mediaType, 30) || "text";

  try {
    const output = await createAiResponse({
      system:
        "You write polished, natural social-media captions for VYBE. Return only a JSON array of strings. No markdown.",
      user: [
        `Create 5 caption options for a ${mode}.`,
        `Media type: ${mediaType}.`,
        caption ? `User idea/current caption: ${caption}` : "The user did not write an idea yet.",
        "Keep each caption short, friendly, and usable immediately.",
        "Use natural emojis and 1-3 hashtags only when they fit.",
        "Match the user's language style when possible.",
      ].join("\n"),
      maxOutputTokens: 500,
    });

    const suggestions = cleanSuggestions(parseJsonArray(output), 5, 180);

    return res.status(200).json({
      aiEnabled: true,
      suggestions: suggestions.length ? suggestions : fallbackCaptions(mode, caption),
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(200).json({
        aiEnabled: false,
        suggestions: fallbackCaptions(mode, caption),
        message: "Add OPENAI_API_KEY on the backend to enable live AI captions.",
      });
    }

    return res.status(error.status || 500).json({
      message: error.message || "AI caption generation failed",
    });
  }
};

export const generateChatReplies = async (req, res) => {
  const receiverName = sanitizeText(req.body.receiverName, 80) || "this user";
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-8) : [];
  const compactMessages = messages
    .map((message) => {
      const speaker = message?.mine ? "Me" : receiverName;
      const text = sanitizeText(message?.text, 180);
      const media = sanitizeText(message?.mediaType || message?.sharedContentType, 40);
      return `${speaker}: ${text || (media ? `[${media}]` : "[message]")}`;
    })
    .join("\n");

  try {
    const output = await createAiResponse({
      system:
        "You suggest short chat replies for a social app. Return only a JSON array of strings. No markdown.",
      user: [
        `Conversation with: ${receiverName}.`,
        compactMessages || "No previous messages are available.",
        "Suggest 4 short replies the logged-in user could send next.",
        "Keep replies casual, kind, human, and under 60 characters.",
        "Match the conversation language and tone.",
      ].join("\n"),
      maxOutputTokens: 300,
    });

    const suggestions = cleanSuggestions(parseJsonArray(output), 4, 80);

    return res.status(200).json({
      aiEnabled: true,
      suggestions: suggestions.length ? suggestions : fallbackReplies(),
    });
  } catch (error) {
    if (error.status === 503) {
      return res.status(200).json({
        aiEnabled: false,
        suggestions: fallbackReplies(),
        message: "Add OPENAI_API_KEY on the backend to enable live AI replies.",
      });
    }

    return res.status(error.status || 500).json({
      message: error.message || "AI reply generation failed",
    });
  }
};

export const moderateText = async (req, res) => {
  const text = sanitizeText(req.body.text, 4000);
  if (!text) {
    return res.status(400).json({ message: "Text is required" });
  }

  if (!hasOpenAiKey()) {
    return res.status(200).json({
      aiEnabled: false,
      flagged: false,
      categories: {},
      message: "Add OPENAI_API_KEY on the backend to enable AI moderation.",
    });
  }

  try {
    const response = await fetch(OPENAI_MODERATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getModerationModel(),
        input: text,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        message: data?.error?.message || "AI moderation failed",
      });
    }

    const result = data?.results?.[0] || {};
    return res.status(200).json({
      aiEnabled: true,
      flagged: Boolean(result.flagged),
      categories: result.categories || {},
      categoryScores: result.category_scores || {},
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "AI moderation failed" });
  }
};
