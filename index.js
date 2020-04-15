require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { promisify } = require("util");
const writeFile = promisify(fs.writeFile);

const uuid = require("uuid");
const sulla = require("sulla");
const express = require("express");
const bodyParser = require("body-parser");

const FormData = require("form-data");
const fetch = require("node-fetch");
const ADMIN_SENDER = process.env.SULLA_ADMIN_SENDER.replace("+", "") + "@c.us";

// Create media dir
fs.mkdirSync(process.env.SULLA_MEDIA_DIR, { recursive: true });

async function onAdminMessage(client, message) {
  if (message["from"] === ADMIN_SENDER) {
    if (message.body === "👋") {
      await client.sendText(message.from, "👋");
      return false;
    }
  }
  return true;
}

async function onMessage(client, message) {
  if (!(await onAdminMessage(client, message))) {
    return;
  }
  const form = new FormData();
  const body = message.isMedia ? message.caption : message.body;
  // Seems to be exactly 32 char :sweat_smile:
  const uid = message.id.substr(message.id.length - 32);

  form.append("AccountSid", "sulla");
  form.append("MessageSid", "SU" + uid);
  form.append("From", "whatsapp:+" + message["from"].split("@")[0]);
  form.append("To", "whatsapp:+" + message["to"].split("@")[0]);

  console.log("New message from", message["from"]);

  if (message.isMedia) {
    const filename = uuid.v4();
    const buffer = await client.downloadFile(message);
    await writeFile(
      path.join(process.env.SULLA_MEDIA_DIR, filename),
      buffer,
      console.log
    );
    form.append("Body", message.caption || "");
    form.append("NumMedia", "1");
    form.append("MediaContentType0", message.mimetype);
    form.append("MediaUrl0", process.env.SULLA_MEDIA_ROOT + filename);
  } else {
    form.append("Body", message.body || "");
    form.append("NumMedia", "0");
  }
  const response = await fetch(process.env.SULLA_ENDPOINT, {
    method: "POST",
    body: form,
    headers: { "X-Sulla-Shared-Secret": process.env.SULLA_SHARED_SECRET }
  });
  if (!response.ok) {
    throw new Error(response.statusText);
  }
}

function startWhatsapp(client) {
  client.onMessage(async message => {
    try {
      onMessage(client, message);
    } catch (e) {
      console.log(message);
      console.error(e);
    }
  });
}

function startAPI(client) {
  // API Server
  const HELP = `LetsCheck WhatsApp Proxy.

  GET   /                   This help page
  GET   /media/<uuid>       Media files are available here
  POST  /messages/create    Send a new message
        recipient=49123456789
        body=The body of the message.
`;

  const app = express();
  const port = process.env.SULLA_SERVER_PORT;

  app.use(bodyParser.urlencoded({ extended: false }));
  app.use("/media", express.static("media"));

  app.post("/messages/create", async (req, res) => {
    console.log("Send message to", req.body.recipient);
    const recipient = req.body.recipient.replace("+", "") + "@c.us";
    const body = req.body.body;
    try {
      const msg = await client.sendText(recipient, body);
      if (msg === false) {
        throw new Error("Wrong message format");
      }
      res.send("OK");
    } catch (e) {
      res.status(400);
      res.send(e);
    }
  });

  app.get("/", (req, res) => {
    res.send(HELP);
  });

  app.listen(port, () =>
    console.log(`${HELP}\nServer listening at http://localhost:${port}\n`)
  );
}

sulla.create().then(client => {
  startWhatsapp(client);
  startAPI(client);
});
