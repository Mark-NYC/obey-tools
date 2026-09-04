/************************************************************************
 * Media to Multipliers CRM  —  Stubs.gs
 * ----------------------------------------------------------------------
 * TEMPORARY placeholders so the menu works in Milestone 1.
 * You will REPLACE these functions with real code in later milestones:
 *   - Milestone 2 replaces the Claude functions (Claude.gs).
 *   - Milestone 3 replaces the Meta test function (Webhook.gs).
 *   - Milestone 4 replaces refreshTodayView / refreshDashboard (Views.gs).
 *
 * When a later milestone tells you to add a file that defines one of
 * these functions, DELETE that function from this file first (Apps Script
 * will not allow two functions with the same name).
 *
 * Paste this as a file named "Stubs.gs".
 ************************************************************************/

function summarizeSelectedPerson() {
  _comingSoon_('Summarize Selected Person', 'Milestone 2');
}

function draftFollowUpForSelectedPerson() {
  _comingSoon_('Draft Follow-Up for Selected Person', 'Milestone 2');
}

function suggestStoriesOfHope() {
  _comingSoon_('Suggest Stories of Hope', 'Milestone 2');
}

function testClaudeConnection() {
  _comingSoon_('Test Claude Connection', 'Milestone 2');
}

function refreshTodayView() {
  _comingSoon_('Refresh Today View', 'Milestone 4');
}

function refreshDashboard() {
  _comingSoon_('Refresh Dashboard', 'Milestone 4');
}

function testMetaWebhookProcessing() {
  _comingSoon_('Test Meta Webhook Processing', 'Milestone 3');
}

function _comingSoon_(feature, milestone) {
  SpreadsheetApp.getUi().alert(
    feature,
    'This feature is added in ' + milestone + '.\n\n' +
    'The workbook structure is ready. Paste the ' + milestone +
    ' code when you get to it, then use this button.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
