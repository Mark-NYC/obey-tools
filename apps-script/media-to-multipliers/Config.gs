/************************************************************************
 * Media to Multipliers CRM  —  Config.gs
 * ----------------------------------------------------------------------
 * Central configuration. No secrets live here. All API keys and tokens
 * live in Script Properties (File > Project Settings > Script Properties).
 *
 * Paste this as a file named "Config.gs".
 ************************************************************************/

/** Tab names. Change here and everywhere follows. */
var TAB = {
  PEOPLE:     'PEOPLE',
  ACTIVITY:   'ACTIVITY',
  GROUPS:     'GROUPS',
  ENGAGEMENT: 'ENGAGEMENT',
  TODAY:      'TODAY',
  DASHBOARD:  'DASHBOARD',
  SETTINGS:   'SETTINGS',
  LOG:        'SYSTEM LOG'
};

/** Script Property keys. Values are set by you in Project Settings. */
var PROP = {
  ANTHROPIC_API_KEY:      'ANTHROPIC_API_KEY',
  CLAUDE_MODEL:           'CLAUDE_MODEL',
  META_VERIFY_TOKEN:      'META_VERIFY_TOKEN',
  META_PAGE_ACCESS_TOKEN: 'META_PAGE_ACCESS_TOKEN',
  META_PAGE_ID:           'META_PAGE_ID'
};

/** Dropdown option lists. Seeded into SETTINGS so the team can edit them. */
var OPTIONS = {
  STAGE: [
    'New Message',
    'Personally Welcomed',
    'Invited to Group',
    'Joined Group',
    'Call Scheduled',
    'Call Completed',
    'Active in Stories',
    'Returned',
    'Obeying',
    'Sharing',
    'Leading',
    'Starting New Group',
    'Paused',
    'Closed'
  ],
  PATHWAY: [
    'Messenger Group',
    'Direct to Call',
    'Direct to Live DBS',
    'Other'
  ],
  ACTIVE: ['Yes', 'No'],
  CONTACT_METHOD: ['Messenger', 'Phone', 'Text', 'Email', 'In Person', 'Other'],
  OWNERS: ['(Unassigned)', 'Team Member 1', 'Team Member 2'],
  PLATFORM: ['Messenger Group', 'WhatsApp', 'In Person', 'Zoom', 'Phone', 'Other'],
  RHYTHM: ['Weekly', 'Twice Weekly', 'Biweekly', 'Monthly', 'As Available']
};

/** Non-secret config seeded into SETTINGS as key/value pairs. */
var CONFIG_DEFAULTS = [
  ['INACTIVE_DAYS', 3,  'A person with no inbound message for this many days shows on TODAY.'],
  ['OVERDUE_GRACE_DAYS', 0, 'Days past Due Date before a follow-up counts as overdue.'],
  ['DEFAULT_STAGE', 'New Message', 'Stage assigned to a brand-new contact.'],
  ['DEFAULT_PATHWAY', 'Messenger Group', 'Pathway assigned to a brand-new contact.']
];

/** Stories of Hope: felt need -> passage. Used by Claude suggestions (Milestone 2). */
var STORIES_OF_HOPE = [
  ['Fear about provision, lack or the future', 'Matthew 6:24-34'],
  ['Shame or feeling unworthy', 'Luke 7:36-50'],
  ['Self-righteousness or distrust of religion', 'Luke 18:9-14'],
  ['Money, control or desire for life change', 'Luke 19:1-10'],
  ['Bitterness or unforgiveness', 'Matthew 18:21-35'],
  ['Crisis or desperation', 'Luke 23:32-43'],
  ['Hopelessness, grief or loss', 'Luke 24:13-35'],
  ['Running from God or needing to come home', 'Luke 15:11-32']
];

/**
 * PEOPLE columns, in order.
 *  key    : short internal key
 *  header : text shown in row 1
 *  edit   : true if the team may edit it; false = system-managed (protected)
 *  width  : column width in pixels
 *  note   : hover note added to the header cell
 */
