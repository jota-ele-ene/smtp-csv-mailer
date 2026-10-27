const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { parse } = require("csv-parse/sync");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;

function normalizeKey(key = "") {
  return String(key)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function renderTemplate(template, row) {
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (match, key) => {
    const normalizedKey = normalizeKey(key);
    const value =
      row[key] ??
      row[normalizedKey] ??
      row[key.trim()] ??
      row[key.trim().toLowerCase()] ??
      "";

    return value === null || value === undefined ? "" : String(value);
  });
}

const indexHtml = `
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CSV + HTML Mailer</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f4f7fb;
        margin: 0;
        padding: 32px;
      }
      .container {
        max-width: 640px;
        margin: 0 auto;
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,.08);
      }
      label {
        display: block;
        margin-top: 16px;
        font-weight: 600;
      }
      input[type="file"],
      input[type="text"] {
        width: 100%;
        margin-top: 8px;
        padding: 10px;
        box-sizing: border-box;
      }
      button {
        margin-top: 20px;
        background: #2563eb;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px 18px;
        cursor: pointer;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Enviar correos desde CSV y plantilla HTML</h2>
      <form action="/send" method="POST" enctype="multipart/form-data">
        <label for="htmlFile">Plantilla HTML</label>
        <input id="htmlFile" type="file" name="htmlFile" accept=".html,.htm" required />

        <label for="csvFile">Archivo CSV</label>
        <input id="csvFile" type="file" name="csvFile" accept=".csv" required />

        <label for="toColumn">Columna con el correo destinatario</label>
        <input id="toColumn" type="text" name="toColumn" value="email" required />

        <label for="subject">Asunto del correo</label>
        <input id="subject" type="text" name="subject" value="Notificación" required />

        <button type="submit">Enviar correos</button>
      </form>
    </div>
  </body>
</html>
`;

app.get("/", (req, res) => {
  res.send(indexHtml);
});

app.post(
  "/send",
  upload.fields([
    { name: "htmlFile", maxCount: 1 },
    { name: "csvFile", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const htmlFile = req.files?.htmlFile?.[0];
      const csvFile = req.files?.csvFile?.[0];
      const toColumn = (req.body.toColumn || "email").trim();
      const subject = (req.body.subject || "Notificación").trim();

      if (!htmlFile || !csvFile) {
        return res.status(400).send("Faltan el archivo HTML o el CSV.");
      }

      const htmlTemplate = htmlFile.buffer.toString("utf8");
      const csvText = csvFile.buffer.toString("utf8");

      const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        trim: true
      });

      if (!rows.length) {
        return res.status(400).send("El CSV no contiene filas.");
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      let sent = 0;
      const errors = [];

      for (const row of rows) {
        const rowNormalized = {};
        Object.keys(row).forEach((key) => {
          rowNormalized[normalizeKey(key)] = row[key];
        });

        const recipient = row[toColumn] ?? rowNormalized[normalizeKey(toColumn)];

        if (!recipient) {
          errors.push(`Fila sin destinatario: ${JSON.stringify(row)}`);
          continue;
        }

        const finalHtml = renderTemplate(htmlTemplate, { ...row, ...rowNormalized });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: recipient,
          subject,
          html: finalHtml
        });

        sent++;
      }

      if (errors.length > 0) {
        return res.status(200).send(
          `Se enviaron ${sent} correos. Algunos registros se omitieron: ${errors.join(" | ")}`
        );
      }

      res.send(`Se enviaron correctamente ${sent} correos.`);
    } catch (error) {
      console.error(error);
      res.status(500).send("Error al procesar los archivos o al enviar los correos.");
    }
  }
);

app.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});