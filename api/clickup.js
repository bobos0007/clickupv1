const axios = require("axios");

// Map ClickUp custom_type values to Freshdesk type strings
const TYPE_MAP_REVERSE = {
  "1003": "Make a Request",     // Or "Question"
  "1001": "Report a Bug",       // Or "Incident"
  "": "General Enquiry"
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    console.log("Method Not Allowed:", req.method);
    return res.status(405).send("Method Not Allowed");
  }

  let rawBody = '';
  req.on('data', (chunk) => { rawBody += chunk; });

  req.on('end', async () => {
    try {
      const fullWebhookPayload = JSON.parse(rawBody);
      console.log("--- Full Webhook Payload Received ---", JSON.stringify(fullWebhookPayload, null, 2));
      const taskData = fullWebhookPayload.payload; 
      if (!taskData || !taskData.id || !taskData.lists || taskData.lists.length === 0) {
        console.warn("Webhook payload does not contain expected task data structure (id or lists missing).");
        return res.status(200).send("Ignored: Invalid payload structure");
      }

      const listId = taskData.lists[0].list_id; 
      if (!listId) {
        console.warn("Could not find list ID in webhook payload for task:", taskData.id);
        return res.status(200).send("Ignored: List ID not found in payload.");
      }

      // Fetch ClickUp List Statuses
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
        }
      } catch (clickupApiError) {
        console.error("Error fetching ClickUp list statuses:", clickupApiError.response?.data || clickupApiError.message);
        return res.status(500).send("Failed to fetch ClickUp list statuses.");
      }

      // Build Status Mapping
      const freshdeskStatusMappingTable = {
        "ticket created": 8,
        "submitted for review": 9,
        "under review": 10,
        "investigation": 11,
        "quoted": 12,
        "accepted": 13,
        "please action": 14,
        "in progress": 15,
        "quality assurance": 16,
        "awaiting approval": 17,
        "done": 4,
        "denied": 19,
        "complete": 5
      };
      const statusMap = {};
      clickupListStatuses.forEach(status => {
        const freshdeskId = freshdeskStatusMappingTable[status.status.toLowerCase()];
        if (freshdeskId !== undefined) {
          statusMap[status.id] = freshdeskId;
        }
      });

      // Extract Freshdesk Ticket ID (custom field on ClickUp)
      const FRESHDESK_CUSTOM_FIELD_ID = "88b9d9b1-b8b7-49ac-ae87-743c76e1e438"; 
      const fdTicketField = taskData.fields?.find(
        (field) => field.field_id === FRESHDESK_CUSTOM_FIELD_ID
      );
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (!freshdeskTicketId) {
        console.log("No Freshdesk Ticket ID custom field found or value is empty for task:", taskData.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // Get Freshdesk Status from ClickUp Status
      const clickupStatusId = taskData.status_id;
      const freshdeskStatus = statusMap[clickupStatusId] || 2; // Default to 'Open' if not mapped

      // Extract Type from ClickUp root field 'custom_type'
      const typeCustomId = taskData.custom_type ? String(taskData.custom_type) : null;
      let freshdeskType;
      if (typeCustomId && TYPE_MAP_REVERSE[typeCustomId]) {
        freshdeskType = TYPE_MAP_REVERSE[typeCustomId];
      }
      console.log(`Detected type custom_type: ${typeCustomId}, mapped to Freshdesk type: ${freshdeskType}`);

      // Build Freshdesk update payload
      const fdPayload = { status: freshdeskStatus };
      if (freshdeskType) fdPayload.type = freshdeskType;

      // Update Freshdesk
      console.log(`Updating Freshdesk Ticket ${freshdeskTicketId}:`, fdPayload);
      await axios.put(
        `https://${process.env.FRESHDESK_DOMAIN}/api/v2/tickets/${freshdeskTicketId}`,
        fdPayload,
        {
          auth: {
            username: process.env.FRESHDESK_API_KEY,
            password: "X"
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
