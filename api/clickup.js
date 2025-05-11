const axios = require("axios");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const { event, task } = req.body;
    if (event !== "taskStatusUpdated") return res.status(200).send("Ignored");

    // 1. Extract Freshdesk Ticket ID
    const freshdeskTicketId = task.custom_fields?.find(
      field => field.name === "Freshdesk Ticket ID"
    )?.value;

    if (!freshdeskTicketId) {
      console.log("No Freshdesk Ticket ID found");
      return res.status(200).send("No Ticket ID");
    }

    // 2. Map ClickUp status → Freshdesk status
    const statusMap = {
      "to do": 2,       // Open
      "in progress": 3,  // Pending
      "done": 4          // Resolved
    };
    const freshdeskStatus = statusMap[task.status.status.toLowerCase()] || 2;

    // 3. Update Freshdesk
    await axios.put(
      `https://${process.env.FRESHDESK_DOMAIN}/api/v2/tickets/${freshdeskTicketId}`,
      { status: freshdeskStatus },
      {
        auth: {
          username: process.env.FRESHDESK_API_KEY,
          password: "X" // Freshdesk requires 'X' as password with API key
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    res.status(200).send("Updated Freshdesk");
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.status(500).send("Failed to update Freshdesk");
  }
};