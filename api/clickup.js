const axios = require("axios");
// const crypto = require("crypto"); // Uncomment if you re-introduce signature verification

module.exports = async (req, res) => {
  // Ensure it's a POST request
  if (req.method !== "POST") {
    console.log("Method Not Allowed:", req.method);
    return res.status(405).send("Method Not Allowed");
  }

  let rawBody = ''; // To store the raw request body

  // Collect the raw body chunks
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {


      const payload = JSON.parse(rawBody); // Parse the raw body after any potential verification

      // >>> THIS IS THE NEW DEBUG LOGGING LINE <<<
      console.log("--- Full Webhook Payload Received ---", JSON.stringify(payload, null, 2));
      // >>> END NEW DEBUG LOGGING LINE <<<

      const { event, task } = payload; 

      console.log("Received ClickUp Webhook. Event:", event, "Task ID:", task?.id);

      // 1. Extract Freshdesk Ticket ID
      // Using optional chaining defensively, as 'task' or 'custom_fields' might be missing depending on event
      const freshdeskTicketId = task?.custom_fields?.find(
        (field) => field.name === "Freshdesk Ticket ID"
      )?.value;

      if (!freshdeskTicketId) {
        console.log("No Freshdesk Ticket ID custom field found or value is empty for task:", task?.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // 2. Map ClickUp status → Freshdesk status
      const statusMap = {
        "to do": 2,       // Open
        "in progress": 3, // Pending
        "done": 4         // Resolved
        // Add more mappings if your ClickUp statuses differ or you have more Freshdesk statuses
      };
      // Ensure task.status.status exists before calling toLowerCase()
      const clickupStatus = task?.status?.status;
      const freshdeskStatus = clickupStatus ? statusMap[clickupStatus.toLowerCase()] || 2 : 2; // Default to 'Open' if status not found

      console.log(`Attempting to update Freshdesk Ticket ${freshdeskTicketId} to status ${freshdeskStatus} (from ClickUp status: ${clickupStatus})`);

      // 3. Update Freshdesk
      await axios.put(
        `https://${process.env.FRESHDESK_DOMAIN}/api/v2/tickets/${freshdeskTicketId}`,
        { status: freshdeskStatus },
        {
          auth: {
            username: process.env.FRESHDESK_API_KEY,
            password: "X" // Freshdesk requires 'X' as password with API key for API key auth
          },
          headers: { "Content-Type": "application/json" }
        }
      );

      console.log("Successfully updated Freshdesk Ticket:", freshdeskTicketId);
      res.status(200).send("Updated Freshdesk");

    } catch (error) {
      console.error("Webhook handler error:", error.response?.data || error.message);
      res.status(500).send("Failed to update Freshdesk");
    }
  });
};
