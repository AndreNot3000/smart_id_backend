// GPA / CGPA calculation utilities.
//
// The CGPA is never uploaded by a human. It is derived from the grades that
// lecturers already enter (score / maxScore on assignment_submissions) plus
// each course's credit units. The grading scale (percentage -> letter -> grade
// point) is configurable per institution; if an institution hasn't customised
// it, DEFAULT_GRADE_SCALE is used.

export interface GradeBand {
  min: number; // inclusive lower bound of the percentage range
  max: number; // inclusive upper bound of the percentage range
  letter: string;
  point: number;
}

export interface GradeScale {
  scaleMax: number; // e.g. 5.0 or 4.0 — the maximum possible grade point
  bands: GradeBand[];
}

// Sensible default: 5.0 scale (common in Nigerian universities).
// Admins can override this per institution.
export const DEFAULT_GRADE_SCALE: GradeScale = {
  scaleMax: 5.0,
  bands: [
    { min: 70, max: 100, letter: 'A', point: 5 },
    { min: 60, max: 69.999, letter: 'B', point: 4 },
    { min: 50, max: 59.999, letter: 'C', point: 3 },
    { min: 45, max: 49.999, letter: 'D', point: 2 },
    { min: 40, max: 44.999, letter: 'E', point: 1 },
    { min: 0, max: 39.999, letter: 'F', point: 0 },
  ],
};

// Basic validation so a malformed institution config can't break calculations.
export function isValidScale(scale: any): scale is GradeScale {
  return (
    scale &&
    typeof scale.scaleMax === 'number' &&
    scale.scaleMax > 0 &&
    Array.isArray(scale.bands) &&
    scale.bands.length > 0 &&
    scale.bands.every(
      (b: any) =>
        typeof b.min === 'number' &&
        typeof b.max === 'number' &&
        typeof b.point === 'number' &&
        typeof b.letter === 'string'
    )
  );
}

export function percentageToGrade(
  pct: number,
  scale: GradeScale = DEFAULT_GRADE_SCALE
): { letter: string; point: number } {
  const p = Math.max(0, Math.min(100, pct));
  for (const b of scale.bands) {
    if (p >= b.min && p <= b.max) return { letter: b.letter, point: b.point };
  }
  // Fallback: clamp to the nearest band by bounds.
  const sorted = [...scale.bands].sort((a, b) => a.min - b.min);
  const highest = sorted[sorted.length - 1];
  const lowest = sorted[0];
  return p > highest.max
    ? { letter: highest.letter, point: highest.point }
    : { letter: lowest.letter, point: lowest.point };
}

// A short, scale-independent descriptor for the dashboard card.
export function classifyCgpa(cgpa: number, scaleMax: number): string {
  if (scaleMax <= 0) return '';
  const ratio = cgpa / scaleMax;
  if (ratio >= 0.9) return 'Excellent';
  if (ratio >= 0.75) return 'Very Good';
  if (ratio >= 0.6) return 'Good';
  if (ratio >= 0.5) return 'Fair';
  return 'Needs Improvement';
}
