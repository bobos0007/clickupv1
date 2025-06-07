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
      // --- Security: X-ClickUp-Signature Verification ---
      // If you re-introduce signature verification, uncomment and configure this section.
      // const signature = req.headers["x-clickup-signature"];
      // const clickupWebhookSecret = process.env.CLICKUP_WEBHOOK_SECRET;
      // if (!clickupWebhookSecret) {
      //   console.error("CLICKUP_WEBHOOK_SECRET environment variable is not set.");
      //   return res.status(500).send("Server Error: Webhook secret not configured.");
      // }
      // const calculatedSignature = crypto
      //   .createHmac("sha256", clickupWebhookSecret)
      //   .update(rawBody)
      //   .digest("hex");
      // if (signature !== calculatedSignature) {
      //   console.warn("Invalid X-ClickUp-Signature. Received:", signature, "Calculated:", calculatedSignature);
      //   return res.status(401).send("Unauthorized: Invalid Signature");
      // }
      // --- End Security Check ---

      const fullWebhookPayload = JSON.parse(rawBody); // Parse the raw body
      
      console.log("--- Full Webhook Payload Received ---", JSON.stringify(fullWebhookPayload, null, 2));

      // Access the nested 'payload' object which contains the task data
      const taskData = fullWebhookPayload.payload; 

      // Check if taskData is valid before proceeding
      if (!taskData || !taskData.id || !taskData.lists || taskData.lists.length === 0) {
        console.warn("Webhook payload does not contain expected task data structure (id or lists missing).");
        return res.status(200).send("Ignored: Invalid payload structure");
      }

      console.log("Received ClickUp Webhook for Task ID:", taskData.id);

      // Extract the list ID from the task data
      const listId = taskData.lists[0].id;
      if (!listId) {
          console.warn("Could not find list ID in webhook payload for task:", taskData.id);
          return res.status(200).send("Ignored: List ID not found in payload.");
      }

      // 1. Fetch list details from ClickUp to get dynamic statuses
      // This requires CLICKUP_API_TOKEN to be set in Vercel environment variables.
      const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
      if (!CLICKUP_API_TOKEN) {
        console.error("CLICKUP_API_TOKEN environment variable is not set.");
        return res.status(500).send("Server Error: ClickUp API token not configured.");
      }

      let clickupListStatuses = [];
      try {
        const listResponse = await axios.get(
          `https://api.clickup.com/api/v2/list/${listId}`,
          {
            headers: {
              'Authorization': CLICKUP_API_TOKEN,
              'Content-Type': 'application/json'
            }
          }
        );
        if (listResponse.data && listResponse.data.statuses) {
          clickupListStatuses = listResponse.data.statuses;
          console.log(`Fetched ${clickupListStatuses.length} statuses for List ID: ${listId}`);
        } else {
            console.warn(`No statuses found for List ID: ${listId} in ClickUp API response.`);
        }
      } catch (clickupApiError) {
        console.error("Error fetching ClickUp list statuses:", clickupApiError.response?.data || clickupApiError.message);
        return res.status(500).send("Failed to fetch ClickUp list statuses.");
      }


      // 2. Build the statusMap dynamically based on fetched ClickUp statuses
      // Map ClickUp status_id to Freshdesk status IDs
      const freshdeskStatusMappingTable = {
        "ticket created": 8,       // Freshdesk: "Ticket Created"
        "submitted for review": 9,   // Freshdesk: "Submitted for Review"
        "under review": 10,        // Freshdesk: "Under Review"
        "investigation": 11,       // Freshdesk: "Under Investigation"
        "quoted": 12,              // Freshdesk: "Quoted"
        "accepted": 13,            // Freshdesk: "Accepted"
        "please action": 14,       // Freshdesk: "Please Action"
        "in progress": 15,         // Freshdesk: "In Progress"
        "quality assurance": 16,   // Freshdesk: "Quality Assurance"
        "awaiting approval": 17,   // Freshdesk: "Awaiting Approval"
        "done": 4,                 // Freshdesk: "Resolved"
        "denied": 19,              // Freshdesk: "Denied"
        "complete": 5              // Freshdesk: "Closed"
        // Add more Freshdesk mappings if needed, using the 'status' string from ClickUp
        // e.g., "to do": 2, "open": 2, "pending": 3, "resolved": 4, "closed": 5
      };

      const statusMap = {};
      clickupListStatuses.forEach(status => {
          // Use the status string (lowercase for robustness) from ClickUp to find Freshdesk ID
          const freshdeskId = freshdeskStatusMappingTable[status.status.toLowerCase()];
          if (freshdeskId !== undefined) {
              statusMap[status.id] = freshdeskId;
          }
      });
      console.log("Dynamically built statusMap:", statusMap);


      // Extract Freshdesk Ticket ID from 'fields' array using field_id
      const FRESHDESK_CUSTOM_FIELD_ID = "88b9d9b1-b8b7-49ac-ae87-743c76e1e438"; 
      const fdTicketField = taskData.fields?.find(
        (field) => field.field_id === FRESHDESK_CUSTOM_FIELD_ID
      );
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (!freshdeskTicketId) {
        console.log("No Freshdesk Ticket ID custom field found or value is empty for task:", taskData.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // Get the Freshdesk status based on the dynamically built map
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
