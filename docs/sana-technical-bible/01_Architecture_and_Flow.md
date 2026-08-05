# Sana AI Technical Bible - Part 1: Architecture & Project Flow

Welcome to the comprehensive technical documentation for Sana AI. This guide is your ultimate reference for project reviews, viva, and understanding exactly what you have built.

## Part 1 — Complete Project Architecture

Sana AI is not a simple frontend React app. It is a **full-stack AI-powered learning ecosystem**. 

### 1. High-Level System Architecture
The system operates on a modern, serverless architecture using a **BaaS (Backend-as-a-Service)** model coupled with edge AI processing.
*   **Client Layer:** A React 19 application running in the browser, built with Vite and TanStack Start.
*   **Backend Layer:** Supabase provides an out-of-the-box PostgreSQL database, Authentication, and Storage. We do not maintain our own Express or Node.js server.
*   **AI Integration Layer:** The Vercel AI SDK acts as the bridge connecting the client directly to LLMs (Google, Groq) via secure calls, handling text streaming automatically.
*   **Third-Party APIs:** Integration with Google Classroom API and YouTube Data API to pull external educational context into the Sana ecosystem.

### 2. Frontend Architecture
*   **Framework:** TanStack Start (a meta-framework built on React and TanStack Router).
*   **Component Structure:** We use atomic design principles. `src/components/ui` contains reusable, pure presentational components (Buttons, Inputs). `src/components/app` and `src/components/study-together` contain feature-specific, stateful components.
*   **Routing:** File-based routing (`src/routes`). This eliminates the need for a massive `App.js` with dozens of `<Route>` definitions.

### 3. Backend & Database Architecture (Supabase)
*   **Relational Database:** PostgreSQL is used because learning data (Users -> Revision Sets -> Flashcards/Notes) is highly relational.
*   **Authentication:** Managed via Supabase Auth. We use JWTs (JSON Web Tokens) that are automatically attached to database requests.
*   **Row Level Security (RLS):** This is the core of our security architecture. Instead of writing backend API endpoints to verify if a user owns a note, we write SQL rules (RLS policies) directly on the table. When the frontend requests `SELECT * FROM notes`, Postgres automatically filters the results to only show notes belonging to the authenticated user.

### 4. AI Architecture
*   **Model Agnosticism:** By using the Vercel AI SDK (`ai`, `@ai-sdk/react`), the app is not locked into a single provider.
*   **Streaming UI:** When a user chats with the AI, the response is not generated and sent all at once (which takes 5-10 seconds). Instead, it is streamed chunk-by-chunk using Server-Sent Events (SSE). The frontend reads this stream and updates the React state incrementally.
*   **Vector Search (RAG - Retrieval-Augmented Generation):** For the YouTube and Classroom features, documents and video transcripts are chunked, converted to embeddings using `vector(1536)`, and stored in Postgres. We use Postgres functions (like `match_youtube_chunks`) to calculate cosine similarity to answer questions based on specific context.

### 5. Feature Architectures
*   **Study Together:** A collaborative feature that uses **Supabase Realtime** to sync state across users in a group. When one user updates the group timeline, an event is broadcasted via WebSockets to all other clients to update their UI instantly.
*   **AI Accountability Calls:** Utilizes scheduled database triggers/reminders. A scheduled task triggers an edge function or external worker that initiates a Twilio voice call, utilizing voice-to-text and an LLM to simulate a human accountability partner.
*   **Focus Score & Gamification:** A progressive system where completing tasks, quizzes, and focus sessions adds XP to the `profiles` table. The frontend listens to XP changes to trigger animations (e.g., `canvas-confetti`).

---

## Part 19 — Project Flow

To fully understand how a user experiences Sana AI and how data moves through the system, here is the complete, high-level project flow.

```text
1. User Signup / Login
   ↓ (Supabase Auth creates user in `auth.users`)
   ↓ (Database Trigger automatically creates a row in `public.profiles`)
2. Onboarding
   ↓ (User selects goals, AI personality -> saves to `onboarding_preferences`)
3. Home Dashboard (`src/routes/_authenticated/home.tsx`)
   ↓ (Fetches Profile, Tasks, and active Study Groups via React Query)
4. Feature: Study Together (`/study-together`)
   ↓ (User creates or joins a group. Data saved to `study_groups` / `group_members`)
   ↓ (AI generates a study roadmap and distributes topics among members)
5. Feature: My Study Space (`/study-together/$groupId`)
   ↓ (User enters workspace to learn their specific topic)
   ↓ (AI provides context, notes, and quizzes based on the topic)
6. Feature: Revision & Progress (`/revision`)
   ↓ (User generates Flashcards or Notes from chats. Saved to `flashcards` and `notes`)
   ↓ (Progress % is updated in `revision_sets`)
7. Feature: Analytics & Gamification (`/analytics`)
   ↓ (System calculates XP based on flashcard mastery and task completion)
   ↓ (Focus Score and Streak Days are updated daily based on activity)
8. Feature: AI Calls (`/voice-call/new`)
   ↓ (User schedules an accountability call. Saved to `study_call_reminders`)
   ↓ (At scheduled time, system initiates a real-time voice call to check on progress)
```

**Interview Tip for Project Flow:**
If asked to explain how the app works, don't list features. Instead, tell a story of a user: *"A user logs in via Google OAuth. The system provisions a profile via a Postgres trigger. They navigate to their dashboard, where React Query fetches their active tasks. They join a 'DBMS' study group, where our AI distributes the syllabus. They enter 'My Study Space' where the AI tutors them on their assigned topic, and their progress is tracked globally in the Zustand store to update their Focus Score."*
