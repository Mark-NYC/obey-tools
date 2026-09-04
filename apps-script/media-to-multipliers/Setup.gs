/************************************************************************
 * Media to Multipliers CRM  —  Setup.gs
 * ----------------------------------------------------------------------
 * Builds (or safely repairs) the whole workbook: tabs, headers, column
 * widths, freezes, dropdowns, checkboxes, conditional colors, header
 * notes, protection of system columns, and the installable onEdit
 * trigger that auto-stamps new rows.
 *
 * Safe to run many times. It does not delete your data.
 *
 * Paste this as a file named "Setup.gs".
 ************************************************************************/

var MAX_ROWS = 2000; // how far down validations / colors / protection reach

/** Menu entry point. */
function setupWorkbook() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Another setup is already running. Try again in a moment.');
    return;
  }
  try {
    buildSettings_();      // build SETTINGS first: other tabs read its lists
    buildLog_();
    buildPeople_();
    buildActivity_();
    buildGroups_();
    buildEngagement_();
    buildToday_();
    buildDashboard_();
    orderTabs_();
    installOnEditTrigger_();
    logSystem_('INFO', 'Setup', 'Workbook set up / repaired.', '');
    ui.alert('Media to Multipliers',
      'Workbook is ready.\n\n' +
      'Tabs built: PEOPLE, ACTIVITY, GROUPS, ENGAGEMENT, TODAY, DASHBOARD, SETTINGS, SYSTEM LOG.\n\n' +
      'Next: set your Owners in the SETTINGS tab, then add a test person in PEOPLE.',
      ui.ButtonSet.OK);
  } catch (e) {
    logSystem_('ERROR', 'Setup', 'Setup failed', e && e.message);
    ui.alert('Setup error', String(e && e.message || e), ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

/* =====================================================================
 * Shared builders
 * ===================================================================== */

/** Write headers into row 1, style them, add notes, freeze, size columns. */
function writeHeaders_(sheet, colDefs, opts) {
  opts = opts || {};
  var headers = colDefs.map(function (c) { return c.header; });
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold')
       .setBackground('#1f3864')
       .setFontColor('#ffffff')
       .setVerticalAlignment('middle')
       .setWrap(true);
  sheet.setRowHeight(1, 34);

  // Header notes
  colDefs.forEach(function (c, i) {
    if (c.note) sheet.getRange(1, i + 1).setNote(c.note);
    if (c.width) sheet.setColumnWidth(i + 1, c.width);
  });

  // Freeze header row plus any identifier columns
  sheet.setFrozenRows(1);
  if (opts.frozenColumns) sheet.setFrozenColumns(opts.frozenColumns);

  // Trim stray columns to the right of our data (keeps the phone view tidy)
  var lastCol = headers.length;
  var maxCols = sheet.getMaxColumns();
  if (maxCols > lastCol) sheet.deleteColumns(lastCol + 1, maxCols - lastCol);
}

/** Ensure the sheet has at least MAX_ROWS rows available for data. */
function ensureRows_(sheet) {
  var need = MAX_ROWS + 1; // + header
  var have = sheet.getMaxRows();
  if (have < need) sheet.insertRowsAfter(have, need - have);
}

/** Build a dropdown rule that pulls its list from a SETTINGS range. */
function ruleFromSettings_(a1RangeOnSettings) {
  var settings = ss_().getSheetByName(TAB.SETTINGS);
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(settings.getRange(a1RangeOnSettings), true)
    .setAllowInvalid(true) // allow (with a warning) so old values are never blocked
    .build();
}

/** Warning-only protection so scripts still write, but people get a nudge. */
function protectWarn_(range, description) {
  var p = range.protect().setDescription(description);
  p.setWarningOnly(true);
}

/* =====================================================================
 * SETTINGS
 * ===================================================================== */

function buildSettings_() {
  var s = getOrCreateSheet_(TAB.SETTINGS);
  s.clear();
  s.setFrozenRows(1);

  // List columns A..G
  var listCols = [
    {header:'Owners',              values:OPTIONS.OWNERS},
    {header:'Pathways',            values:OPTIONS.PATHWAY},
    {header:'Stages',              values:OPTIONS.STAGE},
    {header:'Active',              values:OPTIONS.ACTIVE},
    {header:'Best Contact Method', values:OPTIONS.CONTACT_METHOD},
    {header:'Group Platforms',     values:OPTIONS.PLATFORM},
    {header:'Meeting Rhythm',      values:OPTIONS.RHYTHM}
  ];
  listCols.forEach(function (col, i) {
    var c = i + 1;
    s.getRange(1, c).setValue(col.header).setFontWeight('bold').setBackground('#d9e1f2');
    if (col.values.length) {
      s.getRange(2, c, col.values.length, 1).setValues(col.values.map(function (v){return [v];}));
    }
    s.setColumnWidth(c, 170);
  });

  // Config key/value block starting column I (col 9)
  var kcol = 9;
  s.getRange(1, kcol,   1, 3).setValues([['Config Key', 'Value', 'What it does']])
    .setFontWeight('bold').setBackground('#d9e1f2');
  if (CONFIG_DEFAULTS.length) {
    s.getRange(2, kcol, CONFIG_DEFAULTS.length, 3).setValues(CONFIG_DEFAULTS);
  }
  s.setColumnWidth(kcol, 180);
  s.setColumnWidth(kcol + 1, 90);
  s.setColumnWidth(kcol + 2, 360);

  // Stories of Hope reference block starting column M (col 13)
  var scol = 13;
  s.getRange(1, scol, 1, 2).setValues([['Felt Need', 'Story of Hope']])
    .setFontWeight('bold').setBackground('#d9e1f2');
  if (STORIES_OF_HOPE.length) {
    s.getRange(2, scol, STORIES_OF_HOPE.length, 2).setValues(STORIES_OF_HOPE);
  }
  s.setColumnWidth(scol, 300);
  s.setColumnWidth(scol + 1, 170);

  // A short instruction banner
  s.getRange(1, 16).setValue('Edit the lists on the left. Secrets are NOT stored here — they live in Project Settings > Script Properties.')
    .setFontStyle('italic');
}

/* =====================================================================
 * SYSTEM LOG
 * ===================================================================== */

function buildLog_() {
  var s = getOrCreateSheet_(TAB.LOG);
  writeHeaders_(s, LOG_COLS, {frozenColumns: 0});
  ensureRows_(s);
  protectWarn_(s.getRange(1, 1, 1, LOG_COLS.length), 'System log header');
}

/* =====================================================================
 * PEOPLE
 * ===================================================================== */

function buildPeople_() {
  var s = getOrCreateSheet_(TAB.PEOPLE);
  writeHeaders_(s, PEOPLE_COLS, {frozenColumns: 3}); // Person ID, Created At, First Name
  ensureRows_(s);

  var body = function (colKey) {
    return s.getRange(2, colIndex_(PEOPLE_COLS, colKey), MAX_ROWS, 1);
  };

  // Dropdowns driven by SETTINGS lists
  body('owner').setDataValidation(ruleFromSettings_('A2:A100'));
  body('pathway').setDataValidation(ruleFromSettings_('B2:B50'));
  body('stage').setDataValidation(ruleFromSettings_('C2:C50'));
  body('active').setDataValidation(ruleFromSettings_('D2:D10'));
  body('contact').setDataValidation(ruleFromSettings_('E2:E20'));

  // Date formatting
  s.getRange(2, colIndex_(PEOPLE_COLS, 'createdAt'), MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  s.getRange(2, colIndex_(PEOPLE_COLS, 'lastIn'),    MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  s.getRange(2, colIndex_(PEOPLE_COLS, 'lastOut'),   MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  s.getRange(2, colIndex_(PEOPLE_COLS, 'dueDate'),   MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');

  // Wrap the long text columns for readability
  ['feltNeed','nextAction','aiSummary','humanNote'].forEach(function (k) {
    s.getRange(2, colIndex_(PEOPLE_COLS, k), MAX_ROWS, 1).setWrap(true);
  });

  applyPeopleConditionalFormats_(s);
  protectPeopleSystemColumns_(s);
}

function applyPeopleConditionalFormats_(s) {
  var lastCol = PEOPLE_COLS.length;
  var range = s.getRange(2, 1, MAX_ROWS, lastCol);
  // Column letters (used inside the custom formulas)
  var Q = colLetter_(colIndex_(PEOPLE_COLS, 'dueDate'));   // Due Date
  var U = colLetter_(colIndex_(PEOPLE_COLS, 'active'));    // Active
  var M = colLetter_(colIndex_(PEOPLE_COLS, 'stage'));     // Stage

  var rules = [];

  // 1) Overdue (highest priority): active, has a past due date, not closed
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($' + Q + '2<>"",$' + Q + '2<TODAY(),$' + U + '2="Yes",$' + M + '2<>"Closed")')
    .setBackground('#f4c7c3') // soft red
    .setRanges([range]).build());

  // 2) Closed: gray
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + M + '2="Closed"')
    .setBackground('#e0e0e0').setFontColor('#7f7f7f')
    .setRanges([range]).build());

  // 3) Paused / inactive: soft yellow
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($' + M + '2="Paused",$' + U + '2="No")')
    .setBackground('#fff2cc')
    .setRanges([range]).build());

  // 4) Advanced / fruitful: soft green
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=OR($' + M + '2="Obeying",$' + M + '2="Sharing",$' + M + '2="Leading",$' + M + '2="Starting New Group")')
    .setBackground('#d9ead3')
    .setRanges([range]).build());

  s.setConditionalFormatRules(rules);
}

function protectPeopleSystemColumns_(s) {
  // Remove old range protections we created, then re-add fresh ones.
  clearRangeProtections_(s);
  PEOPLE_COLS.forEach(function (c, i) {
    if (c.edit === false) {
      protectWarn_(s.getRange(2, i + 1, MAX_ROWS, 1), 'System-managed: ' + c.header);
    }
  });
  protectWarn_(s.getRange(1, 1, 1, PEOPLE_COLS.length), 'PEOPLE header');
}

/* =====================================================================
 * ACTIVITY
 * ===================================================================== */

function buildActivity_() {
  var s = getOrCreateSheet_(TAB.ACTIVITY);
  writeHeaders_(s, ACTIVITY_COLS, {frozenColumns: 2});
  ensureRows_(s);
  s.getRange(2, colIndex_(ACTIVITY_COLS, 'timestamp'), MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  s.getRange(2, colIndex_(ACTIVITY_COLS, 'text'), MAX_ROWS, 1).setWrap(true);
  clearRangeProtections_(s);
  protectWarn_(s.getRange(1, 1, 1, ACTIVITY_COLS.length), 'ACTIVITY header');
  // ACTIVITY is mostly system-written; protect the ID/key columns as warning-only.
  ['activityId','timestamp','personId','psid','messageId','source','aiProcessed'].forEach(function (k) {
    protectWarn_(s.getRange(2, colIndex_(ACTIVITY_COLS, k), MAX_ROWS, 1), 'System-managed: ' + k);
  });
}

/* =====================================================================
 * GROUPS
 * ===================================================================== */

function buildGroups_() {
  var s = getOrCreateSheet_(TAB.GROUPS);
  writeHeaders_(s, GROUPS_COLS, {frozenColumns: 2});
  ensureRows_(s);
  s.getRange(2, colIndex_(GROUPS_COLS, 'platform'), MAX_ROWS, 1).setDataValidation(ruleFromSettings_('F2:F30'));
  s.getRange(2, colIndex_(GROUPS_COLS, 'rhythm'), MAX_ROWS, 1).setDataValidation(ruleFromSettings_('G2:G30'));
  s.getRange(2, colIndex_(GROUPS_COLS, 'active'), MAX_ROWS, 1).setDataValidation(ruleFromSettings_('D2:D10'));
  s.getRange(2, colIndex_(GROUPS_COLS, 'startDate'), MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  s.getRange(2, colIndex_(GROUPS_COLS, 'notes'), MAX_ROWS, 1).setWrap(true);
  clearRangeProtections_(s);
  protectWarn_(s.getRange(2, colIndex_(GROUPS_COLS, 'groupId'), MAX_ROWS, 1), 'System-managed: Group ID');
  protectWarn_(s.getRange(1, 1, 1, GROUPS_COLS.length), 'GROUPS header');
}

/* =====================================================================
 * ENGAGEMENT
 * ===================================================================== */

function buildEngagement_() {
  var s = getOrCreateSheet_(TAB.ENGAGEMENT);
  writeHeaders_(s, ENGAGEMENT_COLS, {frozenColumns: 4});
  ensureRows_(s);
  s.getRange(2, colIndex_(ENGAGEMENT_COLS, 'date'), MAX_ROWS, 1).setNumberFormat('yyyy-mm-dd');
  // Checkboxes for Present / Obeyed / Shared / Led
  ENGAGEMENT_COLS.forEach(function (c, i) {
    if (c.checkbox) s.getRange(2, i + 1, MAX_ROWS, 1).insertCheckboxes();
  });
  ['nextObey','nextShare','facNote'].forEach(function (k) {
    s.getRange(2, colIndex_(ENGAGEMENT_COLS, k), MAX_ROWS, 1).setWrap(true);
  });
  clearRangeProtections_(s);
  protectWarn_(s.getRange(1, 1, 1, ENGAGEMENT_COLS.length), 'ENGAGEMENT header');
}

/* =====================================================================
 * TODAY  (structure only — calculations arrive in Milestone 4)
 * ===================================================================== */

function buildToday_() {
  var s = getOrCreateSheet_(TAB.TODAY);
  s.clear();
  s.setFrozenRows(2);
  s.getRange(1, 1).setValue("TODAY — your working list")
    .setFontWeight('bold').setFontSize(14);
  s.getRange(2, 1).setValue('Use the menu: Media to Multipliers > Refresh Today View (available in Milestone 4).')
    .setFontStyle('italic').setFontColor('#7f7f7f');
  clearRangeProtections_(s);
  protectWarn_(s.getRange(1, 1, MAX_ROWS, 12), 'TODAY is auto-generated. Do not edit.');
}

/* =====================================================================
 * DASHBOARD  (structure only — calculations arrive in Milestone 4)
 * ===================================================================== */

function buildDashboard_() {
  var s = getOrCreateSheet_(TAB.DASHBOARD);
  s.clear();
  s.setFrozenRows(2);
  s.getRange(1, 1).setValue('DASHBOARD — Media to Multipliers')
    .setFontWeight('bold').setFontSize(14);
  s.getRange(2, 1).setValue('Use the menu: Media to Multipliers > Refresh Dashboard (available in Milestone 4).')
    .setFontStyle('italic').setFontColor('#7f7f7f');
  clearRangeProtections_(s);
  protectWarn_(s.getRange(1, 1, MAX_ROWS, 12), 'DASHBOARD is auto-generated. Do not edit.');
}

/* =====================================================================
 * Tab order + protection helpers
 * ===================================================================== */

function orderTabs_() {
  var order = [TAB.TODAY, TAB.PEOPLE, TAB.ACTIVITY, TAB.GROUPS, TAB.ENGAGEMENT,
               TAB.DASHBOARD, TAB.SETTINGS, TAB.LOG];
  order.forEach(function (name, i) {
    var sh = ss_().getSheetByName(name);
    if (sh) { ss_().setActiveSheet(sh); ss_().moveActiveSheet(i + 1); }
  });
  ss_().setActiveSheet(ss_().getSheetByName(TAB.TODAY));
}

/** Remove range protections previously created by this script on a sheet. */
function clearRangeProtections_(sheet) {
  var prots = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < prots.length; i++) {
    try { prots[i].remove(); } catch (e) {}
  }
}

/** Convert a 1-based column number to its letter(s): 1 -> A, 27 -> AA. */
function colLetter_(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/* =====================================================================
 * Installable onEdit trigger — auto-stamps new rows
 * ===================================================================== */

/** Create the installable onEdit trigger once (removes duplicates first). */
function installOnEditTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onEditInstallable') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(ss_())
    .onEdit()
    .create();
}

/**
 * Runs on every manual edit (installable, so it has full authority).
 * Auto-assigns IDs and sensible defaults so the team never types an ID.
 */
function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var name = sheet.getName();
    var row = e.range.getRow();
    if (row < 2) return; // header

    if (name === TAB.PEOPLE) stampPersonRow_(sheet, row);
    else if (name === TAB.GROUPS) stampGroupRow_(sheet, row);
  } catch (err) {
    logSystem_('WARN', 'onEdit', 'Auto-stamp failed', err && err.message);
  }
}

