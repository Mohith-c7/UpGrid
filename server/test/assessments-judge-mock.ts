import { JudgeUnavailableError, type ExecItem, type ExecLimits, type ExecResult, type Judge0Client } from '../src/assessments/judge';

/** In-memory Judge0 double. The "program" is chosen by markers inside the submitted code. */
export class MockJudge implements Judge0Client {
  configured = true;
  down = false;
  calls = 0;
  batches: ExecItem[][] = [];
  isConfigured() { return this.configured; }
  async execute(items: ExecItem[], _limits: ExecLimits): Promise<ExecResult[]> {
    if (this.down) throw new JudgeUnavailableError('mock judge down');
    this.calls++;
    this.batches.push(items);
    return items.map((it) => {
      const base = { stdout: '', stderr: '', compileOutput: '', timeMs: 12, memoryKb: 2048 };
      const nums = it.stdin.split(/\s+/).filter(Boolean).map(Number);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (it.code.includes('COMPILE_ERR')) return { ...base, status: 'compile_error' as const, compileOutput: 'error: expected ;' };
      if (it.code.includes('RUNTIME')) return { ...base, status: 'runtime_error' as const, stderr: 'Traceback: boom' };
      if (it.code.includes('TLE')) return { ...base, status: 'time_limit' as const, timeMs: 5000 };
      if (it.code.includes('MLE')) return { ...base, status: 'memory_limit' as const };
      if (it.code.includes('WRONG')) return { ...base, status: 'ok' as const, stdout: '0\n' };
      if (it.code.includes('PARTIAL') && sum > 100) return { ...base, status: 'ok' as const, stdout: '0\n' };
      if (it.code.includes('FLOAT')) return { ...base, status: 'ok' as const, stdout: `${sum + 0.0000001}\n` };
      // default / SUM: prints the sum
      return { ...base, status: 'ok' as const, stdout: `${sum}\n` };
    });
  }
}
