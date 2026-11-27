import { STORES } from "@/src/lib/stores";

const LOGOS: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.id, s.logo]));

/**
 * A store's own logo. Plain <img>: the files are tiny local assets, so no optimizer is needed.
 * Pass `alt` for a standalone logo; omit it (alt="") where the store name is already in text.
 */
export default function StoreLogo({ id, size, alt = "" }: { id: string; size: number; alt?: string }) {
  const src = LOGOS[id];
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="store-logo" src={src} alt={alt} width={size} height={size} decoding="async" />;
}
