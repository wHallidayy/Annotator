const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs-extra");
const path = require("path");
const sharp = require("sharp");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

// Directories
const INPUT_DIR = path.join(__dirname, "input");
const OUTPUT_DIR = path.join(__dirname, "output");

// Ensure directories exist
fs.ensureDirSync(INPUT_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// In-memory storage for annotations
const annotationsStore = new Map();

// --- NEW HELPER FUNCTION TO DRAW BOXES ON IMAGE ---
/**
 * Draws bounding boxes on an image and saves it to the output directory.
 * @param {string} filename The original image filename.
 * @param {Array} annotations An array of annotation objects.
 */
async function drawAnnotationsOnImage(filename, annotations) {
  try {
    const inputImagePath = path.join(INPUT_DIR, filename);
    const outputImageName = `annotated_${filename}`;
    const outputImagePath = path.join(OUTPUT_DIR, outputImageName);

    // Create an array of SVG overlay operations for sharp
    const overlays = annotations.map((ann) => {
      // Ensure width and height are positive integers
      const width = Math.max(1, Math.round(ann.width));
      const height = Math.max(1, Math.round(ann.height));

      // Create an SVG for a semi-transparent blue box with a solid border
      const svgBox = `
                <svg width="${width}" height="${height}">
                    <rect
                        x="0"
                        y="0"
                        width="${width}"
                        height="${height}"
                        stroke="#007bff"
                        stroke-width="3"
                        fill="rgba(0, 123, 255, 0.3)" 
                    />
                </svg>
            `;

      return {
        input: Buffer.from(svgBox),
        top: Math.round(ann.top),
        left: Math.round(ann.left),
      };
    });

    // Use sharp to composite the overlays onto the original image
    await sharp(inputImagePath)
      .composite(overlays)
      .toFormat("jpeg", { quality: 90 }) // Save as JPEG with 90% quality
      .toFile(outputImagePath);

    console.log(`Successfully created annotated image: ${outputImageName}`);
  } catch (error) {
    console.error("Error creating annotated image:", error);
  }
}

// Helper functions
function generateCocoFormat(imageData, annotations) {
  const cocoData = {
    images: [
      {
        id: 1,
        file_name: imageData.filename,
        width: imageData.width,
        height: imageData.height,
      },
    ],
    annotations: annotations.map((ann, index) => ({
      id: ann.id || index + 1,
      image_id: 1,
      category_id: 1,
      bbox: [ann.left, ann.top, ann.width, ann.height],
      area: ann.width * ann.height,
      iscrowd: 0,
    })),
    categories: [
      {
        id: 1,
        name: "Marker",
      },
    ],
  };
  return cocoData;
}

async function getImageDimensions(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    console.error("Error getting image dimensions:", error);
    return { width: 0, height: 0 };
  }
}

// API Routes

app.get("/api/images", async (req, res) => {
  try {
    const files = await fs.readdir(INPUT_DIR);
    const jpgFiles = files.filter(
      (file) =>
        file.toLowerCase().endsWith(".jpg") ||
        file.toLowerCase().endsWith(".jpeg"),
    );

    const imageList = await Promise.all(
      jpgFiles.map(async (filename) => {
        const imagePath = path.join(INPUT_DIR, filename);
        const dimensions = await getImageDimensions(imagePath);
        return {
          filename,
          ...dimensions,
        };
      }),
    );

    res.json(imageList);
  } catch (error) {
    console.error("Error reading input directory:", error);
    res.status(500).json({ error: "Failed to read images" });
  }
});

app.get("/api/images/:filename", (req, res) => {
  const filename = req.params.filename;
  const imagePath = path.join(INPUT_DIR, filename);

  fs.access(imagePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).json({ error: "Image not found" });
    }
    res.sendFile(imagePath);
  });
});

app.get("/api/annotations/:filename", async (req, res) => {
  const filename = req.params.filename;
  const annotationPath = path.join(OUTPUT_DIR, `${filename}.json`);
  try {
    if (await fs.pathExists(annotationPath)) {
      const cocoData = await fs.readJson(annotationPath);
      const annotations = cocoData.annotations.map((ann) => ({
        id: ann.id,
        left: ann.bbox[0],
        top: ann.bbox[1],
        width: ann.bbox[2],
        height: ann.bbox[3],
      }));
      res.json({ annotations });
    } else {
      res.json({ annotations: [] });
    }
  } catch (error) {
    console.error("Error reading annotations:", error);
    res.status(500).json({ error: "Failed to read annotations" });
  }
});

// --- UPDATED ROUTE ---
app.post("/api/annotations/:filename", async (req, res) => {
  const filename = req.params.filename;
  const { annotations, imageData } = req.body;

  if (!annotations || !imageData) {
    return res.status(400).json({ error: "Missing annotations or imageData." });
  }

  try {
    // 1. Generate and save COCO JSON file
    const cocoData = generateCocoFormat(imageData, annotations);
    const annotationPath = path.join(OUTPUT_DIR, `${filename}.json`);
    await fs.writeJson(annotationPath, cocoData, { spaces: 2 });
    console.log(`Annotations saved to ${filename}.json`);

    // 2. Generate and save the image with boxes drawn on it
    if (annotations.length > 0) {
      await drawAnnotationsOnImage(filename, annotations);
    }

    // 3. Store in memory for real-time updates
    annotationsStore.set(filename, annotations);

    // 4. Emit to all connected clients
    io.emit("annotation:updated", {
      filename,
      annotations,
    });

    res.json({
      success: true,
      message: "Annotations and annotated image saved.",
    });
  } catch (error) {
    console.error("Error saving annotations:", error);
    res.status(500).json({ error: "Failed to save annotations" });
  }
});

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("request:annotations", async (filename) => {
    try {
      const annotationPath = path.join(OUTPUT_DIR, `${filename}.json`);
      if (await fs.pathExists(annotationPath)) {
        const cocoData = await fs.readJson(annotationPath);
        const annotations = cocoData.annotations.map((ann) => ({
          id: ann.id,
          left: ann.bbox[0],
          top: ann.bbox[1],
          width: ann.bbox[2],
          height: ann.bbox[3],
        }));
        socket.emit("annotations:loaded", { filename, annotations });
      } else {
        socket.emit("annotations:loaded", { filename, annotations: [] });
      }
    } catch (error) {
      console.error(`Error loading annotations for ${filename}:`, error);
    }
  });

  socket.on("annotation:create", (data) => {
    socket.broadcast.emit("annotation:created", data);
  });

  socket.on("annotation:update", (data) => {
    socket.broadcast.emit("annotation:updated-remote", data);
  });

  socket.on("annotation:delete", (data) => {
    socket.broadcast.emit("annotation:deleted-remote", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Input directory: ${INPUT_DIR}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
});

module.exports = app;
