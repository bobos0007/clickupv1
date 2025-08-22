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

// Use the EXACT IDs from your Freshdesk status field dump
const FRESHDESK_STATUS_BY_LABEL = Object.freeze({
  // Primary labels (must match Freshdesk)
  "ticket created": 8,
  "submitted for review": 9,
  "under review": 10,
  "awaiting authorisation": 12,
  "please action": 13,
  "scheduled": 14,
  "in progress": 15,
  "quality assurance": 16,
  "awaiting client approval": 17,
  "authorised by client": 20,
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

// -----------------------------
// Webhook handler
// -----------------------------
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
      if (!taskData || !taskData.id) {
        console.warn("Invalid payload (missing task id).");
        return res.status(200).send("Ignored: Invalid payload structure");
      }

      // -----------------------------
      // Env checks
      // -----------------------------
      const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
      if (!CLICKUP_API_TOKEN) {
        console.error("CLICKUP_API_TOKEN environment variable is not set.");
        return res.status(500).send("Server Error: ClickUp API token not configured.");
      }
      if (!process.env.FRESHDESK_DOMAIN || !process.env.FRESHDESK_API_KEY) {
        console.error("Freshdesk env vars missing (FRESHDESK_DOMAIN/FRESHDESK_API_KEY).");
        return res.status(500).send("Server Error: Freshdesk configuration missing.");
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
        console.log("No Freshdesk Ticket ID found for task:", taskData.id);
        return res.status(200).send("No Freshdesk Ticket ID found");
      }

      // -----------------------------
      // Get the task's CURRENT status label from ClickUp
      // (independent of lists; works when you MOVE tasks)
      // -----------------------------
      let cuStatusLabel = null;
      try {
        const cuTaskResp = await axios.get(
          `https://api.clickup.com/api/v2/task/${taskData.id}`,
          { headers: { Authorization: CLICKUP_API_TOKEN, "Content-Type": "application/json" } }
        );
        // ClickUp can return either { status: { status: "Label", id: ... } } or a flat status string
        cuStatusLabel = cuTaskResp.data?.status?.status || cuTaskResp.data?.status || null;
      } catch (e) {
        console.warn("Failed to fetch ClickUp task for status label:", e.response?.data || e.message);
      }

      // Map to Freshdesk status id
      let freshdeskStatus = 2; // default Open
      if (cuStatusLabel) {
        const mapped = FRESHDESK_STATUS_BY_LABEL[normalize(cuStatusLabel)];
        if (mapped !== undefined) {
          freshdeskStatus = mapped;
        } else {
          console.warn("No Freshdesk mapping for ClickUp status label:", cuStatusLabel, "-> defaulting to Open (2)");
        }
      } else {
        console.warn("No ClickUp status label retrieved; defaulting to Open (2)");
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
          auth: { username: process.env.FRESHDESK_API_KEY, password: "X" },
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
