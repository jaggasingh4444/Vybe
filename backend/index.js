import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import authRouter from "./routes/auth.routes.js";
import chatRouter from "./routes/chat.routes.js";
import contentRouter from "./routes/content.routes.js";
import userRouter from "./routes/user.routes.js";
import connectDb from "./config/db.js";

dotenv.config();
const app = express();
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
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/content", contentRouter);
app.use("/api/users", userRouter);

// Start server and connect DB
connectDb().then(() => {
  app.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
}).catch(err => console.error("DB connection error:", err));
