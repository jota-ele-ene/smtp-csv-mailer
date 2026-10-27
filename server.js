const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { parse } = require("csv-parse/sync");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = Number(process.env.PORT || 3000);

const queue = [];
let queueProcessing = false;

function log(message, payload = "") {
  const timestamp = new Date().toISOString();
  if (payload && Object.keys(payload).length > 0) {
    console.log(`[${timestamp}] ${message}`, JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`[${timestamp}] ${message}`);
}

function redactEmail(value) {
  if (!value) return "(empty)";
  const str = String(value);
  if (str.length <= 4) return "***";
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

function smtpConfigSummary() {
  return {
    host: process.env.SMTP_HOST || "(not set)",
    port: process.env.SMTP_PORT || "(not set)",
    secure: String(process.env.SMTP_SECURE || "false"),
    user: redactEmail(process.env.SMTP_USER),
    hasPass: Boolean(process.env.SMTP_PASS),
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "(not set)",
  };
}

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
  return String(template).replace(/{{\s*([^}]+?)\s*}}/g, (match, key) => {
    const cleanedKey = String(key).trim();
    const normalizedKey = normalizeKey(cleanedKey);
    const value =
      row[cleanedKey] ??
      row[normalizedKey] ??
      row[cleanedKey.toLowerCase()] ??
      row[cleanedKey.toUpperCase()] ??
      "";

    return value === null || value === undefined ? "" : String(value);
  });
}

function getCsvRows(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });
}

function prettySubject(row, subjectColumn, defaultSubject) {
  if (!subjectColumn) return defaultSubject;
  const value = row[subjectColumn] ?? row[normalizeKey(subjectColumn)] ?? "";
  return value ? String(value).trim() : defaultSubject;
}

