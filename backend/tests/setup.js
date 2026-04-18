/**
 * Test Setup — Sets env vars before test framework loads.
 * MongoDB connection is handled per-test in each test file.
 */
process.env.JWT_SECRET = "test-jwt-secret-for-automated-tests";
process.env.PORT = "0";
