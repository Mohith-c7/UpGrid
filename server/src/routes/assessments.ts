import type { Router } from 'express';
import type { Deps } from '../context';
import { registerFeatureFlags } from '../features';
import { getJudge } from '../assessments/judge';
import { assessmentQuestionsRouter } from './assessmentsBank';
import { assessmentsOfficerRouter } from './assessmentsOfficer';
import { assessmentsStudentRouters } from './assessmentsStudent';

let flagsRegistered = false;

/**
 * Mounts every assessments route on the v1 router. Each router lives under its own prefix and does its own
 * authentication / role check, so nothing here shadows other modules' routes.
 */
export function mountAssessments(v1: Router, deps: Deps) {
  if (!flagsRegistered) {
    flagsRegistered = true;
    registerFeatureFlags(() => ({ assessments: true, codeExecution: getJudge().isConfigured() }));
  }
  const { mine, att, prac } = assessmentsStudentRouters(deps);
  v1.use('/assessment-questions', assessmentQuestionsRouter(deps));
  v1.use('/assessments', assessmentsOfficerRouter(deps));
  v1.use('/my/assessments', mine);
  v1.use('/attempts', att);
  v1.use('/practice', prac);
}
