# first-run-skip-providers.spec.ts — index

L3 F13 against the docker harness. `page.route` mocks (`routeProviderData`) make no provider usable; clears `pi-dashboard.onboarding.providersSkipped`; unpins every pin first and restores them after (as `first-run-create-project.spec.ts`). Click `onboarding-step-1-skip` → `onboarding-step-1-skipped` + `onboarding-step-2-create` visible; reload → both still visible. See change: fix-provider-catalogue-first-run.
