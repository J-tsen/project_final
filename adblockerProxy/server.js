require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios"); // Added for API calls
const { processImage } = require('./imgModel');
const { makeDecision } = require('./decisionModel');
const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:5000/analyze";

// Define the allowed origins
// This allows all requests since the extension id is not fixed (the extension hasn't been published)
const allowedOrigins = [
    "chrome-extension://*", // Chrome
    "moz-extension://*",  // Firefox 
    "ms-browser-extension://*"  // Edge
];

// Configure CORS middleware
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list or matches a wildcard pattern
      const isAllowed = allowedOrigins.some(allowedOrigin => {
        if (allowedOrigin.endsWith('*')) {
          return origin.startsWith(allowedOrigin.slice(0, -1));
        }
        return origin === allowedOrigin;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Body parser configuration
app.use(express.json({ limit: "50mb" }));
// Proxy endpoint
app.post("/proxy", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "No image provided" });
    }

    // Process image with Roboflow
    const { result: roboflowResult, texts } = await processImage(image);

    // Process texts with Python API
    const nlpResults = await Promise.all(
      texts.map(async (text) => {
        try {
          const response = await axios.post(PYTHON_API_URL, {
            text: text
          });
          return response.data;
        } catch (error) {
          console.error("API processing error for text:", text, error.response?.data || error.message);
          return {
            text: text || '',
            error: "API analysis failed: " + (error.response?.data?.error || error.message)
          };
        }
      })
    );
    const decision = makeDecision(nlpResults, roboflowResult);

    res.json({
      roboflowResult,
      nlpResults: nlpResults.filter(r => !r.error),
      decision
    });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      details: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connecting to Python API at: ${PYTHON_API_URL}`);
});