export interface Exam {
  id: number;
  course_code: string;
  exam_date: string;
  pdf_url: string;
  exam_name: string;
  has_solution: boolean;
  statistics?: any;
  pass_rate?: number;
}

export type ExamReturn = {
  courseCode: string;
  courseName: string;
  exams: Exam[];
};
