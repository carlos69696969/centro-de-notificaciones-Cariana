const express = require("express");
const { processReturnEvent } = require("../services/returnsService");

const router = express.Router();

router.post("/events", async (req, res, next) => {
  try {
    const { shopDomain, event } = req.body;
    if (!shopDomain || !event) {
      return res.status(400).json({ error: "shopDomain and event are required" });
    }

    const result = await processReturnEvent({ shopDomain, payload: event });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
