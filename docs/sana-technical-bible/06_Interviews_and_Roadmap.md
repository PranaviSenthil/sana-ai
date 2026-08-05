# Sana AI Technical Bible - Part 6: Interview Guide & Study Roadmap

This section prepares you for project reviews, vivas, and technical interviews based on Sana AI.

## Part 20 — Common Interview Questions

### 1. The "What & Why" of the Stack
**Q: What is TanStack Start, and why didn't you just use Create React App?**
*Answer:* "Create React App is deprecated and only supports client-side rendering. TanStack Start is a modern full-stack React framework. We chose it because it provides type-safe, file-based routing and integrates seamlessly with TanStack Query, which was critical for managing our complex data fetching requirements."

**Q: Why use Supabase instead of writing your own Node.js/Express backend?**
*Answer:* "Sana AI is highly data-driven and requires Realtime capabilities for the 'Study Together' feature. Supabase provides an out-of-the-box Postgres database with built-in Row Level Security (RLS) and WebSockets for real-time sync. Writing a custom backend would have added unnecessary boilerplate for authentication and CRUD operations, slowing down feature development."

**Q: What is Zustand, and why didn't you use Redux?**
*Answer:* "Zustand is a minimalistic global state manager for React. Redux is powerful but requires a lot of boilerplate (actions, reducers). Our global state needs were simple—mostly UI state like sidebar toggles and current theme—so Zustand's hook-based approach was much cleaner and more performant."

### 2. Architectural Decisions
**Q: How do you handle security so users can't delete each other's study notes?**
*Answer:* "We rely on Postgres Row Level Security (RLS) via Supabase. We wrote policies directly on the `notes` and `profiles` tables ensuring that database operations are only permitted if the `auth.uid()` of the requester matches the `user_id` of the row. This means the security is enforced at the lowest possible level, not just in the UI."

**Q: How does the AI actually read YouTube videos or Classroom PDFs?**
*Answer:* "We use a RAG (Retrieval-Augmented Generation) pipeline. When a document is processed, its text is broken into chunks. We generate a vector embedding (an array of floats) for each chunk and store it in Postgres using the `pgvector` extension. When a user asks a question, we embed the query and perform a cosine-similarity search in SQL to find the most relevant chunks, which we then feed to the LLM as context."

**Q: How did you implement the AI Accountability Calls?**
*Answer:* "It relies on a scheduled cron-like system. Reminders are saved to Postgres. A worker process checks for due calls and triggers the Twilio Voice API. Twilio handles the telephony, passing the user's speech to our system via Webhooks, which we then pipe through our LLM to generate the voice response."

---

## Part 21 — The 8-Week "Rebuild & Master" Roadmap

To truly master this project, follow this 8-week structured roadmap. Don't just read—build mini-projects based on these concepts.

### Week 1: React & Tailwind Foundations
*   **Goal:** Understand UI construction.
*   **Tasks:** 
    *   Build a static clone of the Sana Dashboard using only React functional components and Tailwind CSS.
    *   Implement `useState` for a simple to-do list within a component.
    *   Master Flexbox and Grid layouts using Tailwind classes.

### Week 2: Routing & TanStack Router
*   **Goal:** Understand how pages connect.
*   **Tasks:**
    *   Set up a new Vite project with TanStack Router.
    *   Create a file-based routing structure with a layout (`__root.tsx`) and dynamic routes (`/groups/$id`).
    *   Implement an authentication guard that redirects unauthenticated users to a login page.

### Week 3: Backend & Supabase (The Core)
*   **Goal:** Understand databases and Auth.
*   **Tasks:**
    *   Create a free Supabase project.
    *   Implement Google OAuth login in your test app.
    *   Create a `tasks` table and write an RLS policy that only allows the creator to read/write their tasks.

### Week 4: Server State & React Query
*   **Goal:** Connect the Frontend to the Backend.
*   **Tasks:**
    *   Use `useQuery` to fetch the tasks from Supabase and display them.
    *   Use `useMutation` to add a new task.
    *   Implement Query Invalidation so the list updates instantly after adding a task without refreshing the page.

### Week 5: Vercel AI SDK & Chat Interfaces
*   **Goal:** Master LLM integration.
*   **Tasks:**
    *   Get a free Groq or Google Gemini API key.
    *   Use the `useChat` hook from `@ai-sdk/react` to build a simple streaming chatbot.
    *   Implement `react-markdown` to properly format the AI's responses.

### Week 6: Realtime & Study Together Concepts
*   **Goal:** Understand collaborative features.
*   **Tasks:**
    *   Look into Supabase Realtime documentation.
    *   Build a simple "Shared Whiteboard" or "Shared Task List" where if you open the app in two tabs, changing a task in one tab instantly updates the other via WebSockets.

### Week 7: Global State & UI Polish (Zustand & Shadcn)
*   **Goal:** Make the app feel premium.
*   **Tasks:**
    *   Install Shadcn UI components (Buttons, Dialogs, Toasts).
    *   Use Zustand to create a global store that manages a "Dark Mode" toggle or a "Sidebar Open" state.
    *   Add Framer Motion for simple page transition animations.

### Week 8: The "Explain It" Phase (Review Prep)
*   **Goal:** Articulate your knowledge.
*   **Tasks:**
    *   Do a mock interview. Explain the flow of data from the moment a user clicks "Login" to the moment they see their Dashboard.
    *   Read through your actual Sana AI codebase and trace one complete feature (like creating a revision set) from the UI click -> React Query Mutation -> Supabase Backend -> RLS Policy.
    *   Review the Technical Bible. You are now ready!
