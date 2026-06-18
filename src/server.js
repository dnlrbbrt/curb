import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { startScheduler } from "./scheduler.js";
import { log } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/media", express.static(path.join(__dirname, "..", "media")));
app.use(authRoutes);
app.use("/api", apiRoutes);

// JSON errors, never HTML stack traces
app.use((err, req, res, next) => {
  log(`Request error: ${err.message}`, "error");
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`Curb running at http://localhost:${PORT}`);
  if (!process.env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL.includes("localhost")) {
    log("PUBLIC_BASE_URL is localhost — OAuth callbacks and Instagram media fetches need a public URL. See README.", "warn");
  }
  if (process.env.APP_SECRET === "change-me" || !process.env.APP_SECRET) {
    log("APP_SECRET is not set — tokens are encrypted with a default dev key. Set a real secret in .env.", "warn");
  }
  startScheduler();
});
