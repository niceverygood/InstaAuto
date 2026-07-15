const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./workspace');

let _settings = null;
let _accounts = null;

function loadSettings() {
  if (_settings) return _settings;
  _settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf-8'));
  return _settings;
}

function loadAccounts() {
  if (_accounts) return _accounts;
  const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'accounts.json'), 'utf-8'));
  _accounts = raw.accounts || [];
  return _accounts;
}

function getAccount(id) {
  const acc = loadAccounts().find(a => a.id === id);
  if (!acc) throw new Error(`accounts.json 에 없는 계정 ID: ${id}`);
  return acc;
}

function enabledAccounts() {
  return loadAccounts().filter(a => a.enabled !== false);
}

module.exports = { loadSettings, loadAccounts, getAccount, enabledAccounts };
