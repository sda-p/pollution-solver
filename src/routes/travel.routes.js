const express = require("express");
const router = express.Router();
const { travelHandler } = require("../controllers/travel.controller");

// POST /api/travel/compare
router.post("/compare", travelHandler);

module.exports = router;