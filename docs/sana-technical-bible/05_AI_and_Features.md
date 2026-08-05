# Sana AI Technical Bible - Part 5: AI & Core Features

This section details the custom logic and architectures for the features that make Sana AI a powerful learning ecosystem.

## Part 11 — AI Architecture & Vercel AI SDK

We do not use standard `fetch()` calls to OpenAI. We use the **Vercel AI SDK**.

### 1. Streaming & The `useChat` Hook
**How it works:** LLMs generate text token by token. Instead of making the user wait 10 seconds for the whole response, the Vercel AI SDK uses Server-Sent Events (SSE) to stream the text to the browser as it is generated.
**Where it is used:** `src/routes/_authenticated/chat.tsx`. We import `useChat` from `@ai-sdk/react`. It automatically handles the `messages` array, the `input` state, and the `handleSubmit` function.

### 2. Provider Agnosticism (Groq & Google)
**How it works:** We use `@ai-sdk/google` (Gemini) and `@ai-sdk/groq` (Llama/Mixtral). The SDK abstracts the provider differences so the frontend logic remains identical regardless of which model powers the backend.

### 3. Prompt Engineering & System Prompts
**How it works:** The LLM needs context. We inject a "System Prompt" invisibly before the user's message.
**Where it is used:** When a user enters "My Study Space", the system prompt instructs the AI: *"You are an expert tutor for the topic X. The user's current knowledge level is Y. Ask them a quiz question before providing the answer."* This defines the AI's behavior and personality.

### 4. Markdown Rendering
**How it works:** The AI responds in Markdown. We use `react-markdown` and `react-syntax-highlighter` to safely render bold text, lists, and code blocks in the UI (`src/components/app/sana-markdown.tsx`).

---

## Part 12 — Study Together (Collaborative Learning)

**Architecture:** 
1. A user creates a group. The AI dynamically generates a "Study Roadmap" (syllabus).
2. The AI evaluates the "Learning Profiles" of invited members (their weak areas, past XP).
3. The AI algorithm distributes specific topics from the roadmap to specific members based on their profiles.
4. **Realtime Sync:** Changes to the group state (e.g., someone finishes their topic) are synced to everyone via Supabase Realtime channels.
**Where it is used:** `src/routes/_authenticated/study-together.index.tsx` and `study-together.$groupId.tsx`.

---

## Part 13 — My Study Space

**Architecture:** 
This is the immersive learning mode.
1. When a user clicks "Start Learning" on their assigned topic, they enter the Study Space.
2. The AI pulls context about the specific topic.
3. As the user interacts, the AI generates "Study Notes" (saved to `study_notes`) and "Quiz Questions" (saved to `quiz_questions`).
4. **Persistence:** The session is saved to `chat_threads` so the user can resume exactly where they left off.

---

## Part 14 — Focus Score & Analytics

**Architecture:** 
Sana uses a Gamified Progression System.
1. **XP & Focus Score:** Every completed task, successful quiz, or finished Pomodoro session triggers a Supabase mutation to increment the user's XP and Focus Score in the `profiles` table.
2. **Streak:** A database cron job or login check evaluates if the user logged in within 24 hours of their last session to update `streak_days`.
3. **Analytics UI:** `src/routes/_authenticated/analytics.tsx` uses the `recharts` library to visualize learning trends (Time Spent vs. XP Gained) by aggregating data from the `profiles` and `revision_sets` tables.

---

## Part 15 — AI Accountability Calls

**Architecture:**
This is one of the most advanced features, moving beyond the browser.
1. **Scheduling:** The user schedules a call in `voice-call.new.tsx`. This saves a row to `study_call_reminders` with a `scheduled_at` timestamp.
2. **Trigger:** A background worker or Supabase Edge Function runs every minute checking for due reminders.
3. **Execution:** It hits the Twilio Voice API, initiating a phone call to the user's `phone_e164`.
4. **Voice AI Flow:** 
    * Twilio listens to the user's voice and converts it to text (Speech-to-Text).
    * The text is sent to our LLM with the prompt: *"Act as a strict accountability coach. The user promised to study DBMS."*
    * The LLM's text response is sent back to Twilio, which uses Text-to-Speech to speak to the user.
5. **Logging:** The transcript and AI-determined "mood" are saved to `call_sessions`.

---

## Part 16 — Resources & Knowledge Hub

**Architecture:**
1. **Upload:** User selects a PDF. The frontend uploads it to Supabase Storage (Bucket: `user-uploads`).
2. **Database Record:** A row is created in `uploads` mapping the file path.
3. **Vectorization (RAG Workflow):** A background process extracts text from the PDF, splits it into chunks, generates embeddings, and saves them to `classroom_chunks`.
4. **Retrieval:** When studying in the Knowledge Hub, the AI can now silently search these embeddings to answer questions specifically based on the uploaded PDFs.
