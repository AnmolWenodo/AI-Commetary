import express from "express";
import { chat, getComponentInsight } from "../controllers/aiController.js";

const router = express.Router();

router.post("/chat", chat);
router.post("/component-insight", getComponentInsight);

export default router;