function stampPersonRow_(sheet, row) {
  var idCol = colIndex_(PEOPLE_COLS, 'personId');
  var nameCol = colIndex_(PEOPLE_COLS, 'firstName');
  var hasId = String(sheet.getRange(row, idCol).getValue()).trim() !== '';
  var hasSomething = String(sheet.getRange(row, nameCol).getValue()).trim() !== '';
  if (hasId || !hasSomething) return; // already stamped, or empty row

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return;
  try {
    sheet.getRange(row, idCol).setValue(nextId_(sheet, idCol, 'PER'));
    setIfEmpty_(sheet, row, colIndex_(PEOPLE_COLS, 'createdAt'), new Date());
    setIfEmpty_(sheet, row, colIndex_(PEOPLE_COLS, 'stage'), getConfig_('DEFAULT_STAGE', 'New Message'));
    setIfEmpty_(sheet, row, colIndex_(PEOPLE_COLS, 'pathway'), getConfig_('DEFAULT_PATHWAY', 'Messenger Group'));
    setIfEmpty_(sheet, row, colIndex_(PEOPLE_COLS, 'active'), 'Yes');
    setIfEmpty_(sheet, row, colIndex_(PEOPLE_COLS, 'owner'), '(Unassigned)');
  } finally {
    lock.releaseLock();
  }
}

