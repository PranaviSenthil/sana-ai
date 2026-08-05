import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Google Classroom sync engine.
 *
 * Each step is its own server function so the UI can render animated
 * per-step progress. All steps load getValidAccessToken() from the
 * centralized server-only auth service.
 */

async function gcFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://classroom.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Classroom ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function paginated<T>(
  token: string,
  path: string,
  itemsKey: string,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  let safety = 20; // hard cap on pages per resource
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const page = await gcFetch<Record<string, unknown>>(token, url);
    const items = (page[itemsKey] as T[] | undefined) ?? [];
    out.push(...items);
    pageToken = page.nextPageToken as string | undefined;
    safety -= 1;
  } while (pageToken && safety > 0);
  return out;
}

// ─────────────────────────── Step 1: courses ───────────────────────────

type GCourse = {
  id: string;
  name: string;
  section?: string;
  description?: string;
  room?: string;
  ownerId?: string;
  courseState?: string;
  alternateLink?: string;
  enrollmentCode?: string;
  creationTime?: string;
  updateTime?: string;
};

export const syncClassroomCourses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getValidAccessToken } = await import("@/lib/classroom-auth.server");
    const token = await getValidAccessToken(context.supabase, context.userId);

    console.log(`\nGoogle Classroom Request Started`);
    console.log(`User ID: ${context.userId}`);

    const courses = await paginated<GCourse>(
      token,
      "/v1/courses?studentId=me&courseStates=ACTIVE&courseStates=ARCHIVED",
      "courses",
    );
    
    console.log(`Courses Found: ${courses.length}`);
    console.log(`Google Classroom Request Completed`);

    if (courses.length) {
      const rows = courses.map((c) => ({
        user_id: context.userId,
        google_course_id: c.id,
        name: c.name,
        section: c.section ?? null,
        description: c.description ?? null,
        room: c.room ?? null,
        owner_id: c.ownerId ?? null,
        course_state: c.courseState ?? null,
        alternate_link: c.alternateLink ?? null,
        enrollment_code: c.enrollmentCode ?? null,
        google_created_at: c.creationTime ?? null,
        google_updated_at: c.updateTime ?? null,
      }));
      const { error } = await context.supabase
        .from("classroom_courses")
        .upsert(rows, { onConflict: "user_id,google_course_id" });
      if (error) throw error;
    }
    return { count: courses.length, courseIds: courses.map((c) => c.id) };
  });

// ─────────────────────────── Step 2: coursework ───────────────────────────

type GCoursework = {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  workType?: string;
  state?: string;
  alternateLink?: string;
  maxPoints?: number;
  materials?: unknown[];
  creationTime?: string;
  updateTime?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
};

function dueAtIso(cw: GCoursework): string | null {
  if (!cw.dueDate) return null;
  const { year, month, day } = cw.dueDate;
  const h = cw.dueTime?.hours ?? 23;
  const m = cw.dueTime?.minutes ?? 59;
  return new Date(Date.UTC(year, month - 1, day, h, m)).toISOString();
}

export const syncClassroomCoursework = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { getValidAccessToken } = await import("@/lib/classroom-auth.server");
    const token = await getValidAccessToken(context.supabase, context.userId);
    let total = 0;
    for (const courseId of data.courseIds) {
      let items: GCoursework[] = [];
      try {
        items = await paginated<GCoursework>(
          token,
          `/v1/courses/${courseId}/courseWork`,
          "courseWork",
        );
      } catch {
        continue;
      }
      if (!items.length) continue;
      const rows = items.map((cw) => ({
        user_id: context.userId,
        google_course_id: courseId,
        google_coursework_id: cw.id,
        title: cw.title,
        description: cw.description ?? null,
        work_type: cw.workType ?? null,
        state: cw.state ?? null,
        alternate_link: cw.alternateLink ?? null,
        max_points: cw.maxPoints ?? null,
        due_at: dueAtIso(cw),
        materials: (cw.materials ?? []) as any,
        google_created_at: cw.creationTime ?? null,
        google_updated_at: cw.updateTime ?? null,
      }));
      const { error } = await context.supabase
        .from("classroom_coursework")
        .upsert(rows, { onConflict: "user_id,google_coursework_id" });
      if (error) throw error;
      total += rows.length;
    }
    console.log(`Coursework Found: ${total}`);
    return { count: total };
  });