var PEOPLE_COLS = [
  {key:'personId',   header:'Person ID',           edit:false, width:110, note:'System ID. Do not edit. Auto-assigned when a row is created.'},
  {key:'createdAt',  header:'Created At',           edit:false, width:140, note:'When this person first appeared. Auto-filled.'},
  {key:'firstName',  header:'First Name',           edit:true,  width:130, note:'First name only. Safe to edit.'},
  {key:'psid',       header:'Messenger PSID',       edit:false, width:150, note:'Facebook Messenger Page-Scoped ID. System key. Do not edit.'},
  {key:'campaign',   header:'Campaign',             edit:false, width:130, note:'Set automatically from the ad referral when available.'},
  {key:'adId',       header:'Ad ID',                edit:false, width:120, note:'Facebook Ad ID from the referral. System-filled.'},
  {key:'referral',   header:'Referral Data',        edit:false, width:150, note:'Raw referral/ref parameter from Messenger. System-filled.'},
  {key:'area',       header:'Neighborhood or ZIP',  edit:true,  width:150, note:'Where they live. Safe to edit.'},
  {key:'feltNeed',   header:'Felt Need',            edit:true,  width:200, note:'What they are dealing with, in their words. Drives Story suggestions.'},
  {key:'contact',    header:'Best Contact Method',  edit:true,  width:150, note:'How they prefer to be reached.'},
  {key:'owner',      header:'Owner',                edit:true,  width:130, note:'The local engager responsible for this person.'},
  {key:'pathway',    header:'Pathway',              edit:true,  width:150, note:'Which journey they are on.'},
  {key:'stage',      header:'Stage',                edit:true,  width:150, note:'Where they are in the pathway. Changing this drives the funnel.'},
  {key:'lastIn',     header:'Last Inbound',         edit:false, width:140, note:'Last time they messaged us. System-filled from Messenger.'},
  {key:'lastOut',    header:'Last Outbound',        edit:false, width:140, note:'Last time we replied. System-filled.'},
  {key:'nextAction', header:'Next Action',          edit:true,  width:200, note:'The single next step for this person. Safe to edit.'},
  {key:'dueDate',    header:'Due Date',             edit:true,  width:110, note:'When the next action is due. Overdue rows turn red.'},
  {key:'groupId',    header:'Group ID',             edit:true,  width:110, note:'The Bible story group they belong to (see GROUPS tab).'},
  {key:'story',      header:'Current Story',        edit:true,  width:150, note:'The Story of Hope they are on right now.'},
  {key:'aiSummary',  header:'AI Summary',           edit:false, width:260, note:'Claude-generated summary. System-filled. Review before trusting.'},
  {key:'active',     header:'Active',               edit:true,  width:80,  note:'Yes = still engaging. No = paused/closed. Drives TODAY and Dashboard.'},
  {key:'humanNote',  header:'Human Note',           edit:true,  width:260, note:'Free notes from the engager. Safe to edit. Used by Claude summaries.'}
];

var ACTIVITY_COLS = [
  {key:'activityId', header:'Activity ID',  width:120, note:'System ID for this activity.'},
  {key:'timestamp',  header:'Timestamp',    width:150, note:'When the activity happened.'},
  {key:'personId',   header:'Person ID',    width:110, note:'Links to a PEOPLE row.'},
  {key:'psid',       header:'Messenger PSID',width:150, note:'Messenger ID of the person.'},
  {key:'direction',  header:'Direction',    width:90,  note:'Inbound = from them. Outbound = from us.'},
  {key:'type',       header:'Activity Type',width:130, note:'e.g. Message, Note, Call, System.'},
  {key:'messageId',  header:'Message ID',   width:200, note:'Meta message ID. Used to prevent duplicates.'},
  {key:'text',       header:'Message Text', width:340, note:'The message content.'},
  {key:'owner',      header:'Owner',        width:130, note:'Engager tied to this activity, if any.'},
  {key:'source',     header:'Source',       width:110, note:'Where it came from: Messenger, Manual, System.'},
  {key:'aiProcessed',header:'AI Processed', width:100, note:'TRUE once Claude has read this activity.'}
];

