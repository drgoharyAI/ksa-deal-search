"use client";

import { useEffect, useState } from "react";
import type { SavedItem } from "@/src/lib/saved-shared";
import { storeLabel } from "@/src/lib/stores";
import { formatMoney } from "@/src/lib/money";
import { storeImage, storeLink } from "@/src/lib/store-hosts";
import { defaultTarget } from "@/src/lib/alerts/shared";
import AppHeader from "../components/AppHeader";
import AppFooter from "../components/AppFooter";
import RecentlyViewed from "../components/RecentlyViewed";
import { sendSave, viewHandlers } from "../components/Saved";
import WatchForm, { postWatch } from "../components/WatchForm";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import SectionHeader from "../components/ui/SectionHeader";
import StoreMark from "../components/ui/StoreMark";
import When from "../components/When";

type State = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; items: SavedItem[] };

/** "Down SAR 39.50 since you saved it": the change in words, never a colour alone. */
export function changeText(item: Pick<SavedItem, "change" | "currency">): string | null {
  if (item.change === null) return null;
  if (item.change === 0) return "Same price as when you saved it";
  return `${item.change < 0 ? "Down" : "Up"} ${formatMoney(Math.abs(item.change), item.currency)} since you saved it`;
}

function SavedRow({ item: f, onRemove }: { item: SavedItem; onRemove: (f: SavedItem) => Promise<void> }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [watch, setWatch] = useState<"closed" | "open" | "saved">("closed");
  const [busy, setBusy] = useState(false);
  // Drawn only when on the store's own hosts (store-hosts.ts), whatever the database holds.
  const href = storeLink(f.site, f.url);
  const image = storeImage(f.site, f.image);
  const store = storeLabel(f.site);
  const now = f.latest?.price ?? f.price;
  const change = changeText(f);
  return (
    <li className="saved">
      <div className="saved__media">
        {image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote store images stay off Next's optimizer
          <img src={image} alt="" width={96} height={96} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
        ) : (
          <span className="card__noimg">No image</span>
        )}
      </div>
      <div className="saved__main">
        <StoreMark id={f.site} size={18} />
        <p className="saved__title" dir="auto">
          {f.title}
        </p>
        <p className="saved__prices">
          <span>
            Saved at <strong className="saved__amount">{formatMoney(f.price, f.currency)}</strong>, <When at={f.savedAt} />
          </span>
          {f.latest && (
            <span>
              Latest seen <strong className="saved__amount">{formatMoney(f.latest.price, f.currency)}</strong>, <When at={f.latest.at} />
            </span>
          )}
        </p>
        {change && <p className={f.change !== null && f.change < 0 ? "saved__change saved__change--down" : "saved__change"}>{change}</p>}
        {!f.latest && <p className="saved__note">No price seen since. A search that lists it again updates this.</p>}
        {watch === "open" && (
          <WatchForm
            label={`Alert me at or under, ${f.currency}`}
            initial={defaultTarget(now)}
            onCancel={() => setWatch("closed")}
            onSave={async (target) => {
              const err = await postWatch({
                kind: "product",
                site: f.site,
                productId: f.id,
                query: (f.query ?? f.title).slice(0, 200),
                target,
                title: f.title,
                url: f.url,
                image: f.image ?? undefined,
                price: now,
                currency: f.currency,
              });
              if (!err) setWatch("saved");
              return err;
            }}
          />
        )}
        <p className={watch === "saved" ? "card__watched" : "visually-hidden"} role="status">
          {watch === "saved" && (
            <>
              Watching. <a href="/alerts">See alerts</a>
            </>
          )}
        </p>
      </div>
      <div className="saved__actions">
        {href ? (
          <Button size="sm" variant="secondary" href={href} external {...viewHandlers({ ...f, price: now })}>
            View on {store}
            <span className="visually-hidden">{`: ${f.title} (opens in a new tab)`}</span>
          </Button>
        ) : (
          <span className="card__nolink">No store link</span>
        )}
        {watch === "closed" && (
          <Button size="sm" variant="ghost" onClick={() => setWatch("open")}>
            Watch price<span className="visually-hidden"> {f.title}</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onRemove(f).finally(() => setBusy(false));
          }}
        >
          Remove<span className="visually-hidden"> {f.title}</span>
        </Button>
      </div>
    </li>
  );
}

/** /saved: the saved products with their latest observed price, and the recently viewed strip. */
export default function SavedView() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/favourites", { cache: "no-store" });
      const d = (await r.json().catch(() => null)) as { items?: SavedItem[]; error?: string } | null;
      if (!r.ok || !d?.items) {
        setState({ phase: "error", message: d?.error ?? "Could not load the saved products" });
        return;
      }
      setState({ phase: "ready", items: d.items });
    } catch {
      setState({ phase: "error", message: "Could not reach the app server" });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state only after its awaited fetch, never synchronously
    void load();
  }, []);

  async function remove(f: SavedItem) {
    const err = await sendSave(f, false);
    setNotice(err);
    await load();
  }

  const items = state.phase === "ready" ? state.items : [];
  return (
    <div className="app">
      <AppHeader current="saved" />
      <main className="container main">
        <SectionHeader
          as="h1"
          title="Saved products"
          note="Kept by this app on its server: anyone who can open the app sees this list. The latest price comes from searches run here; the stores are not contacted to refresh it."
        />
        {notice && <ErrorState message={notice} />}
        {state.phase === "loading" ? (
          <p className="results__note" role="status">
            Loading
          </p>
        ) : state.phase === "error" ? (
          <ErrorState message={state.message} onRetry={() => void load()} />
        ) : !items.length ? (
          <EmptyState
            title="No saved products yet"
            body="Tap Save on a result to keep it here with its price."
            action={
              <Button href="/" size="sm" variant="primary">
                Search the stores
              </Button>
            }
          />
        ) : (
          <ul className="saved-list" role="list" aria-label={`${items.length} saved ${items.length === 1 ? "product" : "products"}`}>
            {items.map((f) => (
              <SavedRow key={`${f.site}+${f.id}`} item={f} onRemove={remove} />
            ))}
          </ul>
        )}
        <RecentlyViewed limit={50} />
      </main>
      <AppFooter />
    </div>
  );
}
