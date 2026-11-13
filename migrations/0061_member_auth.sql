-- Consumer identity is deliberately separate from CRM, reseller and admin identities.
-- These tables belong exclusively to store-3. Another shop must use its own models.
CREATE TABLE member_s3_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emailVerified INTEGER NOT NULL DEFAULT 0 CHECK(emailVerified IN (0,1)),
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE member_s3_session (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES member_s3_user(id) ON DELETE CASCADE
);
CREATE INDEX member_s3_session_user ON member_s3_session(userId);
CREATE INDEX member_s3_session_expiry ON member_s3_session(expiresAt);
CREATE TABLE member_s3_account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES member_s3_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(providerId,accountId)
);
CREATE INDEX member_s3_account_user ON member_s3_account(userId);
CREATE TABLE member_s3_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX member_s3_verification_identifier ON member_s3_verification(identifier);
