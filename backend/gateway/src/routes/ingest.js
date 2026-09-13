const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { ingestQueue } = require("../config/redis");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const uploadsDir = path.join(__dirname, "../../uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "");
      const unique = crypto.randomBytes(16).toString("hex");
      cb(null, `${unique}${ext}`);
    },
  }),
});

/**
 * POST /ingest
 * Accepts a document (file upload or remote URL) and places it in the BullMQ ingestion queue.
 * Returns a 202 Accepted with the queued job ID.
 */
router.post("/", authenticateToken, upload.single("file"), async (req, res) => {
  try {
    const { knowledge_base_id, file_url, processing_mode } = req.body;
    let metadata = req.body.metadata;
    if (typeof metadata === "string") {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        // ignore parse error if metadata isn't a JSON string
      }
    }
    console.log(req.body);

    // Validate required field
    if (!knowledge_base_id) {
      return res.status(400).json({ error: "knowledge_base_id is required" });
    }

    // Resolve the file source
    let filePath = null;
    let originalName = null;
    if (req.file) {
      // Use absolute path so the Python worker (in a different directory) can find it
      filePath = path.resolve(req.file.path);
      originalName = req.file.originalname;
    } else if (file_url) {
      filePath = file_url; // Remote URL — worker will download it
      originalName = file_url.split("/").pop();
    } else {
      return res
        .status(400)
        .json({ error: "Either file upload or file_url is required" });
    }

    const mode = processing_mode || "fast"; // Default to auto-detect (fast) mode
    console.log("Enqueuing mode", mode);
    // Enqueue the job
    const job = await ingestQueue.add("process_document", {
      knowledge_base_id,
      filePath,
      originalName,
      processing_mode: mode,
      metadata: metadata || {},
      user_id: req.user ? req.user.id : null,
    });

    console.log("Job enqueued", job);
    res.status(202).json({
      message: "Document ingestion queued successfully",
      jobId: job.id,
      knowledge_base_id,
      processing_mode: mode,
    });
  } catch (error) {
    console.error("Ingestion error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /ingest/job/:id
 * Checks the status of a BullMQ ingestion job by ID.
 */
router.get("/job/:id", authenticateToken, async (req, res) => {
  try {
    const job = await ingestQueue.getJob(req.params.id);

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();
    const progress = job.progress;
    const failedReason = job.failedReason;
    const returnvalue = job.returnvalue;

    res.json({
      id: job.id,
      state, // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
      progress,
      failedReason,
      returnvalue,
    });
  } catch (error) {
    console.error("Job fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
