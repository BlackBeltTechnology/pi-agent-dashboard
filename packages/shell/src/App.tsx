import { useState } from "react";
import { Link, Route, Switch } from "wouter";
import { PairView } from "./components/PairView.js";
import { KeyringView } from "./components/KeyringView.js";

export default function App() {
  // Bumped after a successful pairing so the keyring list refetches.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-full">
      <header className="border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="font-semibold text-neutral-100">PI Dashboard Shell</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/" className="text-neutral-300 hover:text-white">
              Servers
            </Link>
            <Link href="/pair" className="text-neutral-300 hover:text-white">
              Pair
            </Link>
          </nav>
        </div>
      </header>

      <main className="px-4 py-6">
        <Switch>
          <Route path="/pair">
            <PairView onPaired={() => setRefreshKey((k) => k + 1)} />
          </Route>
          <Route path="/">
            <KeyringView refreshKey={refreshKey} />
          </Route>
          <Route>
            <p className="text-center text-sm text-neutral-500">Not found.</p>
          </Route>
        </Switch>
      </main>
    </div>
  );
}