var GROUPS_COLS = [
  {key:'groupId',    header:'Group ID',      edit:false, width:110, note:'System ID. Auto-assigned.'},
  {key:'groupName',  header:'Group Name',    edit:true,  width:180, note:'Name of the group.'},
  {key:'facilitator',header:'Facilitator',   edit:true,  width:140, note:'Who leads it.'},
  {key:'platform',   header:'Platform',      edit:true,  width:140, note:'Where it meets.'},
  {key:'startDate',  header:'Start Date',    edit:true,  width:110, note:'When it started.'},
  {key:'rhythm',     header:'Meeting Rhythm',edit:true,  width:130, note:'How often it meets.'},
  {key:'story',      header:'Current Story', edit:true,  width:150, note:'The story the group is on.'},
  {key:'active',     header:'Active',        edit:true,  width:80,  note:'Yes/No.'},
  {key:'notes',      header:'Notes',         edit:true,  width:260, note:'Free notes.'}
];

var ENGAGEMENT_COLS = [
  {key:'date',       header:'Date',                       edit:true, width:110, note:'Date of the gathering.'},
  {key:'groupId',    header:'Group ID',                   edit:true, width:110, note:'Which group met.'},
  {key:'personId',   header:'Person ID',                  edit:true, width:110, note:'Which person (see PEOPLE).'},
  {key:'personName', header:'Person Name',                edit:true, width:140, note:'Name, for quick reading.'},
  {key:'story',      header:'Story',                      edit:true, width:150, note:'Story covered.'},
  {key:'present',    header:'Present',                    edit:true, width:80,  note:'Check if they attended.', checkbox:true},
  {key:'obeyed',     header:'Obeyed',                     edit:true, width:80,  note:'Check if they acted on last week\'s obedience.', checkbox:true},
  {key:'shared',     header:'Shared',                     edit:true, width:80,  note:'Check if they shared with someone.', checkbox:true},
  {key:'led',        header:'Led',                        edit:true, width:80,  note:'Check if they led part of the gathering.', checkbox:true},
  {key:'nextObey',   header:'Next Obedience Commitment',  edit:true, width:220, note:'What they committed to obey next.'},
  {key:'nextShare',  header:'Next Sharing Commitment',    edit:true, width:220, note:'Who they committed to share with next.'},
  {key:'facNote',    header:'Facilitator Note',           edit:true, width:240, note:'Note from the facilitator.'}
];

var LOG_COLS = [
  {key:'timestamp', header:'Timestamp', width:150},
  {key:'level',     header:'Level',     width:90},
  {key:'source',    header:'Source',    width:130},
  {key:'message',   header:'Message',   width:320},
  {key:'details',   header:'Details',   width:360}
];

/* ------------------------------------------------------------------ *
 * Small shared helpers used across all milestones.
 * ------------------------------------------------------------------ */

/** Returns the active spreadsheet. */
function ss_() {
  return SpreadsheetApp.getActive();
}

/** Spreadsheet timezone (used for all date formatting). */
function tz_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'UTC';
}

/** Get a sheet, creating it if missing. */
function getOrCreateSheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) s = ss_().insertSheet(name);
  return s;
}

/** 1-based column index for a key within a column definition array. Throws if not found. */
function colIndex_(colDefs, key) {
  for (var i = 0; i < colDefs.length; i++) {
    if (colDefs[i].key === key) return i + 1;
  }
  throw new Error('Unknown column key: ' + key);
}

/** Append a row to SYSTEM LOG. Never logs secrets. level: INFO | WARN | ERROR */
function logSystem_(level, source, message, details) {
  try {
    var sheet = ss_().getSheetByName(TAB.LOG);
    if (!sheet) return; // log tab not built yet
    var row = [
      Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      String(level || 'INFO'),
      String(source || ''),
      String(message || ''),
      details == null ? '' : String(details).slice(0, 4000)
    ];
    sheet.appendRow(row);
  } catch (e) {
    // Last resort: never throw from the logger.
    Logger.log('logSystem_ failed: ' + e);
  }
}

/** Read a Script Property. Returns '' if unset. Never logs the value. */
function getProp_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v == null ? '' : v;
}
