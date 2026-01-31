import { describe, it, expect, beforeAll, mock } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { success, fail } from "../src/utils/response";

// Mock the supabase module before importing routes
// We'll create a fresh app for testing without external dependencies

describe("Response utilities", () => {
  it("success should return correct format", () => {
    const result = success({ data: "test" }, "Success message");

    expect(result.success).toBe(true);
    expect(result.message).toBe("Success message");
    expect(result.payload).toEqual({ data: "test" });
  });

  it("success should use default message", () => {
    const result = success({ data: "test" });

    expect(result.success).toBe(true);
    expect(result.message).toBe("OK");
    expect(result.payload).toEqual({ data: "test" });
  });

  it("fail should return correct format", () => {
    const result = fail("Error message");

    expect(result.success).toBe(false);
    expect(result.message).toBe("Error message");
    expect(result.payload).toBeNull();
  });
});

describe("API Routes", () => {
  let app: Hono;

  // Create a test app with mocked dependencies
  beforeAll(() => {
    app = new Hono().basePath("/api");

    // Mock supabase middleware
    app.use(async (c, next) => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === "exams") {
            return {
              select: () => ({
                eq: (field: string, value: string | number) => ({
                  eq: () => ({
                    order: () =>
                      Promise.resolve({
                        data:
                          value === "NONEXISTENT"
                            ? []
                            : [
                                {
                                  id: 1,
                                  course_code: "TDDD27",
                                  exam_date: "2023-01-01",
                                  pdf_url: "https://example.com/exam.pdf",
                                  exam_name: "Exam 1",
                                  solutions: [],
                                },
                              ],
                        error: null,
                      }),
                  }),
                  single: () =>
                    Promise.resolve({
                      data:
                        Number(value) === 999
                          ? null
                          : {
                              id: 1,
                              course_code: "TDDD27",
                              exam_date: "2023-01-01",
                              pdf_url: "https://example.com/exam.pdf",
                              solutions: [],
                            },
                      error: Number(value) === 999 ? { message: "Not found" } : null,
                    }),
                }),
              }),
            };
          }
          if (table === "exam_stats") {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [],
                    error: null,
                  }),
              }),
            };
          }
          return {};
        },
      };
      c.set("supabase", mockSupabase as any);
      await next();
    });

    // Error handler
    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json(fail(err.message), err.status);
      }
      console.error(err);
      return c.json(fail("Internal server error"), 500);
    });

    // Import and use the actual route logic (inline version for testing)
    const examsRouter = new Hono().basePath("/v1/exams");

    examsRouter.get("/:university/:courseCode", async (c) => {
      const supabase = c.get("supabase");
      const { courseCode, university } = c.req.param();

      if (!courseCode) {
        throw new HTTPException(400, { message: "Missing courseCode" });
      }

      if (!university) {
        throw new HTTPException(400, { message: "Missing university" });
      }

      const validUniversities = ["LIU", "KTH", "CTH", "LTH"];
      if (!validUniversities.includes(university)) {
        throw new HTTPException(400, { message: "Invalid university" });
      }

      const { data: examsData, error: examsError } = await supabase
        .from("exams")
        .select("id, course_code, exam_date, pdf_url, exam_name, solutions(exam_id)")
        .eq("course_code", courseCode)
        .eq("university", university)
        .order("exam_date", { ascending: false });

      if (examsError) {
        throw new HTTPException(500, { message: "Failed to fetch exams" });
      }

      if (!examsData || examsData.length === 0) {
        throw new HTTPException(404, {
          message: "No exam documents found for this course",
        });
      }

      const examsList = examsData.map((exam: any) => ({
        ...exam,
        has_solution: Boolean(exam.solutions?.length),
      }));

      return c.json(
        success(
          { courseCode, courseName: "", exams: examsList },
          "Exams fetched successfully"
        )
      );
    });

    examsRouter.get("/:examId", async (c) => {
      const supabase = c.get("supabase");
      const { examId } = c.req.param();

      if (!examId) {
        throw new HTTPException(400, { message: "Missing examId" });
      }

      const id = Number(examId);
      if (!Number.isInteger(id) || id <= 0) {
        throw new HTTPException(400, {
          message: "examId must be a positive integer",
        });
      }

      const { data, error } = await supabase
        .from("exams")
        .select("id, course_code, exam_date, pdf_url, solutions(*)")
        .eq("id", id)
        .single();

      if (error || !data) {
        throw new HTTPException(404, { message: "Exam not found" });
      }

      const { solutions, ...exam } = data;
      return c.json(
        success({ exam, solution: solutions?.[0] ?? null }, "Exam fetched successfully")
      );
    });

    app.route("/", examsRouter);
  });

  describe("GET /api/v1/exams/:university/:courseCode", () => {
    it("should return exams for valid university and course code", async () => {
      const res = await app.request("/api/v1/exams/LIU/TDDD27");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toBe("Exams fetched successfully");
      expect(json.payload.courseCode).toBe("TDDD27");
      expect(json.payload.exams).toBeInstanceOf(Array);
    });

    it("should return 400 for invalid university", async () => {
      const res = await app.request("/api/v1/exams/INVALID/TDDD27");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("Invalid university");
    });

    it("should return 404 when no exams found", async () => {
      const res = await app.request("/api/v1/exams/LIU/NONEXISTENT");

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("No exam documents found for this course");
    });
  });

  describe("GET /api/v1/exams/:examId", () => {
    it("should return exam for valid examId", async () => {
      const res = await app.request("/api/v1/exams/1");

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toBe("Exam fetched successfully");
      expect(json.payload.exam).toBeDefined();
    });

    it("should return 400 for non-integer examId", async () => {
      const res = await app.request("/api/v1/exams/abc");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("examId must be a positive integer");
    });

    it("should return 400 for zero examId", async () => {
      const res = await app.request("/api/v1/exams/0");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("examId must be a positive integer");
    });

    it("should return 400 for negative examId", async () => {
      const res = await app.request("/api/v1/exams/-5");

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe("examId must be a positive integer");
    });
  });
});

describe("Error handling", () => {
  it("should handle HTTPException properly", async () => {
    const app = new Hono();

    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json(fail(err.message), err.status);
      }
      return c.json(fail("Internal server error"), 500);
    });

    app.get("/error", () => {
      throw new HTTPException(403, { message: "Forbidden" });
    });

    const res = await app.request("/error");
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe("Forbidden");
  });

  it("should handle generic errors as 500", async () => {
    const app = new Hono();

    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json(fail(err.message), err.status);
      }
      return c.json(fail("Internal server error"), 500);
    });

    app.get("/error", () => {
      throw new Error("Something went wrong");
    });

    const res = await app.request("/error");
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe("Internal server error");
  });
});
