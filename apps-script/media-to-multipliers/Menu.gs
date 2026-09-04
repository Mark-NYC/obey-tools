/************************************************************************
 * Media to Multipliers CRM  —  Menu.gs
 * ----------------------------------------------------------------------
 * Builds the "Media to Multipliers" custom menu when the sheet opens.
 * The full menu is defined now; handlers for later milestones live as
 * stubs (Stubs.gs) until you paste their real code.
 *
 * Paste this as a file named "Menu.gs".
 ************************************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Media to Multipliers')
    .addItem('Set Up / Repair Workbook', 'setupWorkbook')
    .addSeparator()
    .addItem('Summarize Selected Person', 'summarizeSelectedPerson')
    .addItem('Draft Follow-Up for Selected Person', 'draftFollowUpForSelectedPerson')
    .addItem('Suggest Stories of Hope', 'suggestStoriesOfHope')
    .addSeparator()
    .addItem('Refresh Today View', 'refreshTodayView')
    .addItem('Refresh Dashboard', 'refreshDashboard')
    .addSeparator()
    .addItem('Test Claude Connection', 'testClaudeConnection')
    .addItem('Test Meta Webhook Processing', 'testMetaWebhookProcessing')
    .addToUi();
}
