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
      const fullWebhookPayload = JSON.parse(rawBody); // Parse the raw body
      
      // >>> THIS IS THE NEW DEBUG LOGGING LINE <<<
      console.log("--- Full Webhook Payload Received ---", JSON.stringify(fullWebhookPayload, null, 2));
      // >>> END NEW DEBUG LOGGING LINE <<<

      // Access the nested 'payload' object which contains the task data
      const taskData = fullWebhookPayload.payload; 

      // Check if taskData is valid before proceeding
      if (!taskData || !taskData.id) {
        console.warn("Webhook payload does not contain expected task data structure.");
        return res.status(200).send("Ignored: Invalid payload structure");
      }

      console.log("Received ClickUp Webhook for Task ID:", taskData.id);

      // 1. Extract Freshdesk Ticket ID from 'fields' array using field_id
      const FRESHDESK_CUSTOM_FIELD_ID = "88b9d9b1-b8b7-49ac-ae87-743c76e1e438"; 
      const fdTicketField = taskData.fields?.find(
        (field) => field.field_id === FRESHDESK_CUSTOM_FIELD_ID
      );
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (!freshdeskTicketId) {
        console.log("No Freshdesk Ticket ID custom field found or value is empty for task:", taskData.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // 2. Map ClickUp status_id → Freshdesk status
      // Mapped using the exact ClickUp status IDs you provided for the "New Incoming Tickets" list
      const statusMap = {
        "sc901604897170_hXeuKmFa": 8,       // "ticket created" -> Freshdesk: "Ticket Created" (id: 8)
        "sc901604897170_TSw8mpUA": 9,       // "submitted for review" -> Freshdesk: "Submitted for Review" (id: 9)
        "sc901604897170_4wr7RNWI": 10,      // "under review" -> Freshdesk: "Under Review" (id: 10)
        "sc901604897170_aObOJ5Dy": 11,      // "investigation" -> Freshdesk: "Under Investigation" (id: 11)
        "sc901604897170_6GHlwGYr": 12,      // "quoted" -> Freshdesk: "Quoted" (id: 12)
        "sc901604897170_b19XgsDM": 13,      // "accepted" -> Freshdesk: "Accepted" (id: 13)
        "sc901604897170_Do6efWsC": 14,      // "please action" -> Freshdesk: "Please Action" (id: 14)
        "sc901604897170_Rr2Ryl1v": 15,      // "in progress" -> Freshdesk: "In Progress" (id: 15)
        "sc901604897170_B8cc60HL": 16,      // "quality assurance" -> Freshdesk: "Quality Assurance" (id: 16)
        "sc901604897170_9BpWKiMK": 17,      // "awaiting approval" -> Freshdesk: "Awaiting Approval" (id: 17)
        "sc901604897170_uXKirffs": 4,       // "done" -> Freshdesk: "Resolved" (id: 4)
        "sc901604897170_HwuQk2Mz": 19,      // "denied" -> Freshdesk: "Denied" (id: 19)
        "sc901604897170_JVk3Y4Bn": 5        // "complete" -> Freshdesk: "Closed" (id: 5)
      };
      
      const clickupStatusId = taskData.status_id;
      const freshdeskStatus = statusMap[clickupStatusId] || 2; // Default to Freshdesk 'Open' (id: 2) if status_id not mapped

      console.log(`Attempting to update Freshdesk Ticket ${freshdeskTicketId} to status ${freshdeskStatus} (from ClickUp status ID: ${clickupStatusId})`);

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