function getTransporter() {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Faltan configuraciones SMTP: ${missing.join(", ")}`);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
    logger: true,
    debug: true,
  });

  transporter.on("log", (info) => {
    log("Nodemailer log event", { info });
  });

  transporter.on("error", (err) => {
    log("Nodemailer transporter error", {
      message: err && err.message,
      stack: err && err.stack,
      code: err && err.code,
    });
  });

  return transporter;
}

async function processQueue(transporter) {
  if (queueProcessing) {
    log("Queue already processing. Skipping extra processing loop.");
    return;
  }

  queueProcessing = true;
  log("Queue processing started.");

  try {
    while (queue.length > 0) {
      const job = queue.shift();
      const { row, htmlTemplate, recipient, subject, attachments, toColumn, fromAddress } = job;

      try {
        log(`Sending email to ${recipient} using column ${toColumn}.`, {
          subject,
          rowKeys: Object.keys(row),
          attachmentCount: (attachments || []).length,
        });

        const mailOptions = {
          from: fromAddress,
          to: recipient,
          subject,
          html: renderTemplate(htmlTemplate, row),
          attachments: (attachments || []).map((file) => ({
            filename: file.originalname,
            content: file.buffer,
            contentType: file.mimetype,
          })),
        };

        log("Mail options prepared", {
          from: fromAddress,
          to: recipient,
          subject,
          attachmentCount: mailOptions.attachments.length,
        });

        const info = await transporter.sendMail(mailOptions);
        log(`Email sent successfully to ${recipient}.`, {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
        });
        job.status = "sent";
      } catch (error) {
        log(`Failed sending to ${recipient}.`, {
          message: error && error.message,
          code: error && error.code,
          responseCode: error && error.responseCode,
          response: error && error.response,
          command: error && error.command,
          stack: error && error.stack,
        });
        job.status = "failed";
        job.error = error && error.message ? error.message : "Unknown error";
      }
    }
  } finally {
    queueProcessing = false;
    log("Queue processing finished.");
  }
}

function buildPage() {
  return [
    '<!doctype html>',
    '<html lang="es">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>SMTP CSV Mailer</title>',
    '    <style>',
    '      :root {',
    '        --bg: #eef4ff;',
    '        --card: #ffffff;',
    '        --primary: #2563eb;',
    '        --primary-dark: #1d4ed8;',
    '        --text: #14213d;',
    '        --muted: #64748b;',
    '        --border: #dfe7f3;',
    '        --success: #16a34a;',
    '        --warning: #d97706;',
    '        --danger: #dc2626;',
    '        --shadow: 0 20px 40px rgba(37, 99, 235, 0.12);',
    '      }',
    '',
    '      * { box-sizing: border-box; }',
    '',
    '      body {',
    '        margin: 0;',
    '        min-height: 100vh;',
    '        font-family: Inter, Arial, sans-serif;',
    '        background: linear-gradient(180deg, #edf6ff 0%, #f8fbff 100%);',
    '        color: var(--text);',
    '      }',
    '',
    '      .container {',
    '        max-width: 1200px;',
    '        margin: 40px auto;',
    '        padding: 24px;',
    '      }',
    '',
    '      .panel {',
    '        background: var(--card);',
    '        border: 1px solid var(--border);',
    '        border-radius: 22px;',
    '        box-shadow: var(--shadow);',
    '      }',
    '',
    '      .header {',
    '        padding: 30px 32px 18px;',
    '        border-bottom: 1px solid var(--border);',
    '        background: linear-gradient(135deg, rgba(37,99,235,0.08), rgba(148,163,184,0.05));',
    '      }',
    '',
    '      .title {',
    '        margin: 0;',
    '        font-size: clamp(1.8rem, 2vw, 2.6rem);',
    '      }',
    '',
    '      .subtitle {',
    '        margin: 10px 0 0;',
    '        color: var(--muted);',
    '        font-size: 1rem;',
    '      }',
    '',
    '      .layout {',
    '        display: grid;',
    '        grid-template-columns: minmax(320px, 1.4fr) minmax(300px, 0.9fr);',
    '        gap: 24px;',
    '        padding: 24px;',
    '      }',
    '',
    '      .section {',
    '        padding: 24px;',
    '        border: 1px solid var(--border);',
    '        border-radius: 18px;',
    '        background: rgba(248,250,252,0.7);',
    '      }',
    '',
    '      .section h3 {',
    '        margin: 0 0 18px;',
    '        font-size: 1.2rem;',
    '      }',
    '',
    '      .form-grid {',
    '        display: grid;',
    '        grid-template-columns: repeat(2, minmax(220px, 1fr));',
    '        gap: 18px;',
    '      }',
    '',
    '      .field {',
    '        display: flex;',
    '        flex-direction: column;',
    '        gap: 8px;',
    '      }',
    '',
    '      .field.full {',
    '        grid-column: 1 / -1;',
    '      }',
    '',
    '      label {',
    '        font-size: 0.92rem;',
    '        font-weight: 700;',
    '        color: var(--text);',
    '      }',
    '',
    '      input[type="text"],',
    '      input[type="file"],',
    '      select,',
    '      textarea {',
    '        width: 100%;',
    '        padding: 12px 14px;',
    '        border-radius: 12px;',
    '        border: 1px solid var(--border);',
    '        background: white;',
    '        color: var(--text);',
    '        font-size: 0.96rem;',
    '      }',
    '',
    '      input[type="file"] { padding: 10px; }',
    '      textarea {',
    '        min-height: 160px;',
    '        resize: vertical;',
    '        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
    '      }',
    '',
    '      button {',
    '        border: none;',
    '        border-radius: 12px;',
    '        background: linear-gradient(135deg, var(--primary), var(--primary-dark));',
    '        color: white;',
    '        padding: 12px 18px;',
    '        font-size: 0.97rem;',
    '        font-weight: 700;',
    '        cursor: pointer;',
    '        transition: transform 0.15s ease, opacity 0.2s ease;',
    '      }',
    '',
    '      button:hover { transform: translateY(-1px); }',
    '      button.secondary {',
    '        background: #e2e8f0;',
    '        color: var(--text);',
    '      }',
    '',
    '      .actions {',
    '        display: flex;',
    '        gap: 12px;',
    '        flex-wrap: wrap;',
    '        margin-top: 18px;',
    '      }',
    '',
    '      .helper {',
    '        font-size: 0.82rem;',
    '        color: var(--muted);',
    '        margin-top: 6px;',
    '      }',
    '',
    '      .meta {',
    '        margin-top: 18px;',
    '        display: flex;',
    '        flex-wrap: wrap;',
    '        gap: 12px;',
    '      }',
    '',
    '      .chip {',
    '        display: inline-flex;',
    '        align-items: center;',
    '        gap: 8px;',
    '        padding: 8px 12px;',
    '        border-radius: 999px;',
    '        background: #eff6ff;',
    '        color: var(--primary-dark);',
    '        font-weight: 600;',
    '        font-size: 0.8rem;',
    '      }',
    '',
    '      .preview-box {',
    '        background: white;',
    '        border: 1px solid var(--border);',
    '        border-radius: 16px;',
    '        padding: 16px;',
    '        min-height: 260px;',
    '        overflow: auto;',
    '      }',
    '',
    '      .preview-box h4 {',
    '        margin-top: 0;',
    '      }',
    '',
    '      .status {',
    '        margin-top: 18px;',
    '        padding: 14px 16px;',
    '        border-radius: 12px;',
    '        background: #f8fafc;',
    '        border: 1px solid var(--border);',
    '        font-size: 0.92rem;',
    '        display: none;',
    '      }',
    '',
    '      .status.success {',
    '        display: block;',
    '        background: #ecfdf5;',
    '        border-color: #a7f3d0;',
    '        color: #166534;',
    '      }',
    '',
    '      .status.error {',
    '        display: block;',
    '        background: #fef2f2;',
    '        border-color: #fecaca;',
    '        color: #991b1b;',
    '      }',
    '',
    '      .preview-frame {',
    '        border: 1px solid var(--border);',
    '        border-radius: 14px;',
    '        padding: 12px;',
    '        background: white;',
    '      }',
    '',
    '      @media (max-width: 900px) {',
    '        .layout {',
    '          grid-template-columns: 1fr;',
    '        }',
    '      }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <div class="container">',
    '      <div class="panel">',
    '        <div class="header">',
    '          <h1 class="title">Envío masivo con plantilla HTML + CSV</h1>',
    '          <p class="subtitle">Carga una plantilla HTML, un CSV y envía correos personalizados por cada fila.</p>',
    '        </div>',
    '',
    '        <div class="layout">',
    '          <div class="section">',
    '            <h3>Configuración</h3>',
    '            <form id="mailerForm">',
    '              <div class="form-grid">',
    '                <div class="field full">',
    '                  <label for="htmlFile">Plantilla HTML</label>',
    '                  <input id="htmlFile" name="htmlFile" type="file" accept=".html,.htm" required />',
    '                </div>',
    '',
    '                <div class="field full">',
    '                  <label for="csvFile">Archivo CSV</label>',
    '                  <input id="csvFile" name="csvFile" type="file" accept=".csv" required />',
    '                </div>',
    '',
    '                <div class="field">',
    '                  <label for="toColumn">Columna destinatario</label>',
    '                  <select id="toColumn" name="toColumn" required></select>',
    '                </div>',
    '',
    '                <div class="field">',
    '                  <label for="subjectColumn">Columna asunto (opcional)</label>',
    '                  <select id="subjectColumn" name="subjectColumn">',
    '                    <option value="">Usar texto fijo</option>',
    '                  </select>',
    '                </div>',
    '',
    '                <div class="field full">',
    '                  <label for="subject">Asunto fijo</label>',
    '                  <input id="subject" name="subject" type="text" value="Notificación" />',
    '                </div>',
    '',
    '                <div class="field full">',
    '                  <label for="attachments">Adjuntos (opcional)</label>',
    '                  <input id="attachments" name="attachments" type="file" multiple />',
    '                </div>',
    '              </div>',
    '',
    '              <div class="actions">',
    '                <button type="button" id="previewBtn" class="secondary">Vista previa</button>',
    '                <button type="submit" id="sendBtn">Enviar correos</button>',
    '              </div>',
    '',
    '              <div class="helper">La vista previa usa una fila de ejemplo del CSV para comprobar que los campos se sustituyen correctamente.</div>',
    '',
    '              <div id="status" class="status" aria-live="polite"></div>',
    '            </form>',
    '          </div>',
    '',
    '          <div class="section">',
    '            <h3>Vista previa</h3>',
    '            <div class="preview-box">',
    '              <h4>Correo de ejemplo</h4>',
    '              <div id="previewContent" class="preview-frame">',
    '                <p>Selecciona un CSV y una plantilla HTML para ver la vista previa.</p>',
    '              </div>',
    '            </div>',
    '',
    '            <div class="meta">',
    '              <span class="chip" id="rowCountChip">Filas: 0</span>',
    '              <span class="chip" id="columnsChip">Columnas: 0</span>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    '    <script>',
    "      const form = document.getElementById('mailerForm');",
    "      const htmlFileInput = document.getElementById('htmlFile');",
    "      const csvFileInput = document.getElementById('csvFile');",
    "      const toColumnSelect = document.getElementById('toColumn');",
    "      const subjectColumnSelect = document.getElementById('subjectColumn');",
    "      const previewBtn = document.getElementById('previewBtn');",
    "      const sendBtn = document.getElementById('sendBtn');",
    "      const statusBox = document.getElementById('status');",
    "      const previewContent = document.getElementById('previewContent');",
    "      const rowCountChip = document.getElementById('rowCountChip');",
    "      const columnsChip = document.getElementById('columnsChip');",
    '',
    "      let parsedColumns = [];",
    "      let sampleRows = [];",
    '',
    "      function setStatus(message, type = 'success') {",
    "        statusBox.textContent = message;",
    "        statusBox.className = 'status ' + type;",
    "      }",
    '',
    "      function clearStatus() {",
    "        statusBox.textContent = '';",
    "        statusBox.className = 'status';",
    "      }",
    '',
    "      function populateSelect(select, values, selectedValue = '') {",
    "        select.innerHTML = '';",
    "        values.forEach((value) => {",
    "          const option = document.createElement('option');",
    "          option.value = value;",
    "          option.textContent = value;",
    "          if (selectedValue && value === selectedValue) option.selected = true;",
    "          select.appendChild(option);",
    "        });",
    "      }",
    '',
    "      function normalizeKey(value) {",
    "        return String(value || '')",
    "          .trim()",
    "          .toLowerCase()",
    "          .normalize('NFD')",
    "          .replace(/[\\u0300-\\u036f]/g, '')",
    "          .replace(/[^a-z0-9_]+/g, '_')",
    "          .replace(/^_+|_+$/g, '');",
    "      }",
    '',
    "      function renderTemplate(template, row = {}) {",
    "        return String(template).replace(/{{\\s*([^}]+?)\\s*}}/g, (match, key) => {",
    "          const cleanKey = String(key).trim();",
    "          const normalizedKey = normalizeKey(cleanKey);",
    "          const value = row[cleanKey] ?? row[normalizedKey] ?? row[cleanKey.toLowerCase()] ?? '';",
    "          return value === null || value === undefined ? '' : String(value);",
    "        });",
    "      }",
    '',
    "      function readCsvFile(file) {",
    "        return new Promise((resolve, reject) => {",
    "          const reader = new FileReader();",
    "          reader.onload = () => resolve(String(reader.result || ''));",
    "          reader.onerror = () => reject(new Error('No se pudo leer el CSV.'));",
    "          reader.readAsText(file, 'utf-8');",
    "        });",
    "      }",
    '',
    "      function readTemplateFile(file) {",
    "        return new Promise((resolve, reject) => {",
    "          const reader = new FileReader();",
    "          reader.onload = () => resolve(String(reader.result || ''));",
    "          reader.onerror = () => reject(new Error('No se pudo leer la plantilla HTML.'));",
    "          reader.readAsText(file, 'utf-8');",
    "        });",
    "      }",
    '',
    "      async function loadCsvData() {",
    "        const csvFile = csvFileInput.files[0];",
    "        if (!csvFile) {",
    "          setStatus('Debes elegir un archivo CSV.', 'error');",
    "          return;",
    "        }",
    '',
    "        try {",
    "          clearStatus();",
    "          const csvText = await readCsvFile(csvFile);",
    "          const lines = csvText.split(/\\r?\\n/).filter((line) => line.trim() !== '');",
    "          if (lines.length < 2) {",
    "            setStatus('El CSV debe incluir cabeceras y al menos una fila de datos.', 'error');",
    "            return;",
    "          }",
    '',
    "          const headerLine = lines[0];",
    "          const headers = headerLine.split(',').map((header) => header.trim().replace(/^\\"|\\"$/g, ''));",
    "          parsedColumns = headers.filter(Boolean);",
    '',
    "          const rows = [];",
    "          for (let i = 1; i < lines.length; i++) {",
    "            const values = lines[i].split(',');",
    "            const row = {};",
    "            headers.forEach((header, index) => {",
    "              row[header] = (values[index] || '').trim().replace(/^\\"|\\"$/g, '');",
    "            });",
    "            rows.push(row);",
    "          }",
    '',
    "          sampleRows = rows;",
    "          rowCountChip.textContent = 'Filas: ' + rows.length;",
    "          columnsChip.textContent = 'Columnas: ' + parsedColumns.length;",
    '',
    "          const emailColumn = parsedColumns.find((column) => /email|correo|mail/i.test(column)) || parsedColumns[0] || 'email';",
    "          populateSelect(toColumnSelect, parsedColumns, emailColumn);",
    "          populateSelect(subjectColumnSelect, [''].concat(parsedColumns), '');",
    '',
    "          if (parsedColumns.length > 0) {",
    "            setStatus('CSV cargado correctamente. Puedes revisar la vista previa.', 'success');",
    "          }",
    '',
    "          updatePreview();",
    "        } catch (error) {",
    "          setStatus(error.message || 'Error leyendo el CSV.', 'error');",
    "        }",
    "      }",
    '',
    "      async function updatePreview() {",
    "        const htmlFile = htmlFileInput.files[0];",
    "        if (!htmlFile || !sampleRows.length) {",
    "          previewContent.innerHTML = '<p>Selecciona un CSV y una plantilla HTML para ver la vista previa.</p>';",
    "          return;",
    "        }",
    '',
    "        try {",
    "          const templateHtml = await readTemplateFile(htmlFile);",
    "          const row = sampleRows[0];",
    "          previewContent.innerHTML = renderTemplate(templateHtml, row);",
    "        } catch (error) {",
    "          previewContent.innerHTML = '<p>No se pudo cargar la vista previa.</p>';",
    "          setStatus(error.message || 'No se pudo generar la vista previa.', 'error');",
    "        }",
    "      }",
    '',
    "      htmlFileInput.addEventListener('change', updatePreview);",
    "      csvFileInput.addEventListener('change', loadCsvData);",
    "      previewBtn.addEventListener('click', updatePreview);",
    '',
    "      form.addEventListener('submit', async (event) => {",
    "        event.preventDefault();",
    "        clearStatus();",
    '',
    "        const csvFile = csvFileInput.files[0];",
    "        const htmlFile = htmlFileInput.files[0];",
    "        const toColumn = toColumnSelect.value;",
    "        const subjectColumn = subjectColumnSelect.value;",
    "        const subject = document.getElementById('subject').value;",
    '',
    "        if (!htmlFile || !csvFile) {",
    "          setStatus('Debes seleccionar una plantilla HTML y un CSV.', 'error');",
    "          return;",
    "        }",
    '',
    "        if (!toColumn) {",
    "          setStatus('Debes seleccionar la columna del destinatario.', 'error');",
    "          return;",
    "        }",
    '',
    "        try {",
    "          sendBtn.disabled = true;",
    "          sendBtn.textContent = 'Enviando...';",
    '',
    "          const formData = new FormData();",
    "          formData.append('htmlFile', htmlFile);",
    "          formData.append('csvFile', csvFile);",
    "          formData.append('toColumn', toColumn);",
    "          formData.append('subjectColumn', subjectColumn || '');",
    "          formData.append('subject', subject || 'Notificación');",
    '',
    "          const attachmentFiles = document.getElementById('attachments').files;",
    "          Array.from(attachmentFiles).forEach((file) => formData.append('attachments', file));",
    '',
    "          const response = await fetch('/send', {",
    "            method: 'POST',",
    "            body: formData,",
    "          });",
    '',
    "          const payload = await response.json().catch(() => null);",
    '',
    "          if (!response.ok) {",
    "            const message = payload && payload.message ? payload.message : 'Error al enviar los correos.';",
    "            throw new Error(message);",
    "          }",
    '',
    "          setStatus(payload && payload.message ? payload.message : 'Procesamiento lanzado correctamente.', 'success');",
    "          console.log('Response from /send:', payload);",
    "        } catch (error) {",
    "          console.error('Form submit error:', error);",
    "          setStatus(error.message || 'Error en la solicitud.', 'error');",
    "        } finally {",
    "          sendBtn.disabled = false;",
    "          sendBtn.textContent = 'Enviar correos';",
    "        }",
    "      });",
    '    </script>',
    '  </body>',
    '</html>'
  ].join('\n');
}

app.use((req, res, next) => {
  log(`Incoming request: ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  log("GET / requested");
  res.type("html").send(buildPage());
});

