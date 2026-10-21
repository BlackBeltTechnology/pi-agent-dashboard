# plugin-embedded-app.spec.ts — index

Demo `"content"` claim `/folder/<enc>/demo-app/*?`: F1 content area + live sidebar, no dialog; F2 deep link `/sub`; F3 Esc ignored, Back → folder; F4 return pill round trip; F5 mobile depth 2 + 44px Back. See change: add-plugin-app-host.

Project-scoped: `describe("project-scoped embedded app")` pins `/fixtures/demo-scoped` + sample-git; F3 folder entry converges only on the marker folder; F4 deep link to plain folder → *Not available for this folder*, Back → folder; F5 matching `/demo-scoped/sub` deep link + reload. See change: add-project-scoped-apps.

Summary (moved from directory AGENTS.md row): L3 demo `"content"` embedded app (F1/F2).
