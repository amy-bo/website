// Live polling for lectures (amybo.org/glasgow). One question set per lecture; the presenter's slide chooses which of
// its questions is showing. To add a lecture, add a set here and point ACTIVE_SET at it on the day.
// Answers are anonymous (a random device id kept in the phone's browser) and deleted after deleteAfter.

export interface NumberQuestion { id: string; type: 'number'; prompt: string; min: number; max: number; step: number; scale: 'linear' | 'log'; unit: string; bins: number[] }
export interface TextQuestion { id: string; type: 'text'; prompt: string; maxLength: number }
export type Question = NumberQuestion | TextQuestion;
export interface QuestionSet { id: string; title: string; date: string; deleteAfter: string; pollSeconds: number; questions: Question[] }

export const SETS: QuestionSet[] = [
	{
		id: 'why-2026',
		title: 'Why',
		date: '2026-11-25',
		// 30 days after the lecture.
		deleteAfter: '2026-12-25T00:00:00Z',
		pollSeconds: 2,
		questions: [
			{ id: 'q42', type: 'number', prompt: 'By 2100, how many °C of warming do you expect?', min: 1, max: 5, step: 0.1, scale: 'linear', unit: '°C', bins: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] },
			{ id: 'q61', type: 'number', prompt: 'What percentage of the sunlight that lands on grass ends up as steak?', min: 0, max: 10, step: 0.01, scale: 'log', unit: '%', bins: [0, 0.01, 0.03, 0.1, 0.3, 1, 3, 10] },
			{ id: 'q93', type: 'text', prompt: 'Which step in this food chain is the weakest?', maxLength: 80 },
			// Choices as numbers: one bin per choice (each from ≤ v < to; the last also takes its top edge).
			{ id: 'q105', type: 'number', prompt: 'What do we grow in the remote reactor? 1 = spirulina, 2 = hydrogen-oxidising bacteria', min: 1, max: 2, step: 1, scale: 'linear', unit: '', bins: [1, 1.5, 2] },
			{ id: 'q106', type: 'number', prompt: "Where does the inoculum come from? 1 = Martin's very old sample, 2 = a new sample Martin takes, 3 = a sample we take and post", min: 1, max: 3, step: 1, scale: 'linear', unit: '', bins: [1, 1.5, 2.5, 3] },
		],
	},
];

export const ACTIVE_SET = 'why-2026';

export const findSet = (id?: string | null) => SETS.find((s) => s.id === (id || ACTIVE_SET));
export const findQuestion = (set: QuestionSet, q?: string | null) => set.questions.find((x) => x.id === q);
