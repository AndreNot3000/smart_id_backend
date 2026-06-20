import type { UserProfile } from '../models/user.model.js';

type TitleProfile = Pick<UserProfile, 'title' | 'role'> | null | undefined;

/** Honorific prefix (Mr, Dr, Prof, …). Prefers `title`, falls back to legacy `role`. */
export function getLecturerTitle(profile: TitleProfile): string {
  if (!profile) return '';
  return (profile.title || profile.role || '').trim();
}

type NameProfile = Pick<UserProfile, 'title' | 'role' | 'firstName' | 'lastName'> | null | undefined;

/** Builds a display name such as "Dr John Doe" (no extra period added). */
export function formatLecturerName(profile: NameProfile): string {
  if (!profile) return '';
  const honorific = getLecturerTitle(profile);
  const name = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  return honorific ? `${honorific} ${name}`.trim() : name;
}
