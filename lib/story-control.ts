import type { BookContract, ChapterSceneCard } from "./types";

export const EMPTY_BOOK_CONTRACT: BookContract = {
  readingPromise: "",
  protagonistFantasy: "",
  coreSellingPoint: "",
  chapter3Payoff: "",
  chapter10Payoff: "",
  chapter30Payoff: "",
  escalationLadder: "",
  relationshipMainline: "",
  absoluteRedLines: [],
};

export function sceneCardLabel(card: Pick<ChapterSceneCard, "title" | "objective" | "conflict" | "reveal" | "emotionBeat">) {
  const details = [
    card.objective && `目标：${card.objective}`,
    card.conflict && `冲突：${card.conflict}`,
    card.reveal && `揭示：${card.reveal}`,
    card.emotionBeat && `情绪：${card.emotionBeat}`,
  ].filter(Boolean);
  return details.length ? `${card.title}（${details.join("；")}）` : card.title;
}