app.post(
  "/send",
  upload.fields([
    { name: "htmlFile", maxCount: 1 },
    { name: "csvFile", maxCount: 1 },
    { name: "attachments", maxCount: 20 },
  ]),
  async (req, res) => {
    log("POST /send start", {
      body: req.body,
      files: Object.keys(req.files || {}),
    });

    try {
      const htmlFile = req.files?.htmlFile?.[0];
      const csvFile = req.files?.csvFile?.[0];
      const attachments = req.files?.attachments || [];
      const toColumn = String(req.body.toColumn || "").trim();
      const subjectColumn = String(req.body.subjectColumn || "").trim();
      const subject = String(req.body.subject || "Notificación").trim() || "Notificación";

      log("Request parsing details", {
        toColumn,
        subjectColumn,
        subject,
        attachmentCount: attachments.length,
      });

      if (!htmlFile) {
        log("POST /send rejected: missing htmlFile");
        return res.status(400).json({ ok: false, message: "Falta la plantilla HTML." });
      }

      if (!csvFile) {
        log("POST /send rejected: missing csvFile");
        return res.status(400).json({ ok: false, message: "Falta el archivo CSV." });
      }

      if (!toColumn) {
        log("POST /send rejected: missing toColumn");
        return res.status(400).json({ ok: false, message: "Falta la columna del destinatario." });
      }

      const htmlTemplate = htmlFile.buffer.toString("utf8");
      const csvText = csvFile.buffer.toString("utf8");
      const rows = getCsvRows(csvText);

      log("CSV parsed", {
        rowCount: rows.length,
        columns: rows[0] ? Object.keys(rows[0]) : [],
        preview: rows[0] || null,
      });

      if (!rows.length) {
        log("POST /send rejected: CSV is empty");
        return res.status(400).json({ ok: false, message: "El CSV no tiene filas de datos." });
      }

      const columns = Object.keys(rows[0]);
      const normalizedToColumn = columns.find((column) => normalizeKey(column) === normalizeKey(toColumn)) || toColumn;
      const normalizedSubjectColumn = subjectColumn
        ? columns.find((column) => normalizeKey(column) === normalizeKey(subjectColumn)) || subjectColumn
        : "";

      log("Column resolution", {
        requestedToColumn: toColumn,
        normalizedToColumn,
        requestedSubjectColumn: subjectColumn,
        normalizedSubjectColumn,
      });

      const transporter = getTransporter();
      log("SMTP config loaded", smtpConfigSummary());

      try {
        log("SMTP verify start");
        await transporter.verify();
        log("SMTP verification successful.");
      } catch (smtpError) {
        log("SMTP verification failed", {
          message: smtpError && smtpError.message,
          code: smtpError && smtpError.code,
          response: smtpError && smtpError.response,
          responseCode: smtpError && smtpError.responseCode,
          command: smtpError && smtpError.command,
          stack: smtpError && smtpError.stack,
        });
        throw smtpError;
      }

      const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
      const queuedJobs = [];

      rows.forEach((row, index) => {
        const recipient = row[normalizedToColumn] ?? row[normalizeKey(normalizedToColumn)] ?? "";
        if (!recipient) {
          log(`Skipping row without recipient`, { index, row });
          return;
        }

        const rowSubject = prettySubject(row, normalizedSubjectColumn, subject);
        queuedJobs.push({
          row,
          htmlTemplate,
          recipient: String(recipient).trim(),
          subject: rowSubject,
          attachments,
          toColumn: normalizedToColumn,
          fromAddress,
        });
      });

      log("Queue populated with jobs", { queueLength: queuedJobs.length });
      queuedJobs.forEach((job) => queue.push(job));

      if (!queue.length) {
        return res.status(400).json({ ok: false, message: "No se encontraron destinatarios válidos en el CSV." });
      }

      log("Starting queue processing before returning HTTP response.");
      await processQueue(transporter);

      const sentCount = queue.filter((job) => job.status === "sent").length;
      const failedCount = queue.filter((job) => job.status === "failed").length;
      log("Queue completed", { sentCount, failedCount, total: queue.length });

      return res.status(200).json({
        ok: true,
        sent: sentCount,
        failed: failedCount,
        queued: queue.length,
        message: `Envíos finalizados. Correctos: ${sentCount}. Fallidos: ${failedCount}.`,
      });
    } catch (error) {
      log("Post /send error", {
        message: error && error.message,
        code: error && error.code,
        response: error && error.response,
        responseCode: error && error.responseCode,
        command: error && error.command,
        stack: error && error.stack,
      });

      return res.status(500).json({
        ok: false,
        message: error && error.message ? error.message : "Error al procesar la solicitud.",
      });
    }
  }
);

app.use((req, res) => {
  log(`Unhandled route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ ok: false, message: "Ruta no encontrada." });
});

app.listen(PORT, () => {
  log(`Servidor activo en http://localhost:${PORT}`);
  log(`SMTP environment loaded: ${Boolean(process.env.SMTP_HOST)}`);
  log("SMTP config summary", smtpConfigSummary());
});
