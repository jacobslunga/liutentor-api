import { describe, expect, it } from "bun:test";
import {
  measureCorrectAnswerLengthBias,
  rebalanceQuizAnswerDistribution,
} from "../src/api/v1/quiz.utils";
import type { MultipleChoiceQuiz } from "../src/api/v1/quiz.schemas";

function makeQuestion(id: number, answer: number) {
  return {
    id,
    question: `Fraga ${id}`,
    options: [
      `Q${id} Option A`,
      `Q${id} Option B`,
      `Q${id} Option C`,
      `Q${id} Option D`,
    ],
    answer,
  };
}

describe("rebalanceQuizAnswerDistribution", () => {
  it("should keep the same correct option text per question", () => {
    const quiz: MultipleChoiceQuiz = {
      quiz: {
        questions: Array.from({ length: 10 }, (_, i) => makeQuestion(i + 1, 0)),
      },
    };

    const originalCorrectOptions = quiz.quiz.questions.map(
      (q) => q.options[q.answer],
    );

    const rebalanced = rebalanceQuizAnswerDistribution(quiz);

    rebalanced.quiz.questions.forEach((question, index) => {
      expect(question.options[question.answer]).toBe(
        originalCorrectOptions[index],
      );
    });
  });

  it("should spread answer indices instead of concentrating one index", () => {
    const quiz: MultipleChoiceQuiz = {
      quiz: {
        questions: Array.from({ length: 10 }, (_, i) => makeQuestion(i + 1, 0)),
      },
    };

    const rebalanced = rebalanceQuizAnswerDistribution(quiz);

    const counts = [0, 0, 0, 0];
    for (const question of rebalanced.quiz.questions) {
      counts[question.answer] += 1;
    }

    // For 10 questions distributed over 4 slots, max concentration should be 3.
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
  });
});

describe("buildTargetAnswerPositions (via rebalance)", () => {
  it("should not always give the leftover slots to the same indices", () => {
    // 10 questions over 4 slots leaves two slots with an extra answer. Those
    // two should vary between quizzes, otherwise index 0 and 1 become the
    // statistically safest guesses.
    const bonusWinners = new Set<string>();

    for (let run = 0; run < 40; run++) {
      const quiz: MultipleChoiceQuiz = {
        quiz: {
          questions: Array.from({ length: 10 }, (_, i) =>
            makeQuestion(i + 1, 0),
          ),
        },
      };

      const counts = [0, 0, 0, 0];
      for (const question of rebalanceQuizAnswerDistribution(quiz).quiz
        .questions) {
        counts[question.answer] += 1;
      }

      bonusWinners.add(
        counts
          .map((count, index) => ({ count, index }))
          .filter((entry) => entry.count === 3)
          .map((entry) => entry.index)
          .join(","),
      );
    }

    expect(bonusWinners.size).toBeGreaterThan(1);
  });
});

describe("measureCorrectAnswerLengthBias", () => {
  function quizWithOptions(optionSets: string[][]): MultipleChoiceQuiz {
    return {
      quiz: {
        questions: optionSets.map((options, index) => ({
          id: index + 1,
          question: `Fraga ${index + 1}`,
          options,
          answer: 0,
        })),
      },
    };
  }

  it("flags a quiz where the correct option is always the longest", () => {
    const bias = measureCorrectAnswerLengthBias(
      quizWithOptions(
        Array.from({ length: 4 }, () => [
          "Ett mycket langt och detaljerat korrekt svarsalternativ",
          "Kort fel",
          "Kort fel igen",
          "Ocksa kort",
        ]),
      ),
    );

    expect(bias.longestCount).toBe(4);
    expect(bias.longestShare).toBe(1);
    expect(bias.meanLengthRatio).toBeGreaterThan(1.5);
  });

  it("stays near neutral when options are balanced", () => {
    const bias = measureCorrectAnswerLengthBias(
      quizWithOptions(
        Array.from({ length: 4 }, () => [
          "Alternativ ett med jamn langd",
          "Alternativ tva med jamn langd",
          "Alternativ tre med jamn langd har",
          "Alternativ fyra med jamn langd",
        ]),
      ),
    );

    expect(bias.longestCount).toBe(0);
    expect(bias.meanLengthRatio).toBeLessThan(1.1);
  });

  it("does not count a tie as a length tell", () => {
    // Four options of the same length carry no information about which is
    // correct, so this is the balanced case the prompt aims for, not a bias.
    const bias = measureCorrectAnswerLengthBias(
      quizWithOptions(
        Array.from({ length: 4 }, () => [
          "Alternativ ett",
          "Alternativ tva",
          "Alternativ tre",
          "Alternativ fyr",
        ]),
      ),
    );

    expect(bias.longestCount).toBe(0);
    expect(bias.meanLengthRatio).toBe(1);
  });

  it("handles an empty quiz without dividing by zero", () => {
    const bias = measureCorrectAnswerLengthBias({ quiz: { questions: [] } });
    expect(bias).toEqual({
      questionCount: 0,
      longestCount: 0,
      longestShare: 0,
      meanLengthRatio: 1,
    });
  });
});
