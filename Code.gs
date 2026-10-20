/**
 * Google Apps Script backend. Bind it to a Google Sheet (Extensions > Apps Script).
 * Deploy as Web app: Execute as "Me", Who has access "Anyone".
 *
 * Writes to:
 *   "ratings"       one row per rated pair (appended live, de-duplicated by key)
 *   "participants"  one row per completed participant
 *   "matrix_<id>"   the final dissimilarity matrix for each completed participant
 */

const RATINGS_HEADERS = [
  "key", "received_at", "participant_id", "trial", "stim_A", "stim_B",
  "rating", "rt_ms", "plays_A", "plays_B", "test_mode",
];
const PARTICIPANT_HEADERS = ["participant_id", "completed_at", "n_stimuli", "test_mode"];

function doGet() {
  return json_({ ok: true, message: "Dissimilarity experiment endpoint is running." });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const d = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (d.type === "rating") {
      const sh = getSheet_(ss, "ratings", RATINGS_HEADERS);
      const dup = sh.getRange("A:A").createTextFinder(String(d.key)).matchEntireCell(true).findNext();
      if (!dup) {
        sh.appendRow([
          String(d.key), new Date(), d.participant_id, d.trial, d.stim_A, d.stim_B,
          d.rating, d.rt_ms, d.plays_A, d.plays_B, d.test_mode === true,
        ]);
      }
    } else if (d.type === "complete") {
      const pSheet = getSheet_(ss, "participants", PARTICIPANT_HEADERS);
      const dup = pSheet.getRange("A:A").createTextFinder(String(d.participant_id)).matchEntireCell(true).findNext();
      if (!dup) {
        pSheet.appendRow([d.participant_id, new Date(), d.stimuli.length, d.test_mode === true]);

        const name = ("matrix_" + d.participant_id).slice(0, 60);
        let m = ss.getSheetByName(name);
        if (m) m.clear(); else m = ss.insertSheet(name);
        const rows = [[""].concat(d.stimuli)];
        d.matrix.forEach((row, i) => rows.push([d.stimuli[i]].concat(row)));
        m.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      }
    } else {
      throw new Error("Unknown type: " + d.type);
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