// ─────────────────────────── Step 3: announcements ───────────────────────────

type GAnnouncement = {
  id: string;
  courseId: string;
  text?: string;
  state?: string;
  alternateLink?: string;
  materials?: unknown[];
  creationTime?: string;
  updateTime?: string;
};

export const syncClassroomAnnouncements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { getValidAccessToken } = await import("@/lib/classroom-auth.server");
    const token = await getValidAccessToken(context.supabase, context.userId);
    let total = 0;
    for (const courseId of data.courseIds) {
      let items: GAnnouncement[] = [];
      try {
        items = await paginated<GAnnouncement>(
          token,
          `/v1/courses/${courseId}/announcements`,
          "announcements",
        );
      } catch {
        continue;
      }
      if (!items.length) continue;
      const rows = items.map((a) => ({
        user_id: context.userId,
        google_course_id: courseId,
        google_announcement_id: a.id,
        text: a.text ?? null,
        state: a.state ?? null,
        alternate_link: a.alternateLink ?? null,
        materials: (a.materials ?? []) as any,
        google_created_at: a.creationTime ?? null,
        google_updated_at: a.updateTime ?? null,
      }));
      const { error } = await context.supabase
        .from("classroom_announcements")
        .upsert(rows, { onConflict: "user_id,google_announcement_id" });
      if (error) throw error;
      total += rows.length;
    }
    console.log(`Announcements Found: ${total}`);
    return { count: total };
  });

// ─────────────────────────── Step 4: coursework materials ───────────────────────────

type GMaterial = {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  state?: string;
  alternateLink?: string;
  materials?: unknown[];
  creationTime?: string;
  updateTime?: string;
};

export const syncClassroomMaterials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { getValidAccessToken } = await import("@/lib/classroom-auth.server");
    const token = await getValidAccessToken(context.supabase, context.userId);
    let total = 0;
    for (const courseId of data.courseIds) {
      let items: GMaterial[] = [];
      try {
        items = await paginated<GMaterial>(
          token,
          `/v1/courses/${courseId}/courseWorkMaterials`,
          "courseWorkMaterial",
        );
      } catch {
        continue;
      }
      if (!items.length) continue;
      const rows = items.map((m) => ({
        user_id: context.userId,
        google_course_id: courseId,
        google_material_id: m.id,
        title: m.title,
        description: m.description ?? null,
        state: m.state ?? null,
        alternate_link: m.alternateLink ?? null,
        materials: (m.materials ?? []) as any,
        google_created_at: m.creationTime ?? null,
        google_updated_at: m.updateTime ?? null,
      }));
      const { error } = await context.supabase
        .from("classroom_materials")
        .upsert(rows, { onConflict: "user_id,google_material_id" });
      if (error) throw error;
      total += rows.length;
    }
    console.log(`Materials Found: ${total}`);
    return { count: total };
  });

// ─────────────────────────── Finalize ───────────────────────────

export const finalizeClassroomSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { error?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("classroom_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: data.error ?? null,
        status: data.error ? "error" : "connected",
      })
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// ─────────────────────────── Summary (for UI) ───────────────────────────

export const getClassroomSyncSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [courses, coursework, announcements, materials] = await Promise.all([
      context.supabase.from("classroom_courses").select("id", { count: "exact", head: true }).eq("user_id", context.userId),
      context.supabase.from("classroom_coursework").select("id", { count: "exact", head: true }).eq("user_id", context.userId),
      context.supabase.from("classroom_announcements").select("id", { count: "exact", head: true }).eq("user_id", context.userId),
      context.supabase.from("classroom_materials").select("id", { count: "exact", head: true }).eq("user_id", context.userId),
    ]);
    return {
      courses: courses.count ?? 0,
      coursework: coursework.count ?? 0,
      announcements: announcements.count ?? 0,
      materials: materials.count ?? 0,
    };
  });
