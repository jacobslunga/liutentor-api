interface Exam {}

type ExamReturn = {
  courseCode: string;
  courseName: string;
  exams: Exam[];
};

export { Exam, ExamReturn };
