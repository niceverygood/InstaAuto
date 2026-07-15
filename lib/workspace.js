const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(WORKSPACE, 'scripts');
const CONFIG_DIR = path.join(WORKSPACE, 'config');
const DATA_DIR = path.join(WORKSPACE, 'data');
const LOGS_DIR = path.join(WORKSPACE, 'logs');
const TEMP_DIR = path.join(WORKSPACE, 'temp');
const TEMPLATES_DIR = path.join(WORKSPACE, 'templates');

module.exports = { WORKSPACE, SCRIPTS_DIR, CONFIG_DIR, DATA_DIR, LOGS_DIR, TEMP_DIR, TEMPLATES_DIR };
