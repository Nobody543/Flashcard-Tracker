/* =========================================================================
   CONFIG
   Fill these in to enable cross-device sync (so you can see your tutee's
   progress from a different computer/phone than the one they study on).

   SET-UP STEPS:
   1. Go to https://jsonbin.io and create a free account.
   2. Click "Create Bin". Paste this as the starting content:
        { "students": {} }
   3. Copy the "Bin ID" shown in the URL/dashboard into JSONBIN_BIN_ID below.
   4. Go to Account -> API Keys, copy your "X-Master-Key" into
      JSONBIN_API_KEY below.
   5. Change TEACHER_PIN to something only you know.

   If you leave JSONBIN_BIN_ID / JSONBIN_API_KEY as the placeholder values,
   the site still works, but data is only stored in the browser it was
   created in (no cross-device sync, and you won't be able to see the
   student's data from your own device).
   ========================================================================= */

const CONFIG = {
  JSONBIN_BIN_ID: '6a36c782f5f4af5e29150fe3',
  JSONBIN_API_KEY: '$2a$10$hW8GRX8MFA05OycfFwy0eOCylRevNEYeIqqHIBNQrHfIUrmU9i2kG',

      
  // PIN required to open the teacher section.
  TEACHER_PIN: '2016',

  // If a study session is left open (e.g. browser closed without pressing
  // "End session") it will auto-close itself after this many hours, so logs
  // don't get stuck open forever.
  SESSION_AUTO_CLOSE_HOURS: 4
};