function stampGroupRow_(sheet, row) {
  var idCol = colIndex_(GROUPS_COLS, 'groupId');
  var nameCol = colIndex_(GROUPS_COLS, 'groupName');
  var hasId = String(sheet.getRange(row, idCol).getValue()).trim() !== '';
  var hasSomething = String(sheet.getRange(row, nameCol).getValue()).trim() !== '';
  if (hasId || !hasSomething) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) return;
  try {
    sheet.getRange(row, idCol).setValue(nextId_(sheet, idCol, 'GRP'));
    setIfEmpty_(sheet, row, colIndex_(GROUPS_COLS, 'active'), 'Yes');
  } finally {
    lock.releaseLock();
  }
}

/** Only write if the target cell is empty (never overwrite a person's entry). */
function setIfEmpty_(sheet, row, col, value) {
  if (String(sheet.getRange(row, col).getValue()).trim() === '') {
    sheet.getRange(row, col).setValue(value);
  }
}

/**
 * Next sequential ID like PER-0001 for a given prefix and ID column.
 * Scans existing IDs in that column and increments the max.
 */
function nextId_(sheet, idCol, prefix) {
  var last = sheet.getLastRow();
  var max = 0;
  if (last >= 2) {
    var vals = sheet.getRange(2, idCol, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var m = String(vals[i][0]).match(/(\d+)\s*$/);
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    }
  }
  return prefix + '-' + ('0000' + (max + 1)).slice(-4);
}

/** Read a SETTINGS config key/value (column I/J block). */
function getConfig_(key, fallback) {
  var s = ss_().getSheetByName(TAB.SETTINGS);
  if (!s) return fallback;
  var last = s.getLastRow();
  if (last < 2) return fallback;
  var vals = s.getRange(2, 9, last - 1, 2).getValues(); // cols I,J
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) {
      var v = vals[i][1];
      return (v === '' || v == null) ? fallback : v;
    }
  }
  return fallback;
}
