const axios = require("axios");

// -----------------------------
// Type mapping (UNCHANGED)
// -----------------------------
const TYPE_MAP_REVERSE = {
  "1003": "Make a Request",
  "1001": "Report a Bug",
  "0": "General Enquiry"
};

// -----------------------------
// Helpers
// -----------------------------
const normalize = (s) =>
  String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

// Use the EXACT IDs from your Freshdesk field dump
const FRESHDESK_STATUS_BY_LABEL = Object.freeze({
  // Primary labels (must match Freshdesk)
  "ticket created": 8,
  "submitted for review": 9,
  "under review": 10,
  "quoted": 12,
  "please action": 13,
  "scheduled": 14,
  "in progress": 15,
  "quality assurance": 16,
  "awaiting client approval": 17,
  "approved": 20,
  "denied by client": 19,
  "open": 2,
  "pending": 3,
  "resolved": 4,
  "closed": 5,

  // ClickUp wording aliases → map to the correct Freshdesk id
  "awaiting approval": 17, // alias of "awaiting client approval"
  "done": 4,               // treat as Resolved
  "complete": 5,           // treat as Closed
  "denied": 19,            // alias of "denied by client"
  "investigation": 2       // map to Open (no id 11 in Freshdesk)
});

/**
 * Fetch a ClickUp list (to read its statuses).
 */
async function fetchClickUpList(listId, token) {
  const resp = await axios.get(`https://api.clickup.com/api/v2/list/${listId}`, {
    headers: { Authorization: token, "Content-Type": "application/json" }
  });
  return resp.data;
}

/**
 * Fallback: fetch the task to read its status label directly.
 */
async function fetchClickUpTask(taskId, token) {
  const resp = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`, {
    headers: { Authorization: token, "Content-Type": "application/json" }
  });
  return resp.data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    console.log("Method Not Allowed:", req.method);
    return res.status(405).send("Method Not Allowed");
  }

  let rawBody = "";
  req.on("data", (chunk) => { rawBody += chunk; });

  req.on("end", async () => {
    try {
      const fullWebhookPayload = JSON.parse(rawBody);
      console.log("--- Full Webhook Payload Received ---", JSON.stringify(fullWebhookPayload, null, 2));

      const taskData = fullWebhookPayload.payload;
      if (!taskData || !taskData.id || !taskData.lists || taskData.lists.length === 0) {
        console.warn("Webhook payload does not contain expected task data structure (id or lists missing).");
        return res.status(200).send("Ignored: Invalid payload structure");
      }

      const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
      if (!CLICKUP_API_TOKEN) {
        console.error("CLICKUP_API_TOKEN environment variable is not set.");
        return res.status(500).send("Server Error: ClickUp API token not configured.");
      }

      const listIds = taskData.lists.map(l => l.list_id);
      const clickupStatusId = taskData.status_id;

      // -----------------------------
      // Resolve the correct list that contains this status_id
      // -----------------------------
      let clickupListStatuses = [];
      let matchedListId = null;

      for (const lid of listIds) {
        try {
          const listData = await fetchClickUpList(lid, CLICKUP_API_TOKEN);
          const statuses = Array.isArray(listData?.statuses) ? listData.statuses : [];
          if (!statuses.length) continue;

          if (statuses.some(s => s.id === clickupStatusId)) {
            clickupListStatuses = statuses;
            matchedListId = lid;
            break;
          }

          // Keep a fallback candidate (first non-empty) in case we never find a direct match
          if (!clickupListStatuses.length) clickupListStatuses = statuses;
        } catch (e) {
          console.warn(`Failed to fetch list ${lid}:`, e.response?.data || e.message);
        }
      }

      if (!clickupListStatuses.length) {
        console.warn("Could not fetch any statuses for the task's lists; defaulting to label mapping only.");
      }

      // -----------------------------
      // Build statusMap from the matched list's statuses (id -> Freshdesk id)
      // -----------------------------
      const statusMap = {};
      for (const { status, id } of clickupListStatuses) {
        const key = normalize(status);
        const freshdeskId = FRESHDESK_STATUS_BY_LABEL[key];
        if (freshdeskId !== undefined) {
          statusMap[id] = freshdeskId;
        }
      }

      // -----------------------------
      // Extract Freshdesk Ticket ID (custom field on ClickUp)
      // -----------------------------
      const FRESHDESK_CUSTOM_FIELD_ID = "c6d06740-a69d-4942-8cf2-5b0823d0a806";
      const fdTicketField = taskData.fields?.find(
        (field) => field.field_id === FRESHDESK_CUSTOM_FIELD_ID
      );
      const freshdeskTicketId = fdTicketField ? fdTicketField.value : null;

      if (!freshdeskTicketId) {
        console.log("No Freshdesk Ticket ID custom field found or value is empty for task:", taskData.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // -----------------------------
      // Determine Freshdesk Status
      //   1) Try mapping by status_id using the matched list
      //   2) If not found, map by status label fetched from ClickUp task
      //   3) Fallback to Open (2)
      // -----------------------------
      let freshdeskStatus = statusMap[clickupStatusId];

      if (freshdeskStatus === undefined) {
        // Try to get the label from the matched list first
        let cuStatusLabel =
          clickupListStatuses.find(s => s.id === clickupStatusId)?.status;

        if (!cuStatusLabel) {
          // Fallback to fetching the task to get its current status label
          try {
            const cuTask = await fetchClickUpTask(taskData.id, CLICKUP_API_TOKEN);
            // Try both shapes: cuTask.status.status or cuTask.status
            cuStatusLabel = cuTask?.status?.status || cuTask?.status || null;
          } catch (e) {
            console.warn("Failed to fetch task status label. Falling back to Open:", e.response?.data || e.message);
          }
        }

        if (cuStatusLabel) {
          const fdId = FRESHDESK_STATUS_BY_LABEL[normalize(cuStatusLabel)];
          if (fdId !== undefined) {
            freshdeskStatus = fdId;
          }
        }
      }

      if (freshdeskStatus === undefined) {
        console.warn("Could not map status by id or label; defaulting to Open (2).");
        freshdeskStatus = 2; // Open
      }

      // -----------------------------
      // Type logic (UNCHANGED)
      // -----------------------------
      let typeCustomId =
        typeof taskData.custom_type !== "undefined" && taskData.custom_type !== null
          ? String(taskData.custom_type)
          : "0";
      let freshdeskType = TYPE_MAP_REVERSE[typeCustomId] || "General Enquiry";
      console.log(`Detected type custom_type: ${typeCustomId}, mapped to Freshdesk type: ${freshdeskType}`);

      // -----------------------------
      // Update Freshdesk
      // -----------------------------
      const fdPayload = { status: freshdeskStatus, type: freshdeskType };
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
