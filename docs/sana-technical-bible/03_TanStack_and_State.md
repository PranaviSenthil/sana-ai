# Sana AI Technical Bible - Part 3: Routing & State Management

This section explains how data flows through Sana AI and how the user navigates between pages. Master these concepts to prove you understand modern React architecture.

## Part 3 — TanStack Start & Router

Standard React applications use `react-router-dom`. Sana AI uses **TanStack Start / TanStack Router**, which is much more advanced.

### 1. File-Based Routing
**What it is:** Instead of defining routes in a massive JavaScript array, the folder structure dictates the URLs.
**Where it is used:** Look at the `src/routes/` folder.
*   `src/routes/index.tsx` -> `/`
*   `src/routes/_authenticated/home.tsx` -> `/home`

### 2. Nested & Route Layouts
**What it is:** The `__root.tsx` file defines the layout for the entire app. Routes prefixed with `_` (like `_authenticated`) are layout routes—they don't add to the URL path, but they wrap child routes in a shared layout.
**Where it is used:** `src/routes/_authenticated` forces all files inside it to inherit the layout defined in `src/routes/_authenticated/route.tsx`, which usually includes the Sidebar and Navigation.

### 3. Protected Routes
**Where it is used:** `src/routes/_authenticated/route.tsx` acts as a guard. Before rendering children, it checks if the user is authenticated (via Supabase Auth). If not, it redirects them to the login page (`/`).

### 4. Dynamic Routes
**What it is:** URLs that change based on data (like IDs).
**Where it is used:** `study-together.$groupId.tsx`. The `$groupId` in the filename tells TanStack Router that this part of the URL is a variable. Inside the component, we access it via `useParams()` to know which group to fetch data for.

---

## Part 7 — React Query (TanStack Query)

React Query handles "Server State"—data that lives on our Supabase backend.

### 1. `useQuery` (Fetching Data)
**What it is:** A hook that fetches data, caches it, and provides `isLoading` and `isError` flags automatically.
**Where it is used:** In `src/hooks/use-study-groups.ts`, `useQuery` fetches the user's groups from Supabase. If you navigate away and come back, React Query returns the cached data instantly while refetching in the background (stale-while-revalidate).

### 2. `useMutation` (Modifying Data)
**What it is:** Used for POST/PUT/DELETE requests. It handles loading states for buttons while data is being saved.
**Where it is used:** `study-together.create.tsx`. When a user submits the "Create Group" form, a mutation fires to insert the row into Supabase.

### 3. Query Invalidation
**What it is:** Telling React Query "the data you cached is now outdated, go fetch it again."
**Where it is used:** After successfully creating a study group using a mutation, we call `queryClient.invalidateQueries({ queryKey: ['study-groups'] })`. This forces the home dashboard to refresh automatically without the user having to reload the page!

### 4. Dependent Queries
**What it is:** A query that waits for another query to finish before it runs.
**Where it is used:** Fetching notes for a specific revision set requires the `setId` first. The query is disabled (`enabled: !!setId`) until the ID is available.

---

## Part 8 — Zustand

Zustand handles "Client State"—temporary UI state that lives in the browser memory and doesn't need to be saved to the database.

### 1. Global Store
**What it is:** A centralized place to hold data that multiple components need access to.
**Where it is used:** `src/store/useSidebarStore.ts`.

### 2. Actions & Selectors
**What it is:** 
*   *State:* e.g., `isOpen: boolean`
*   *Actions:* e.g., `toggleSidebar: () => void`
**Where it is used:** The `NavigationDrawer` component reads `isOpen` to decide if it should be visible. The Hamburger menu button calls `toggleSidebar()` to change that state.

**Interview Question:** *Why did you use Zustand instead of Redux or React Context?*
"Redux requires massive amounts of boilerplate (actions, reducers, dispatchers) which is overkill for simple UI state. React Context is fine, but it causes re-renders for every component that consumes the context whenever any part of the value changes. Zustand is incredibly lightweight, requires almost zero boilerplate, and allows components to subscribe to specific slices of state without unnecessary re-renders."
