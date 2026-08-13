import express from "express";
import aiRoutes from "./routes/aiRoutes.js";

const app = express();

app.use(express.text({ type: ["application/json", "text/*", "*/*"], limit: "50mb" }));

app.use((req, res, next) => {
  if (typeof req.body === "string" && req.body.trim()) {
    let str = req.body.trim();
    try {
      req.body = JSON.parse(str);
    } catch (e) {
      if (!str.startsWith("[")) {
        try {
          req.body = JSON.parse(`[${str}]`);
        } catch (err) {
          console.warn("Could not parse body as JSON:", err.message);
        }
      }
    }
  }
  next();
});

app.use("/api/ai", aiRoutes);

export default app;
