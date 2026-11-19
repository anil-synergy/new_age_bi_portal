# React BI Loading + Transition Animation

A reusable, dependency-free React overlay inspired by a neon-green/cyan energy orb. It includes:
- Morphing glowing orb and subtle orbit rings
- Animated analytics line paths and particles
- Loading overlay controlled by a real `loading` boolean
- Short overlay when `transitionKey` changes
- Minimum visible loading duration to avoid flicker
- Responsive layout and `prefers-reduced-motion` support

## 1. Add the files

Copy `src/BITransition.jsx` and `src/bi-transition.css` into your React project's `src` folder. `App.jsx` is a standalone demo; use it as a reference rather than replacing your existing app.

## 2. Wrap a page or app shell

```jsx
import BITransition from "./BITransition";

export default function DashboardShell({ loading, children, pageKey }) {
  return (
    <BITransition
      loading={loading}
      transitionKey={pageKey}
      label="ANALYZING YOUR DATA"
    >
      {children}
    </BITransition>
  );
}
```

`loading` should be true only while data required for the current view is being fetched or prepared. Set it false when that work finishes or fails. Use your existing query state (React Query, SWR, Redux, etc.); do not add a second artificial timer in production.

## 3. React Router integration

For React Router v6, place the wrapper around your routed content and use `useLocation()`:

```jsx
import { useLocation, Outlet } from "react-router-dom";
import BITransition from "./BITransition";

export function AppLayout({ loading }) {
  const location = useLocation();

  return (
    <BITransition
      loading={loading}
      transitionKey={location.pathname}
      label="PREPARING YOUR DASHBOARD"
    >
      <Outlet />
    </BITransition>
  );
}
```

If query-string changes should also trigger transitions, use `location.pathname + location.search`. If some routes should not animate, use a stable key for those routes.

## 4. Connect real loading state

Example with a data request:

```jsx
const [loading, setLoading] = useState(true);
const [rows, setRows] = useState([]);

useEffect(() => {
  const controller = new AbortController();

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics", {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Unable to load analytics");
      setRows(await response.json());
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error(error);
        // Set an error state and show an error message in your page.
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  load();
  return () => controller.abort();
}, []);
```

## 5. Timing and behavior

- `minLoadingMs` defaults to 450 ms to avoid a flash for very fast requests.
- `transitionMs` defaults to 850 ms for route changes.
- The progress bar is an indeterminate activity indicator, not a claim of actual percentage complete.
- If the overlay should not block user interaction, adjust `.bi-loader` pointer-events intentionally. By default, it blocks clicks while visible.
- The demo's 1.8-second `setTimeout` simulates a request. Remove it and connect your actual data state in production.

## 6. Customization

- Main green: `--bi-green` in `bi-transition.css`
- Cyan accent: `--bi-cyan`
- Orb size: `.bi-loader__scene`
- Overlay background: `.bi-loader`
- Label: `label` prop
- Timing: `minLoadingMs` and `transitionMs`

## 7. Production notes

- This component uses CSS/SVG only; no GSAP or Lottie dependency is required.
- It uses `window` timers inside effects, so it is safe for standard client-rendered React and avoids accessing browser APIs during render.
- For SSR frameworks such as Next.js App Router, add `"use client";` at the top of `BITransition.jsx`.
- The SVG gradient ID is fixed; if multiple copies of this component can render at once, change the ID to a unique ID using React `useId()`.
- The visual is intentionally an indeterminate loader. Use an accessible text/status message and expose real errors separately.
