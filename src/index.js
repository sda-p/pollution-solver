const express = require("express");
const cors = require("cors");
const travelRoutes = require("./routes/travel.routes");

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/travel", travelRoutes);

// Health check
app.get("/", (req, res) => {
  res.send("Sustainable Travel API is running!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});