// Application Constants
export const APP_CONSTANTS = {
  // Password Configuration
  PASSWORD: {
    MIN_LENGTH: 8,
    HISTORY_COUNT: 5, // Number of previous passwords to check
    BCRYPT_ROUNDS: 12,
  },

  // Institution Configuration
  INSTITUTION: {
    MAX_ADMINS: 10,
    CODE_MIN_LENGTH: 3,
    CODE_MAX_LENGTH: 20,
  },

  // Token Configuration
  TOKEN: {
    ACCESS_TOKEN_EXPIRY: '1h', // Changed from 24h for security
    REFRESH_TOKEN_EXPIRY: '7d',
    VERIFICATION_TOKEN_LENGTH: 32,
    VERIFICATION_TOKEN_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in ms
  },

  // OTP Configuration
  OTP: {
    LENGTH: 6,
    EXPIRY: 10 * 60 * 1000, // 10 minutes in ms
  },

  // Rate Limiting
  RATE_LIMIT: {
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_WINDOW: 15 * 60 * 1000, // 15 minutes
    GENERAL_MAX_REQUESTS: 100,
    GENERAL_WINDOW: 15 * 60 * 1000, // 15 minutes
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
  },

  // API Versioning
  API_VERSION: 'v1',
} as const;

// Environment-based configuration
export const getConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  
  return {
    isDevelopment: env === 'development',
    isProduction: env === 'production',
    isTest: env === 'test',
    
    // Security settings based on environment
    security: {
      returnPasswordInResponse: env === 'development', // Only in dev
      enableDebugEndpoints: env === 'development', // Only in dev
      logStackTraces: env === 'development', // Only in dev
      includeDebugInEmails: env === 'development', // Only in dev
    },
  };
};
