# Sana AI Technical Bible - Part 2: React, Tailwind & Shadcn

This section breaks down the entire UI and styling layer of Sana AI. You need to know these concepts inside and out, as they form the visual foundation of the app.

## Part 2 — React 19 Core Concepts

React is the library we use to build the UI. Here is exactly how and where React concepts are used in Sana AI.

### 1. JSX (JavaScript XML)
**What it is:** A syntax extension for JavaScript that looks like HTML. It allows us to write UI structures inside JavaScript logic.
**Where it is used:** Every `.tsx` file in the project (e.g., `src/routes/_authenticated/home.tsx`).
**Interview Question:** *Why use JSX instead of regular HTML?* "JSX allows us to seamlessly embed JavaScript expressions (like mapping over an array of flashcards) directly within the UI markup, making components dynamic and declarative."

### 2. Functional Components & Component Composition
**What it is:** Writing UI components as JavaScript functions instead of Classes. Composition is building complex UIs from smaller components.
**Where it is used:** `src/components/app/StudyTogetherHomeCard.tsx` is a functional component that uses smaller components like `<Card>`, `<Button>`, and `<Badge>`.

### 3. React Fragments (`<> ... </>`)
**What it is:** A way to group a list of children without adding extra nodes (like a wrapper `<div>`) to the DOM.
**Where it is used:** Extensively in layout files (like `src/routes/__root.tsx`) where we need to return the main application content alongside hidden components like the `<Toaster />`.

### 4. Props (Properties)
**What it is:** The mechanism for passing data from a parent component down to a child component. Props are read-only.
**Where it is used:** In `src/components/ui/button.tsx`, the `variant` and `size` props determine how the button looks.

### 5. State Management (`useState`)
**What it is:** A hook that allows functional components to hold and update their own local data. When state changes, the component re-renders.
**Where it is used:** In `src/routes/_authenticated/chat.tsx`, `useState` is used to hold the current input text the user is typing (`const [input, setInput] = useState('')`).

### 6. Side Effects (`useEffect`)
**What it is:** A hook used for synchronizing a component with an external system (fetching data, setting up subscriptions, or manipulating the DOM).
**Where it is used:** In chat components, `useEffect` is used to auto-scroll to the bottom of the message list whenever a new message is added.

### 7. References (`useRef`)
**What it is:** A hook that lets you reference a value that’s not needed for rendering (like accessing a DOM element directly) without triggering a re-render.
**Where it is used:** In `chat.tsx`, a `useRef` is attached to the chat container (`<div ref={messagesEndRef}>`) so we can call `messagesEndRef.current.scrollIntoView()` when new messages arrive.

### 8. Custom Hooks
**What it is:** Extracting component logic into reusable functions starting with "use".
**Where it is used:** `src/hooks/use-mobile.tsx` handles the logic of detecting screen size changes, allowing any component to know if it is on a mobile device by simply calling `const isMobile = useMobile()`.

---

## Part 4 — Tailwind CSS

Tailwind is a utility-first CSS framework. We don't write `style.css` files; we write classes directly in JSX.

### 1. Flexbox (`flex`)
**Where it is used:** Almost everywhere. `className="flex flex-col items-center justify-center"` is used to perfectly center elements on the login page and center text within cards.

### 2. Grid (`grid`)
**Where it is used:** `src/routes/_authenticated/home.tsx` uses CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-4`) to create responsive dashboard layouts that are 1 column on mobile and 3 columns on desktop.

### 3. Spacing & Typography
**Where it is used:** We use `p-4` (padding), `m-2` (margin), `text-2xl` (font size), `font-bold` (font weight), and `text-muted-foreground` (semantic color) extensively to ensure visual hierarchy without writing custom CSS rules.

### 4. Responsive Design
**Where it is used:** Tailwind uses mobile-first media queries. A class like `w-full md:w-1/2` means "be 100% width by default (on mobile), but 50% width on medium screens and larger".

### 5. Dark Mode
**Where it is used:** Controlled via the `dark:` prefix. For example, `bg-white dark:bg-zinc-900`. 

---

## Part 5 — Shadcn UI

Shadcn UI provides beautifully designed, accessible components that we own and can edit (found in `src/components/ui`).

*   **Button (`button.tsx`):** Used for all primary actions. It uses `class-variance-authority` (cva) to handle different variants (default, destructive, outline, ghost) and sizes.
*   **Dialog (`dialog.tsx`):** Used for popups, such as the "Create Study Group" modal. It handles accessible keyboard navigation (like pressing `Escape` to close).
*   **Sheet (`sheet.tsx`):** A slide-out panel, used for the mobile navigation drawer (`NavigationDrawer.tsx`).
*   **Form (`form.tsx`):** Wraps `react-hook-form` to provide accessible form fields with automatic error message rendering.
*   **Select (`select.tsx`):** A custom, styled dropdown menu used to pick AI personalities or topics during onboarding.
*   **Scroll Area (`scroll-area.tsx`):** Replaces the ugly default browser scrollbars with custom, sleek scrollbars in chat windows.

---

## Part 6 — Framer Motion

Framer Motion brings the app to life with animations.

### 1. `motion.div` & Transitions
**Where it is used:** In `src/components/app/PremiumSidebar.tsx` or `StyleBottomSheet.tsx` for smooth slide-in and slide-out effects. 

### 2. `AnimatePresence`
**Where it is used:** Wraps components that need an exit animation. React normally unmounts components instantly, but `AnimatePresence` delays unmounting until the `exit` animation completes.

### 3. Loading & Micro-Animations
**Where it is used:** Small hover effects (`whileHover={{ scale: 1.05 }}`) on cards to make the UI feel tactile and premium.

**Interview Tip for UI:** "We chose Tailwind + Shadcn because it allowed us to move extremely fast without sacrificing design consistency or accessibility. We added Framer Motion sparingly for micro-interactions to create a 'premium' feel without degrading performance."
