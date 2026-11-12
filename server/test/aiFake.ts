import type { AiProvider, GenerateRequest, GenerateResult } from '../src/ai/types';

export type Handler = (req: GenerateRequest, n: number) => string | Promise<string>;

/** Deterministic fake provider: routes on markers in the system prompt. */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  calls: GenerateRequest[] = [];
  overrides: Record<string, Handler> = {};
  failNext: Array<Error> = [];
  hang = false;
  streamChunks: string[] | null = null;
  reset() { this.calls = []; this.overrides = {}; this.failNext = []; this.hang = false; this.streamChunks = null; }

  prompt(i = -1) {
    const c = this.calls.at(i)!;
    return `${c.system}\n${c.messages.map((m) => m.text).join('\n')}`;
  }
  allPrompts() { return this.calls.map((c) => `${c.system}\n${c.messages.map((m) => m.text).join('\n')}`).join('\n=====\n'); }

  private route(req: GenerateRequest): string {
    const s = req.system;
    const last = req.messages.at(-1)!.text;
    const key = Object.keys(this.overrides).find((k) => s.includes(k) || last.includes(k));
    if (key) return this.overrides[key](req, this.calls.length) as string;
    if (s.includes('careful resume reviewer')) {
      return JSON.stringify({
        score: 72, strengths: ['Clear project section'], gaps: ['No metrics'], ats_keywords_missing: ['Docker'],
        rewrite_suggestions: [
          { section: 'Projects', before: 'Built a chat app', after: 'Built a real-time chat app used by 500 users' },
          { section: 'Projects', before: 'THIS TEXT IS NOT IN THE RESUME', after: 'invented' },
        ],
        jd_match: { matched_skills: ['React'], missing_skills: ['Docker'], percent: 50 },
      });
    }
    if (s.includes('mock interviewer')) {
      if (last.includes('Ask question 1')) return JSON.stringify({ question: 'Tell me about yourself.' });
      if (last.includes('final practice report')) {
        return JSON.stringify({
          communication: { score: 7, notes: 'Clear' }, technical_depth: { score: 6, notes: 'OK' }, structure_star: { score: 5, notes: 'Add results' },
          per_question: [{ index: 1, comment: 'Good start' }, { index: 2, comment: 'More detail' }], top_tips: ['Use STAR'],
        });
      }
      const isLast = last.includes('set next_question to null');
      const m = /latest answer \(Q(\d+)\)/.exec(last);
      const idx = Number(m?.[1] || 1);
      return JSON.stringify({ feedback: { summary: 'Decent answer', strengths: ['Clear'], improve: ['Add numbers'] }, score: 6 + (idx % 2), next_question: isLast ? null : `Question number ${idx + 1}?` });
    }
    if (s.includes('structured interview')) {
      const quote = /Built a chat app/.test(last) ? 'Built a chat app' : 'Build and ship backend services';
      return JSON.stringify({ questions: [
        { question: 'Walk me through the chat app architecture.', why_asked: 'Resume lists a chat app', evidence: { source: 'resume', quote }, expected_points: ['websockets'], follow_ups: ['Scaling?'], difficulty: 'medium', rubric: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' } },
        { question: 'Describe a Kubernetes migration you led.', why_asked: 'JD', evidence: { source: 'jd', quote: 'this sentence is not in the jd' }, expected_points: ['x'], follow_ups: [], difficulty: 'hard', rubric: { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' } },
      ] });
    }
    if (s.includes('summarise a job candidate')) {
      return JSON.stringify({
        factual_summary: 'Candidate built a chat app. I would recommend hiring this candidate. Studies Computer Science.',
        skills_vs_jd: { matched: [{ skill: 'React', citation: 'React' }, { skill: 'Kubernetes', citation: 'none' }], not_evidenced: ['Docker'] },
        citations: [{ source: 'resume', quote: 'Built a chat app' }, { source: 'resume', quote: 'Won a Nobel prize' }], notes: ['Strong hire.'],
      });
    }
    if (s.includes('extract structured fields')) {
      return JSON.stringify({
        role: 'Software Engineer', company: 'Acme', skills: ['Java'], qualifications: ['B.Tech'], selection_process: ['Test', 'Interview'],
        suggested_eligibility: { minCgpa: 7, maxActiveBacklogs: 0, min12th: 150, bogusKey: 1, allowedBatches: [2026] },
        eligibility_evidence: { minCgpa: 'Minimum 7 CGPA', maxActiveBacklogs: 'No active backlogs allowed', allowedBatches: 'batch of 2027 only' },
        suggested_questions: [{ label: 'Notice period?', type: 'short_text', required: false, options: [] }, { label: 'Bad', type: 'telepathy', required: false, options: [] }],
      });
    }
    if (s.includes('multiple-choice')) {
      return JSON.stringify({ items: [
        { stem: 'What is 2+2?', options: ['3', '4', '5', '6'], correct_index: 1, explanation: 'Basic arithmetic.' },
        { stem: 'Capital of France?', options: ['Paris', 'Rome', 'Madrid', 'Berlin'], correct_index: 0, explanation: 'Paris.' },
      ] });
    }
    if (s.includes('draft a short announcement')) return JSON.stringify({ title: 'Drive on 25 March', body: 'Registrations close on 25 March. Bring 3 copies of your resume.' });
    if (s.includes('rules object')) {
      return JSON.stringify({ rules: { minCgpa: 7, maxActiveBacklogs: 0, shoeSize: 9, allowedDepartments: ['Computer Science'] }, explanation: 'Draft', unsupported: ['Interview dress code'] });
    }
    return 'Hello from the fake assistant.';
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(req);
    if (this.hang) await new Promise((_, rej) => req.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const f = this.failNext.shift();
    if (f) throw f;
    return { text: await this.route(req), inputTokens: 100, outputTokens: 50 };
  }

  async *generateStream(req: GenerateRequest) {
    this.calls.push(req);
    const f = this.failNext.shift();
    if (f) throw f;
    const chunks = this.streamChunks || ['Hello ', 'from ', 'stream'];
    for (const c of chunks) yield { text: c };
    yield { text: '', inputTokens: 120, outputTokens: 30 };
  }
}
