import { describe, it, expect, mock } from "bun:test";
import {
  getExamsService,
  getExamService,
  VALID_UNIVERSITIES,
} from "../src/api/services/exams.service";

describe("getExamsService", () => {
  it("should return exams even if stats fetch fails", async () => {
    const mockSupabase = {
      from: mock((table: string) => {
        if (table === "exams") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [
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
              }),
            }),
          };
        }
        if (table === "exam_stats") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: null,
                  error: { message: "Stats fetch failed" },
                }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await getExamsService("TDDD27", "LIU", mockSupabase);

    expect(result.courseCode).toBe("TDDD27");
    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].statistics).toBeUndefined();
    expect(result.exams[0].pass_rate).toBeUndefined();
  });

  it("should return exams and stats when both succeed", async () => {
    const mockSupabase = {
      from: mock((table: string) => {
        if (table === "exams") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [
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
              }),
            }),
          };
        }
        if (table === "exam_stats") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      exam_date: "2023-01-01",
                      statistics: { mean: 10 },
                      pass_rate: 0.5,
                      course_name_swe: "Webprogrammering",
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        return {};
      }),
    } as any;

    const result = await getExamsService("TDDD27", "LIU", mockSupabase);

    expect(result.courseCode).toBe("TDDD27");
    expect(result.courseName).toBe("Webprogrammering");
    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].statistics).toEqual({ mean: 10 });
    expect(result.exams[0].pass_rate).toBe(0.5);
  });

  it("should throw 404 when no exams are found", async () => {
    const mockSupabase = {
      from: mock((table: string) => {
        if (table === "exams") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    await expect(
      getExamsService("NONEXISTENT", "LIU", mockSupabase)
    ).rejects.toThrow("No exam documents found for this course");
  });

  it("should throw 500 when exams query fails", async () => {
    const mockSupabase = {
      from: mock((table: string) => {
        if (table === "exams") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: "Database error" },
                    }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as any;

    await expect(
      getExamsService("TDDD27", "LIU", mockSupabase)
    ).rejects.toThrow("Failed to fetch exams");
  });

  it("should correctly identify exams with solutions", async () => {
    const mockSupabase = {
      from: mock((table: string) => {
        if (table === "exams") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: 1,
                          course_code: "TDDD27",
                          exam_date: "2023-01-01",
                          pdf_url: "https://example.com/exam1.pdf",
                          exam_name: "Exam 1",
                          solutions: [{ exam_id: 1 }],
                        },
                        {
                          id: 2,
                          course_code: "TDDD27",
                          exam_date: "2023-06-01",
                          pdf_url: "https://example.com/exam2.pdf",
                          exam_name: "Exam 2",
                          solutions: [],
                        },
                      ],
                      error: null,
                    }),
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
      }),
    } as any;

    const result = await getExamsService("TDDD27", "LIU", mockSupabase);

    expect(result.exams).toHaveLength(2);
    expect(result.exams[0].has_solution).toBe(true);
    expect(result.exams[1].has_solution).toBe(false);
  });
});

describe("getExamService", () => {
  it("should return exam with solution when found", async () => {
    const mockSupabase = {
      from: mock(() => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  course_code: "TDDD27",
                  exam_date: "2023-01-01",
                  pdf_url: "https://example.com/exam.pdf",
                  solutions: [
                    {
                      id: 1,
                      exam_id: 1,
                      solution_url: "https://example.com/solution.pdf",
                    },
                  ],
                },
                error: null,
              }),
          }),
        }),
      })),
    } as any;

    const result = await getExamService("1", mockSupabase);

    expect(result.exam.id).toBe(1);
    expect(result.exam.course_code).toBe("TDDD27");
    expect(result.solution).not.toBeNull();
    expect(result.solution?.solution_url).toBe(
      "https://example.com/solution.pdf"
    );
  });

  it("should return exam without solution when no solutions exist", async () => {
    const mockSupabase = {
      from: mock(() => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 1,
                  course_code: "TDDD27",
                  exam_date: "2023-01-01",
                  pdf_url: "https://example.com/exam.pdf",
                  solutions: [],
                },
                error: null,
              }),
          }),
        }),
      })),
    } as any;

    const result = await getExamService("1", mockSupabase);

    expect(result.exam.id).toBe(1);
    expect(result.solution).toBeNull();
  });

  it("should throw 404 when exam is not found", async () => {
    const mockSupabase = {
      from: mock(() => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: "Not found" },
              }),
          }),
        }),
      })),
    } as any;

    await expect(getExamService("999", mockSupabase)).rejects.toThrow(
      "Exam not found"
    );
  });

  it("should throw 400 for invalid examId", async () => {
    const mockSupabase = {} as any;

    await expect(getExamService("invalid", mockSupabase)).rejects.toThrow(
      "examId must be a positive integer"
    );
  });

  it("should throw 400 for negative examId", async () => {
    const mockSupabase = {} as any;

    await expect(getExamService("-1", mockSupabase)).rejects.toThrow(
      "examId must be a positive integer"
    );
  });

  it("should throw 400 for zero examId", async () => {
    const mockSupabase = {} as any;

    await expect(getExamService("0", mockSupabase)).rejects.toThrow(
      "examId must be a positive integer"
    );
  });
});

describe("VALID_UNIVERSITIES", () => {
  it("should contain expected universities", () => {
    expect(VALID_UNIVERSITIES).toContain("LIU");
    expect(VALID_UNIVERSITIES).toContain("KTH");
    expect(VALID_UNIVERSITIES).toContain("CTH");
    expect(VALID_UNIVERSITIES).toContain("LTH");
    expect(VALID_UNIVERSITIES).toHaveLength(4);
  });
});
