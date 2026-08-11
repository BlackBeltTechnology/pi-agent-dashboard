# install-invoice-bot-extension.md — index

Install `@blackbelt-technology/invoicebot` (local `../pi-invoice-bot`) as global pi extension. `npm install` first (local-path installs skip it; needs bundled `file:../pi-flows`). `pi install <abs-path>`. Bundled pi-flows extensions collide with global `@blackbelt-technology/pi-flows` (tool conflicts: ask_user/skill_read/flow_*). Fix: settings.json object form `"extensions": ["!node_modules/**"]`. pi extension, not dashboard plugin — absent from `/api/health` plugins[].
