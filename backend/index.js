import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import authRouter from "./routes/auth.routes.js";
import aiRouter from "./routes/ai.routes.js";
import adminRouter from "./routes/admin.routes.js";
import chatRouter from "./routes/chat.routes.js";
import contentRouter from "./routes/content.routes.js";
import userRouter from "./routes/user.routes.js";
import connectDb from "./config/db.js";
import { getMedia } from "./controllers/media.controllers.js";
import { initializeChatSocket } from "./utils/chatSocket.js";

dotenv.config();
const app = express();
app.set("trust proxy", 1);
app.get("/", (req, res) => {
  res.send("Vybe backend is running successfully");
});
const port = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(express.json({ limit: "80mb" }));
app.use(cookieParser());

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Media-Type", "X-Media-Name"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.get("/api/media/:mediaId", getMedia);

// Routes
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/ai", aiRouter);
app.use("/api/chat", chatRouter);
app.use("/api/content", contentRouter);
app.use("/api/users", userRouter);

app.use((error, _req, res, _next) => {
  const status =
    error?.code === "LIMIT_FILE_SIZE" ||
    error?.type === "entity.too.large" ||
    error?.status === 413
      ? 413
      : error?.status || error?.statusCode || 500;
  const message =
    status === 413
      ? "Media file is too large for upload."
      : error?.message || "Server error";

  return res.status(status).json({ message });
});

const server = http.createServer(app);
initializeChatSocket(server, corsOptions);

// Start server and connect DB
connectDb().then(() => {
  server.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
}).catch(err => console.error("DB connection error:", err));
