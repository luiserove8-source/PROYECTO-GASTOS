/**
 * Bancolombia Gmail → Firebase Gastos Fam RojasGomez
 *
 * Setup:
 *  1. Abre script.google.com → New Project → pega este código
 *  2. Cambia FIREBASE_URL y SCRIPT_USER si es necesario
 *  3. Run > Run "setup" una vez para crear el trigger automático
 *  4. Autoriza los permisos cuando te lo pida
 */

const FIREBASE_URL = 'https://gastos-f64f4-default-rtdb.firebaseio.com/app';
const SCRIPT_USER  = 'Sebas R';   // nombre que aparece como "usuario" en las transacciones
const LABEL_NAME   = 'Procesado-Gastos'; // label que se pone al email ya procesado

// ─── Parser de correos Bancolombia ──────────────────────────────────────────
function parseEmail(subject, body) {
  const text = (subject + ' ' + body).replace(/\n/g, ' ');

  // Extrae monto: $1,234.56 o $1.234,56 → número entero
  const montoMatch = text.match(/\$\s*([\d,\.]+)/);
  if (!montoMatch) return null;
  const raw = montoMatch[1];
  // Detecta formato: si el último separador es punto → formato US (1,000.00)
  // Si el último separador es coma → formato ES (1.000,00)
  const lastDot   = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let clean;
  if (lastDot > lastComma) {
    clean = raw.replace(/,/g, '');          // US: quita comas → "1000.00"
  } else {
    clean = raw.replace(/\./g, '').replace(',', '.'); // ES: quita puntos, coma→punto
  }
  const amount = Math.round(parseFloat(clean));
  if (!amount || isNaN(amount)) return null;

  // Descripción: línea del cuerpo que empieza con "Bancolombia:"
  const bodyLine = text.match(/Bancolombia:\s*([^.]+\.)/i);
  const desc = bodyLine ? bodyLine[1].trim() : (subject || 'Notificación Bancolombia');

  // Fecha del texto del correo (DD/MM/YYYY)
  let date = '';
  const fechaMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (fechaMatch) {
    date = `${fechaMatch[3]}-${fechaMatch[2]}-${fechaMatch[1]}`;
  } else {
    date = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  }

  // Sin categoría ni tipo definido — el admin los asigna en la app
  return { amount, date, desc, category: '', type: 'expense', status: 'pending' };
}

// ─── Firebase helpers ────────────────────────────────────────────────────────
function loadTransactions() {
  const res  = UrlFetchApp.fetch(FIREBASE_URL + '/transactions.json', { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  const toArr = v => !v ? [] : Array.isArray(v) ? v : Object.values(v);
  return toArr(data);
}

function saveTransactions(transactions) {
  UrlFetchApp.fetch(FIREBASE_URL + '/transactions.json', {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(transactions),
    muteHttpExceptions: true,
  });
}

function generateUUID() {
  return Utilities.getUuid();
}

// ─── Función principal ────────────────────────────────────────────────────────
function processBancolombiaEmails() {
  const label      = getOrCreateLabel(LABEL_NAME);
  const threads    = GmailApp.search('from:(alertasynotificaciones@an.notificacionesbancolombia.com) -label:' + LABEL_NAME + ' newer_than:7d');

  if (!threads.length) {
    Logger.log('No hay correos nuevos de Bancolombia.');
    return;
  }

  const txList = loadTransactions();

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const subject = msg.getSubject();
      const body    = msg.getPlainBody();
      Logger.log('Procesando: ' + subject);

      const tx = parseEmail(subject, body);
      if (!tx) {
        Logger.log('No se pudo parsear el correo, saltando.');
        continue;
      }

      tx.id   = generateUUID();
      tx.user = SCRIPT_USER;

      txList.push(tx);
      Logger.log(`Transacción creada: ${tx.type} $${tx.amount} cat:${tx.category} desc:${tx.desc} fecha:${tx.date}`);
    }
    thread.addLabel(label);
  }

  saveTransactions(txList);
  Logger.log('Firebase actualizado con ' + threads.length + ' hilo(s) procesado(s).');
}

// ─── Crea el trigger automático cada 15 minutos ───────────────────────────────
function setup() {
  // Elimina triggers existentes para evitar duplicados
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processBancolombiaEmails')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processBancolombiaEmails')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger creado: processBancolombiaEmails cada 15 minutos.');
}

// ─── Helper: obtiene o crea el label de Gmail ─────────────────────────────────
function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
