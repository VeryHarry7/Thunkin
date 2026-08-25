import { LOOK_LIST } from "@/lib/models/registry";
import { Studio } from "./Studio";

export const metadata = { title: "Studio · Thunkin" };

/**
 * The registry is server-side data, so the look list is passed down rather than
 * fetched — the picker paints with the first byte of HTML instead of after a
 * round trip.
 */
export default function StudioPage() {
  return <Studio looks={[...LOOK_LIST]} />;
}
