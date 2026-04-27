import express from "express";
import multer from "multer";
import { storagePut } from "./storage";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"];
    cb(null, allowed.includes(file.mimetype) || file.mimetype.startsWith("audio/"));
  },
});

export function registerAudioUploadRoute(app: express.Express) {
  app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No audio file provided" });
        return;
      }
      const ext = req.file.mimetype.includes("webm") ? "webm" : req.file.mimetype.includes("mp4") ? "mp4" : "wav";
      const key = `audio/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { url } = await storagePut(key, req.file.buffer, req.file.mimetype);
      res.json({ url, key });
    } catch (err: any) {
      console.error("[AudioUpload] Error:", err);
      res.status(500).json({ error: err.message ?? "Upload failed" });
    }
  });
}
