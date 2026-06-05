// Gradebook utilities.
//
// A course's final grade is built from "assessment components" that the
// lecturer configures (e.g. Test 1, Assignment, Exam). Each component has a
// weight; the final course score (0–100) is the weighted average of
// (studentScore / componentMax), normalised by the total weight so it always
// lands on a 0–100 scale even if the weights don't sum to exactly 100.
//
// A blank/missing score counts as 0 (the lecturer can override by typing a
// number). Component scores come from two sources:
//   - type 'manual'     -> entered by the lecturer (stored in gradebook_scores)
//   - type 'assignment' -> pulled from the student's graded assignment submission

export type ComponentType = 'manual' | 'assignment';

export interface AssessmentComponent {
  id: string;
  name: string;
  type: ComponentType;
  assignmentId?: string; // when type === 'assignment'
  maxScore: number;
  weight: number; // contribution toward the final (ideally all weights sum to 100)
}

export function clampScore(score: number, max: number): number {
  if (typeof score !== 'number' || isNaN(score)) return 0;
  return Math.max(0, Math.min(score, max));
}

// Compute a single student's final percentage (0–100) from their per-component
// scores. `scoreMap` maps componentId -> raw score; missing entries count as 0.
export function computeFinalPercentage(
  components: AssessmentComponent[],
  scoreMap: Record<string, number | undefined | null>
): number {
  const totalWeight = components.reduce((sum, c) => sum + (c.weight || 0), 0);
  if (totalWeight <= 0) return 0;

  let earned = 0;
  for (const comp of components) {
    if (!comp.maxScore || comp.maxScore <= 0) continue;
    const raw = scoreMap[comp.id];
    const score = clampScore(typeof raw === 'number' ? raw : 0, comp.maxScore);
    earned += (score / comp.maxScore) * (comp.weight || 0);
  }
  return Math.round(((earned / totalWeight) * 100) * 100) / 100;
}

// Validate a list of components coming from the client.
export function validateComponents(components: any): { ok: true; clean: AssessmentComponent[] } | { ok: false; error: string } {
  if (!Array.isArray(components)) return { ok: false, error: 'Components must be an array.' };
  if (components.length === 0) return { ok: false, error: 'Add at least one assessment component.' };
  if (components.length > 20) return { ok: false, error: 'Too many components (max 20).' };

  const clean: AssessmentComponent[] = [];
  for (const c of components) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'Invalid component.' };
    const name = String(c.name || '').trim();
    if (!name) return { ok: false, error: 'Every component needs a name.' };
    const type: ComponentType = c.type === 'assignment' ? 'assignment' : 'manual';
    const maxScore = Number(c.maxScore);
    const weight = Number(c.weight);
    if (!maxScore || maxScore <= 0) return { ok: false, error: `Component "${name}" needs a max score greater than 0.` };
    if (weight < 0) return { ok: false, error: `Component "${name}" has an invalid weight.` };
    if (type === 'assignment' && !c.assignmentId) {
      return { ok: false, error: `Component "${name}" is set to reuse an assignment but none is selected.` };
    }
    clean.push({
      id: String(c.id || '').trim() || `c_${Math.random().toString(36).slice(2, 10)}`,
      name: name.slice(0, 60),
      type,
      assignmentId: type === 'assignment' ? String(c.assignmentId) : undefined,
      maxScore,
      weight,
    });
  }
  return { ok: true, clean };
}
