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
      // Mapped using the status IDs from your provided JSON for "Test Space - Freshdesk"
      // and the Freshdesk status IDs you just provided.
      const statusMap = {
        // ClickUp Status IDs from "Test Space - Freshdesk" (id: "90163965231")
        "p90163965231_LLmr2NNk": 8,       // "ticket created" -> Freshdesk: "Ticket Created" (id: 8)
        "p90163965231_cF6OeX3T": 3,       // "submitted for review" -> Freshdesk: "Pending" (id: 3)
        "p90163965231_Llq8o0Uc": 3,       // "under review" -> Freshdesk: "Pending" (id: 3)
        "p90163965231_uyv7P5Pp": 3,       // "investigation" -> Freshdesk: "Pending" (id: 3)
        "p90163965231_HFWxpVet": 12,      // "quoted" -> Freshdesk: "Quoted" (id: 12)
        "p90163965231_HpuoC5BG": 13,      // "accepted" -> Freshdesk: "Accepted" (id: 13)
        "p90163965231_glhCaY84": 14,      // "please action" -> Freshdesk: "Please Action" (id: 14)
        "p90163965231_MgsXW8d7": 15,      // "in progress" -> Freshdesk: "In Progress" (id: 15)
        "p90163965231_f8Cru25U": 16,      // "quality assurance" -> Freshdesk: "Quality Assurance" (id: 16)
        "p90163965231_kIC6YiUS": 17,      // "awaiting approval" -> Freshdesk: "Awaiting Approval" (id: 17)
        "p90163965231_yx9ouZ2H": 4,       // "done" -> Freshdesk: "Resolved" (id: 4)
        "p90163965231_dYVAaXW5": 19,      // "denied" -> Freshdesk: "Denied" (id: 19)
        "p90163965231_bLuLidsM": 5        // "complete" -> Freshdesk: "Closed" (id: 5)
        
        // You can add more mappings for other ClickUp spaces (Personal, Company Space)
        // if you need to handle tasks from those spaces as well, using their specific IDs.
        // For example:
        // "p90161743460_p6926177_l16juwBq": 2, // "to do" from Personal -> Freshdesk: Open
        // "p90161743460_p6926177_5nEOGIaE": 3, // "in progress" from Personal -> Freshdesk: Pending
        // "p90161743460_p6926177_g9ScQ4FP": 4, // "completed" from Personal -> Freshdesk: Resolved
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
