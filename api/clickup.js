const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const event = req.body.event;
    const task = req.body.task;

    if (event === "taskStatusUpdated") {
      const taskId = task.id;
      const newStatus = task.status.status;
      const customFields = task.custom_fields;

      const fdTicketField = customFields.find(f => f.name === "Freshdesk Ticket ID");
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (freshdeskTicketId) {
        await updateFreshdeskTicketStatus(freshdeskTicketId, newStatus);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook handler error:", error);
    res.status(500).send("Server Error");
  }
};

async function updateFreshdeskTicketStatus(ticketId, clickupStatus) {
  const statusMap = {
    "To Do": 2,
    "In Progress": 3,
    "Done": 4
  };

  const freshdeskStatus = statusMap[clickupStatus] || 2;

  try {
    await axios.put(
      `https://${process.env.FRESHDESK_DOMAIN}/api/v2/tickets/${ticketId}`,
      { status: freshdeskStatus },
      {
        auth: {
          username: process.env.FRESHDESK_API_KEY,
          password: "X"
        },
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    console.error("Freshdesk Update Error:", err.response?.data || err.message);
  }
}
