// Input sanitization utilities to prevent XSS and injection attacks

/**
 * Sanitize string input by removing potentially dangerous characters
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers like onclick=
}

/**
 * Sanitize email input
 */
export function sanitizeEmail(email: string): string {
  if (typeof email !== 'string') return '';
  
  return email
    .trim()
    .toLowerCase()
    .replace(/[<>'"]/g, ''); // Remove potentially dangerous characters
}

/**
 * Sanitize object by sanitizing all string values
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized = { ...obj };
  
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeString(sanitized[key]) as any;
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeObject(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Validate and sanitize institution code
 */
export function sanitizeInstitutionCode(code: string): string {
  if (typeof code !== 'string') return '';
  
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, ''); // Only allow alphanumeric, dash, and underscore
}
