// backend/utils/fonts.util.js
'use strict';

/**
 * Fonts for pictures the server draws (the gate-pass PNG: SVG → sharp → librsvg →
 * fontconfig). A server often has no fonts installed, and the text then comes out
 * as empty boxes. So the app brings its own — assets/fonts: Liberation Sans, the same
 * character widths as Arial (SIL Open Font License, see LICENSE-LiberationFonts.txt) —
 * and points fontconfig at them, so the pass looks the same on every machine.
 *
 * Must run before sharp draws any text: required first in server.js, and at the top
 * of services/gatePassImage.service. Leaves an admin's own FONTCONFIG_FILE alone.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function useBundledFonts() {
  if (process.env.FONTCONFIG_FILE || !fs.existsSync(FONT_DIR)) return;
  try {
    const dir = path.join(os.tmpdir(), 'vms-fontconfig');
    fs.mkdirSync(dir, { recursive: true });
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${xml(FONT_DIR)}</dir>
  <!-- the server's own fonts too, for characters Liberation Sans doesn't have -->
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <cachedir>${xml(path.join(dir, 'cache'))}</cachedir>
  <alias binding="same"><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="same"><family>Helvetica</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias>
</fontconfig>
`;
    const file = path.join(dir, 'fonts.conf');
    fs.writeFileSync(file, conf);
    process.env.FONTCONFIG_FILE = file;
  } catch (err) {
    console.warn('[Fonts] Could not set up the bundled fonts — pictures use the system fonts:', err.message);
  }
}

useBundledFonts();

module.exports = { FONT_DIR };
