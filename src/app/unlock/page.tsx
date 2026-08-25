import { Suspense } from "react";
import { UnlockForm } from "./UnlockForm";

export const metadata = { title: "Unlock · Thunkin" };

/**
 * The form reads `?next=` to send you where you were headed, and
 * `useSearchParams` opts a component out of prerendering unless it sits behind
 * a Suspense boundary. The fallback is deliberately blank: this page renders in
 * milliseconds and a flash of skeleton would be worse than nothing.
 */
export default function UnlockPage() {
  return (
    <Suspense>
      <UnlockForm />
    </Suspense>
  );
}
