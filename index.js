// index.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// Webhook endpoint for ClickUp
debugLog = (...args) => process.env.DEBUG === 'true' && console.log(...args);

app.post("/clickup/webhook", async (req, res) => {
  try {
    const event = req.body.event;
    const task = req.body.task;

    if (event === "taskStatusUpdated") {
      const taskId = task.id;
      const newStatus = task.status.status;
      const customFields = task.custom_fields;

      debugLog("Task ID:", taskId);
      debugLog("New Status:", newStatus);

      const fdTicketField = customFields.find(f => f.name === "Freshdesk Ticket ID");
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (freshdeskTicketId) {
        console.log(`Updating Freshdesk ticket ${freshdeskTicketId} to status: ${newStatus}`);
        await updateFreshdeskTicketStatus(freshdeskTicketId, newStatus);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook handler error:", error);
    res.sendStatus(500);
  }
});

// Function to update Freshdesk ticket status
async function updateFreshdeskTicketStatus(ticketId, clickupStatus) {
  const freshdeskDomain = process.env.FRESHDESK_DOMAIN;
  const apiKey = process.env.FRESHDESK_API_KEY;

  // Map ClickUp statuses to Freshdesk statuses (adjust as needed)
  const statusMap = {
    "To Do": 2,        // Open
    "In Progress": 3,  // Pending
    "Done": 4          // Resolved
  };

  const freshdeskStatus = statusMap[clickupStatus] || 2;

  try {
    await axios.put(
      `https://${freshdeskDomain}/api/v2/tickets/${ticketId}`,
      { status: freshdeskStatus },
      {
        auth: {
          username: apiKey,
          password: "X"
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log(`✔️ Freshdesk ticket ${ticketId} updated to status ${freshdeskStatus}`);
  } catch (err) {
    console.error("❌ Freshdesk Update Error:", err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
